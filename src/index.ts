#!/usr/bin/env node

import yargs = require('yargs/yargs');
import axios from 'axios';
import browserSync from 'browser-sync';
import { bold, gray, yellow } from 'chalk';
import chokidar from 'chokidar';
import { prompt } from 'enquirer';
import express from 'express';
import fg from 'fast-glob';
import { existsSync, mkdir, readdir, readFile, readJson, rename, writeFile } from 'fs-extra';
import { createProxyMiddleware } from 'http-proxy-middleware';
import nodemon from 'nodemon';
import { EOL, hostname } from 'os';
import * as path from 'path';
import { gt } from 'semver';
import { RawSourceMap, SourceMapGenerator } from 'source-map';
import WebSocket from 'ws';
import { Logger } from './logger';
import { LocalTarget, ProcessExecutor, RemoteTarget, Target } from './target';
import { rimraf } from './utils';
import chalk = require('chalk');
import acorn = require('acorn');
import EventEmitter = require('events');

const DEFAULT_TEMP_DIR_NAME = '.dev-server';
const CORE_MODULE = 'iobroker.js-controller';
const IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
const IOBROKER_COMMAND = `node ${IOBROKER_CLI}`;
const DEFAULT_ADMIN_PORT = 8081;
const HIDDEN_ADMIN_PORT_OFFSET = 12345;
const HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
const STATES_DB_PORT_OFFSET = 16345;
const OBJECTS_DB_PORT_OFFSET = 18345;
const DEFAULT_PROFILE_NAME = 'default';

interface DevServerConfig {
  adminPort: number;
  remote?: string;
}

type CoreDependency = 'iobroker.js-controller' | 'iobroker.admin';
type DependencyVersions = Partial<Record<CoreDependency, string>>;

class DevServer {
  private readonly log = new Logger();
  private readonly executor = new ProcessExecutor(this.log);

  private rootDir!: string;
  private adapterName!: string;
  private tempDir!: string;
  private profileName!: string;
  private profileDir!: string;
  private target!: Target;

  private readonly socketEvents = new EventEmitter();

  constructor() {
    const parser = yargs(process.argv.slice(2));
    parser
      .usage(
        'Usage: $0 <command> [options] [profile]\n   or: $0 <command> --help   to see available options for a command',
      )
      .command(
        ['setup [profile]', 's'],
        'Set up dev-server in the current directory. This should always be called in the directory where the io-package.json file of your adapter is located.',
        {
          adminPort: {
            type: 'number',
            default: DEFAULT_ADMIN_PORT,
            alias: 'p',
            description: 'TCP port on which ioBroker.admin will be available',
          },
          jsController: {
            type: 'string',
            alias: 'j',
            default: 'latest',
            description: 'Define which version of js-controller to be used',
          },
          admin: {
            type: 'string',
            alias: 'a',
            default: 'latest',
            description: 'Define which version of admin to be used',
          },
          backupFile: {
            type: 'string',
            alias: 'b',
            description: 'Provide an ioBroker backup file to restore in this dev-server',
          },
          ssh: {
            type: 'string',
            alias: 's',
            description: 'Run ioBroker on a remote system over SSH.\nFormat: <user>:<password>@<hostname>',
          },
          force: { type: 'boolean', hidden: true },
        },
        async (args) =>
          await this.setup(
            args.adminPort,
            { ['iobroker.js-controller']: args.jsController, ['iobroker.admin']: args.admin },
            args.backupFile,
            args.ssh,
            !!args.force,
          ),
      )
      .command(
        ['update [profile]', 'ud'],
        'Update ioBroker and its dependencies to the latest versions',
        {},
        async () => await this.update(),
      )
      .command(
        ['run [profile]', 'r'],
        'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload',
        {},
        async () => await this.run(),
      )
      .command(
        ['watch [profile]', 'w'],
        'Run ioBroker dev-server and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.',
        {
          noStart: {
            type: 'boolean',
            alias: 'n',
            description: 'Do not start the adapter itself, only watch for changes and sync them.',
          },
        },
        async (args) => await this.watch(!args.noStart),
      )
      .command(
        ['debug [profile]', 'd'],
        'Run ioBroker dev-server and start the adapter from ioBroker in "debug" mode. You may attach a debugger to the running adapter.',
        {
          wait: {
            type: 'boolean',
            alias: 'w',
            description: 'Start the adapter only once the debugger is attached.',
          },
        },
        async (args) => await this.debug(!!args.wait),
      )
      .command(
        ['upload [profile]', 'ul'],
        'Upload the current version of your adapter to the ioBroker dev-server. This is only required if you changed something relevant in your io-package.json',
        {},
        async () => await this.upload(),
      )
      .command(
        ['backup <filename> [profile]', 'b'],
        'Create an ioBroker backup to the given file.',
        {},
        async (args) => await this.backup(args.filename as string),
      )
      .command(
        ['profile', 'p'],
        'List all dev-server profiles that exist in the current directory.',
        {},
        async () => await this.profile(),
      )
      .options({
        temp: {
          type: 'string',
          alias: 't',
          default: DEFAULT_TEMP_DIR_NAME,
          description: 'Temporary directory where the dev-server data will be located',
        },
        root: { type: 'string', alias: 'r', hidden: true, default: '.' },
      })
      .middleware(async () => await this.checkVersion())
      .middleware(async (argv) => await this.setDirectories(argv))
      .wrap(Math.min(100, parser.terminalWidth()))
      .help().argv;
  }

  private async checkVersion(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { name, version: localVersion } = require('../package.json');
      const {
        data: { version: releaseVersion },
      } = await axios.get(`https://cdn.jsdelivr.net/npm/${name}/package.json`, { timeout: 1000 });
      if (gt(releaseVersion, localVersion)) {
        this.log.debug(`Found update from ${localVersion} to ${releaseVersion}`);
        const response = await prompt<{ update: boolean }>({
          name: 'update',
          type: 'confirm',
          message: `Version ${releaseVersion} of ${name} is available.\nWould you like to exit and update?`,
          initial: true,
        });
        if (response.update) {
          this.log.box(
            `Please update ${name} manually and restart your last command afterwards.\n` +
              `If you installed ${name} globally, you can simply call:\n\nnpm install --global ${name}`,
          );
          return this.exit(0);
        } else {
          this.log.warn(`We strongly recommend to update ${name} as soon as possible.`);
        }
      }
    } catch (error) {}
  }

  private async setDirectories(argv: {
    _: (string | number)[];
    root: string;
    temp: string;
    profile?: string;
    ssh?: string;
  }): Promise<void> {
    this.rootDir = path.resolve(argv.root);
    this.tempDir = path.resolve(this.rootDir, argv.temp);
    if (existsSync(path.join(this.tempDir, 'package.json'))) {
      // we are still in the old directory structure (no profiles), let's move it
      const intermediateDir = path.join(this.rootDir, DEFAULT_TEMP_DIR_NAME + '-temp');
      const defaultProfileDir = path.join(this.tempDir, DEFAULT_PROFILE_NAME);
      this.log.debug(`Moving temporary data from ${this.tempDir} to ${defaultProfileDir}`);
      await rename(this.tempDir, intermediateDir);
      await mkdir(this.tempDir);
      await rename(intermediateDir, defaultProfileDir);
    }

    this.adapterName = await this.findAdapterName();

    let profileName = argv.profile;
    const profiles = await this.getProfiles();
    const profileNames = Object.keys(profiles);
    if (profileName) {
      if (!argv._.includes('setup') && !argv._.includes('s')) {
        // ensure the profile exists
        if (!profileNames.includes(profileName)) {
          throw new Error(`Profile ${profileName} doesn't exist`);
        }
      }
    } else {
      if (argv._.includes('profile') || argv._.includes('p')) {
        // we don't care about the profile name
        profileName = DEFAULT_PROFILE_NAME;
      } else {
        if (profileNames.length === 0) {
          profileName = DEFAULT_PROFILE_NAME;
          this.log.debug(`Using default profile ${profileName}`);
        } else if (profileNames.length === 1) {
          profileName = profileNames[0];
          this.log.debug(`Using profile ${profileName}`);
        } else {
          this.log.box(
            yellow(
              `You didn't specify the profile name in the command line. ` +
                `You may do so the next time by appending the profile name to your command.\nExample:\n` +
                `> dev-server ${process.argv.slice(2).join(' ')} ${profileNames[profileNames.length - 1]} `,
            ),
          );
          const response = await prompt<{ profile: string }>({
            name: 'profile',
            type: 'select',
            message: 'Please choose a profile',
            choices: profileNames.map((p) => ({
              name: p,
              hint: gray(`(Admin Port: ${profiles[p]['dev-server'].adminPort})`),
            })),
          });
          profileName = response.profile;
        }
      }
    }

    if (!profileName.match(/^[a-z0-9_-]+$/i)) {
      throw new Error(`Invalid profile name: "${profileName}", it may only contain a-z, 0-9, _ and -.`);
    }

    this.profileName = profileName;
    this.log.debug(`Using profile name "${this.profileName}"`);
    this.profileDir = path.join(this.tempDir, profileName);
    if (argv.ssh) {
      this.target = new RemoteTarget(argv.ssh, this.profileDir, this.adapterName, this.log);
    } else {
      const config = await this.readDevServerConfig();
      if (config?.remote) {
        this.target = new RemoteTarget(config.remote, this.profileDir, this.adapterName, this.log);
      } else {
        this.target = new LocalTarget(this.profileDir, this.log);
      }
    }
  }

  private async findAdapterName(): Promise<string> {
    try {
      const ioPackage = await readJson(path.join(this.rootDir, 'io-package.json'));
      const adapterName = ioPackage.common.name;
      this.log.debug(`Using adapter name "${adapterName}"`);
      return adapterName;
    } catch (error: any) {
      this.log.warn(error);
      this.log.error('You must run dev-server in the adapter root directory (where io-package.json resides).');
      return this.exit(-1);
    }
  }

  private isJSController(): boolean {
    return this.adapterName === 'js-controller';
  }

  private readPackageJson(): Promise<any> {
    return readJson(path.join(this.rootDir, 'package.json'));
  }

  private getPort(adminPort: number, offset: number): number {
    let port = adminPort + offset;
    if (port > 65000) {
      port -= 63000;
    }
    return port;
  }

  ////////////////// Command Handlers //////////////////

  async setup(
    adminPort: number,
    dependencies: DependencyVersions,
    backupFile?: string,
    remote?: string,
    force?: boolean,
  ): Promise<void> {
    if (force) {
      await this.target.deleteAll();
    }

    const msg = remote ? `on\n${remote}` : `in\n${this.profileDir}`;
    if (await this.isSetUp()) {
      this.log.error(`dev-server is already set up ${msg}`);
      this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
      return;
    }

    await this.setupDevServer(adminPort, dependencies, backupFile, remote);

    const commands = ['run', 'watch', 'debug'];
    this.log.box(
      `dev-server was successfully set up ${msg}.\n\n` +
        `You may now execute one of the following commands\n\n${commands
          .map((command) => `dev-server ${command} ${this.profileName}`)
          .join('\n')}\n\nto use dev-server.`,
    );
  }

  private async update(): Promise<void> {
    await this.checkSetup();
    this.log.notice('Updating everything...');

    await this.target.execBlocking('npm update --loglevel error');
    await this.uploadAdapter('admin');

    await this.installLocalAdapter();
    if (!this.isJSController()) await this.uploadAdapter(this.adapterName);

    this.log.box(`dev-server was successfully updated.`);
  }

  async run(): Promise<void> {
    await this.checkSetup();
    await this.startJsController();
    await this.startServer(false);
  }

  async watch(startAdapter: boolean): Promise<void> {
    await this.checkSetup();
    await this.installLocalAdapter();
    if (this.isJSController()) {
      // this watches actually js-controller
      await this.startAdapterWatch(startAdapter);
      await this.startServer(false);
    } else {
      await this.startJsController();
      await this.startServer(startAdapter);
      await this.startAdapterWatch(startAdapter);
    }
  }

  async debug(wait: boolean): Promise<void> {
    await this.checkSetup();
    await this.installLocalAdapter();
    await this.copySourcemaps();
    if (this.isJSController()) {
      await this.startJsControllerDebug(wait);
      await this.startServer(false);
    } else {
      await this.startJsController();
      await this.startServer(false);
      await this.startAdapterDebug(wait);
    }
  }

  async upload(): Promise<void> {
    await this.checkSetup();
    await this.installLocalAdapter();
    if (!this.isJSController()) await this.uploadAdapter(this.adapterName);

    this.log.box(`The latest content of iobroker.${this.adapterName} was uploaded to ${this.profileName}.`);
  }

  async backup(filename: string): Promise<void> {
    const fullPath = path.resolve(filename);
    this.log.notice('Creating backup');
    await this.target.execBlocking(`${IOBROKER_COMMAND} backup "${fullPath}"`);
  }

  async profile(): Promise<void> {
    const profiles = await this.getProfiles();
    const table = Object.keys(profiles).map((name) => {
      const pkg = profiles[name];
      const infos = pkg['dev-server'];
      const dependencies = pkg.dependencies;
      return [
        name,
        `http://localhost:${infos.adminPort}`,
        dependencies['iobroker.js-controller'],
        dependencies['iobroker.admin'],
      ];
    });
    table.unshift([bold('Profile Name'), bold('Admin URL'), bold('js-controller'), bold('admin')]);
    this.log.info(`The following profiles exist in ${this.tempDir}`);
    this.log.table(table.filter((r) => !!r) as any);
  }

  ////////////////// Command Helper Methods //////////////////

  async getProfiles(): Promise<Record<string, any>> {
    if (!existsSync(this.tempDir)) {
      return {};
    }

    const entries = await readdir(this.tempDir);
    const pkgs = await Promise.all(
      entries.map(async (e) => {
        try {
          const pkg = await readJson(path.join(this.tempDir, e, 'package.json'));
          const infos = pkg['dev-server'];
          const dependencies = pkg.dependencies;
          if (infos?.adminPort && dependencies) {
            return [e, pkg];
          }
        } catch {
          return undefined;
        }
      }, {}),
    );
    return (pkgs.filter((p) => !!p) as any[]).reduce<Record<string, any>>(
      (old, [e, pkg]) => ({ ...old, [e]: pkg }),
      {},
    );
  }

  async checkSetup(): Promise<void> {
    if (!(await this.isSetUp())) {
      this.log.error(
        `dev-server is not set up in ${this.profileDir}.\nPlease use the command "setup" first to set up dev-server.`,
      );
      return this.exit(-1);
    }
  }

  async isSetUp(): Promise<boolean> {
    const jsControllerDir = path.join(this.profileDir, 'node_modules', CORE_MODULE);
    if (existsSync(jsControllerDir)) {
      return true;
    }

    const config = await this.readDevServerConfig();
    return !!config?.remote;
  }

  async startJsController(): Promise<void> {
    const proc = await this.target.spawn('node', ['node_modules/iobroker.js-controller/controller.js']);
    proc.on('exit', async (code) => {
      console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
      return this.exit(-1);
    });
  }

  private async startJsControllerDebug(wait: boolean): Promise<void> {
    this.log.notice(`Starting debugger for ${this.adapterName}`);

    const nodeArgs = ['node_modules/iobroker.js-controller/controller.js'];
    if (wait) {
      nodeArgs.unshift('--inspect-brk');
    } else {
      nodeArgs.unshift('--inspect');
    }
    const proc = await this.target.spawn('node', nodeArgs);
    proc.on('exit', (code) => {
      console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
      return this.exit(-1);
    });

    this.log.box(`Debugger is now ${wait ? 'waiting' : 'available'} on process id ${proc.pid}`);
  }

  async startServer(useSocketEvents: boolean): Promise<void> {
    const config = await this.readDevServerConfig();
    if (!config) {
      throw new Error(`Couldn't find dev-server configuration in ${path.join(this.profileDir, 'package.json')}`);
    }

    if (!!config.remote) {
      this.log.notice(`Running on ${config.remote}`);
    } else {
      this.log.notice(`Running in ${this.profileDir}`);
    }

    // figure out if we need parcel (React)
    if (!this.isJSController()) {
      const pkg = await this.readPackageJson();
      const scripts = pkg.scripts;
      if (scripts) {
        if (scripts['watch:react']) {
          // use React with default script name
          await this.startReact();
        } else if (scripts['watch:parcel']) {
          // use React with legacy script name
          await this.startReact('watch:parcel');
        }
      }
    }

    this.startBrowserSync(this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET));

    // browser-sync proxy
    const app = express();
    const adminPattern = `/adapter/${this.adapterName}/**`;
    const pathRewrite: Record<string, string> = {};
    pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
    app.use(
      createProxyMiddleware([adminPattern, '/browser-sync/**'], {
        target: `http://localhost:${this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET)}`,
        //ws: true, // can't have two web-socket connections proxying to different locations
        pathRewrite,
      }),
    );

    // admin proxy
    const hiddenAdminPort = this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET);
    app.use(
      createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
        target: `http://localhost:${hiddenAdminPort}`,
        ws: true,
      }),
    );

    // start express
    this.log.notice(`Starting web server on port ${config.adminPort}`);
    const server = app.listen(config.adminPort);

    let exiting = false;
    process.on('SIGINT', () => {
      this.log.notice('dev-server is exiting...');
      exiting = true;
      server.close();
      // do not kill this process when receiving SIGINT, but let all child processes exit first
    });

    await new Promise<void>((resolve, reject) => {
      server.on('listening', resolve);
      server.on('error', reject);
      server.on('close', reject);
    });

    const connectWebSocketClient = (): void => {
      if (exiting) return;
      // TODO: replace this with @iobroker/socket-client
      const client = new WebSocket(`ws://localhost:${hiddenAdminPort}/?sid=${Date.now()}&name=admin`);
      client.on('open', () => this.log.debug('WebSocket open'));
      client.on('close', () => {
        this.log.debug('WebSocket closed');
        setTimeout(connectWebSocketClient, 1000);
      });
      client.on('error', (error) => this.log.debug(`WebSocket error: ${error}`));
      client.on('message', (msg) => {
        if (typeof msg === 'string') {
          try {
            const data = JSON.parse(msg);
            if (!Array.isArray(data) || data.length === 0) return;
            switch (data[0]) {
              case 0:
                if (data.length > 3) {
                  this.socketEvents.emit(data[2], data[3]);
                }
                break;
              case 1:
                // ping received, send pong (keep-alive)
                client.send('[2]');
                break;
            }
          } catch (error) {
            this.log.error(`Couldn't handle WebSocket message: ${error}`);
          }
        }
      });
    };

    if (useSocketEvents) {
      connectWebSocketClient();
    }

    this.log.box(`Admin is now reachable under http://localhost:${config.adminPort}/`);
  }

  private async copySourcemaps(): Promise<void> {
    const outDir = path.join('node_modules', `iobroker.${this.adapterName}`);
    this.log.notice(`Creating or patching sourcemaps in ${outDir}`);
    const sourcemaps = await this.findFiles('map', true);
    if (sourcemaps.length === 0) {
      this.log.debug(`Couldn't find any sourcemaps in ${this.rootDir},\nwill try to reverse map .js files`);

      // search all .js files that exist in the node module in the temp directory as well as in the root directory and
      // create sourcemap files for each of them
      const jsFiles = await this.findFiles('js', true);
      await Promise.all(
        jsFiles.map(async (js) => {
          const src = path.join(this.rootDir, js);
          const dest = path.join(outDir, js);
          await this.addSourcemap(src, dest, false);
        }),
      );
      return;
    }

    // copy all *.map files to the node module in the temp directory and
    // change their sourceRoot so they can be found in the development directory
    await Promise.all(
      sourcemaps.map(async (sourcemap) => {
        const src = path.join(this.rootDir, sourcemap);
        const dest = path.join(outDir, sourcemap);
        this.patchSourcemap(src, dest);
      }),
    );
  }

  /**
   * Create an identity sourcemap to point to a different source file.
   * @param src The path to the original JavaScript file.
   * @param dest The relative path to the JavaScript file which will get a sourcemap attached.
   * @param copyFromSrc Set to true to copy the JavaScript file from src to dest (not just modify dest).
   */
  private async addSourcemap(src: string, dest: string, copyFromSrc: boolean): Promise<void> {
    try {
      const mapFile = `${dest}.map`;
      const data = await this.createIdentitySourcemap(src.replace(/\\/g, '/'));
      await this.target.writeJson(mapFile, data);

      // append the sourcemap reference comment to the bottom of the file
      let fileContent: string;
      if (copyFromSrc) {
        fileContent = await readFile(src, { encoding: 'utf-8' });
      } else {
        fileContent = await this.target.readText(dest);
      }
      const filename = path.basename(mapFile);
      let updatedContent = fileContent.replace(/(\/\/\# sourceMappingURL=).+/, `$1${filename}`);
      if (updatedContent === fileContent) {
        // no existing source mapping URL was found in the file
        if (!fileContent.endsWith('\n')) {
          if (fileContent.match(/\r\n/)) {
            // windows eol
            updatedContent += '\r';
          }
          updatedContent += '\n';
        }
        updatedContent += `//# sourceMappingURL=${filename}`;
      }

      await this.target.writeText(dest, updatedContent);
      this.log.debug(`Created ${mapFile} from ${src}`);
    } catch (error) {
      this.log.warn(`Couldn't reverse map for ${src}: ${error}`);
    }
  }

  /**
   * Patch an existing sourcemap file.
   * @param src The path to the original sourcemap file to patch and copy.
   * @param dest The path to the sourcemap file that is created.
   */
  private async patchSourcemap(src: string, dest: string): Promise<void> {
    try {
      const data = await readJson(src);
      if (data.version !== 3) {
        throw new Error(`Unsupported sourcemap version: ${data.version}`);
      }
      data.sourceRoot = path.dirname(src).replace(/\\/g, '/');
      await this.target.writeJson(dest, data);
      this.log.debug(`Patched ${dest} from ${src}`);
    } catch (error) {
      this.log.warn(`Couldn't patch ${dest}: ${error}`);
    }
  }

  private getFilePatterns(extensions: string | string[], excludeAdmin: boolean): string[] {
    const exts = typeof extensions === 'string' ? [extensions] : extensions;
    const patterns = exts.map((e) => `./**/*.${e}`);
    patterns.push('!./.*/**');
    patterns.push('!./node_modules/**');
    patterns.push('!./test/**');
    if (excludeAdmin) {
      patterns.push('!./admin/**');
    }
    return patterns;
  }

  private async findFiles(extension: string, excludeAdmin: boolean): Promise<string[]> {
    return await fg(this.getFilePatterns(extension, excludeAdmin), { cwd: this.rootDir });
  }

  private async createIdentitySourcemap(filename: string): Promise<RawSourceMap> {
    // thanks to https://github.com/gulp-sourcemaps/identity-map/blob/251b51598d02e5aedaea8f1a475dfc42103a2727/lib/generate.js [MIT]
    const generator = new SourceMapGenerator({ file: filename });
    const fileContent = await readFile(filename, { encoding: 'utf-8' });
    const tokenizer = acorn.tokenizer(fileContent, {
      ecmaVersion: 'latest',
      allowHashBang: true,
      locations: true,
    });

    while (true) {
      const token = tokenizer.getToken();

      if (token.type.label === 'eof' || !token.loc) {
        break;
      }
      const mapping = {
        original: token.loc.start,
        generated: token.loc.start,
        source: filename,
      };
      generator.addMapping(mapping);
    }

    return generator.toJSON();
  }

  private async startReact(scriptName = 'watch:react'): Promise<void> {
    this.log.notice('Starting React build');
    this.log.debug('Waiting for first successful React build...');
    await this.executor.spawnAndAwaitOutput(
      'npm',
      ['run', scriptName],
      this.rootDir,
      /(built in|done in|watching (files )?for)/i,
      {
        shell: true,
      },
    );
  }

  private startBrowserSync(port: number): void {
    this.log.notice('Starting browser-sync');
    const bs = browserSync.create();

    const adminPath = path.resolve(this.rootDir, 'admin/');
    const config: browserSync.Options = {
      server: { baseDir: adminPath, directory: true },
      port: port,
      open: false,
      ui: false,
      logLevel: 'silent',
      files: [path.join(adminPath, '**')],
      plugins: [
        {
          module: 'bs-html-injector',
          options: {
            files: [path.join(adminPath, '*.html')],
          },
        },
      ],
    };
    // console.log(config);
    bs.init(config);
  }

  private async startAdapterDebug(wait: boolean): Promise<void> {
    this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
    const args = [IOBROKER_CLI, 'debug', `${this.adapterName}.0`];
    if (wait) {
      args.push('--wait');
    }
    const proc = await this.target.spawn('node', args);
    proc.on('exit', (code) => {
      console.error(chalk.yellow(`Adapter debugging exited with code ${code}`));
      return this.exit(-1);
    });

    if (!proc.pid) {
      throw new Error(`PID of adapter debugger unknown!`);
    }
    const debugPid = await this.waitForNodeChildProcess(proc.pid);

    this.log.box(`Debugger is now ${wait ? 'waiting' : 'available'} on process id ${debugPid}`);
  }

  private async waitForNodeChildProcess(parentPid: number): Promise<number | undefined> {
    const start = new Date().getTime();
    while (start + 2000 > new Date().getTime()) {
      const processes = await this.executor.getChildProcesses(parentPid);
      const child = processes.find((p) => p.COMMAND.match(/node/i));
      if (child) {
        return parseInt(child.PID);
      }
    }

    this.log.debug(`No node child process of ${parentPid} found, assuming parent process was reused.`);
    return parentPid;
  }

  private async startAdapterWatch(startAdapter: boolean): Promise<void> {
    // figure out if we need to watch for TypeScript changes
    const pkg = await this.readPackageJson();
    const scripts = pkg.scripts;
    if (scripts && scripts['watch:ts']) {
      // use TSC
      await this.startTscWatch();
    }

    // start sync
    const adapterRunDir = path.join('node_modules', `iobroker.${this.adapterName}`);
    await this.startFileSync(adapterRunDir);

    if (startAdapter) {
      await this.startNodemon(adapterRunDir, pkg.main);
    } else {
      this.log.box(
        `You can now start the adapter manually by running\n    ` +
          `node node_modules/iobroker.${this.adapterName}/${pkg.main} --debug 0\nfrom within\n    ` +
          this.profileDir,
      );
    }
  }

  private async startTscWatch(): Promise<void> {
    this.log.notice('Starting tsc --watch');
    this.log.debug('Waiting for first successful tsc build...');
    await this.executor.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], this.rootDir, /watching (files )?for/i, {
      shell: true,
    });
  }

  private startFileSync(destinationDir: string): Promise<void> {
    this.log.notice(`Starting file system sync from ${this.rootDir}`);
    const inSrc = (filename: string): string => path.join(this.rootDir, filename);
    const inDest = (filename: string): string => path.join(destinationDir, filename);
    return new Promise<void>((resolve, reject) => {
      const patterns = this.getFilePatterns(['js', 'map'], true);
      const ignoreFiles = [] as string[];
      const watcher = chokidar.watch(patterns, { cwd: this.rootDir });
      let ready = false;
      watcher.on('error', reject);
      watcher.on('ready', () => {
        ready = true;
        resolve();
      });
      /*watcher.on('all', (event, path) => {
        console.log(event, path);
      });*/
      const syncFile = async (filename: string): Promise<void> => {
        try {
          this.log.debug(`Synchronizing ${filename}`);
          const src = inSrc(filename);
          const dest = inDest(filename);
          if (filename.endsWith('.map')) {
            await this.patchSourcemap(src, dest);
          } else if (!existsSync(inSrc(`${filename}.map`))) {
            // copy file and add sourcemap
            await this.addSourcemap(src, dest, true);
          } else {
            await this.target.uploadFile(src, dest);
          }
        } catch (error) {
          this.log.warn(`Couldn't sync ${filename}`);
        }
      };
      watcher.on('add', (filename: string) => {
        if (ready) {
          syncFile(filename);
        } else if (!filename.endsWith('map') && !this.target.existsSync(inDest(filename))) {
          // ignore files during initial sync if they don't exist in the target directory (except for sourcemaps)
          ignoreFiles.push(filename);
        } else {
          syncFile(filename);
        }
      });
      watcher.on('change', (filename: string) => {
        if (!ignoreFiles.includes(filename)) {
          syncFile(filename);
        }
      });
      watcher.on('unlink', async (filename: string) => {
        await this.target.unlink(inDest(filename));
        const map = inDest(filename + '.map');
        if (this.target.existsSync(map)) {
          await this.target.unlink(map);
        }
      });
    });
  }

  private async startNodemon(baseDir: string, scriptName: string): Promise<void> {
    baseDir = path.join(this.profileDir, baseDir);
    const script = path.resolve(baseDir, scriptName);
    this.log.notice(`Starting nodemon for ${script}`);

    let isExiting = false;
    process.on('SIGINT', () => {
      isExiting = true;
    });

    const args = this.isJSController() ? [] : ['--debug', '0'];

    nodemon({
      script: script,
      stdin: false,
      verbose: true,
      // dump: true, // this will output the entire config and not do anything
      colours: false,
      watch: [baseDir],
      ignore: [path.join(baseDir, 'admin')],
      ignoreRoot: [],
      delay: 2000,
      execMap: { js: 'node --inspect' },
      signal: 'SIGINT' as any, // wrong type definition: signal is of type "string?"
      args,
    });
    nodemon
      .on('log', (msg: { type: 'log' | 'info' | 'status' | 'detail' | 'fail' | 'error'; message: string }) => {
        if (isExiting) {
          return;
        }

        const message = `[nodemon] ${msg.message}`;
        switch (msg.type) {
          case 'detail':
            this.log.debug(message);
            this.handleNodemonDetailMsg(msg.message);
            break;
          case 'info':
            this.log.info(message);
            break;
          case 'status':
            this.log.notice(message);
            break;
          case 'fail':
            this.log.error(message);
            break;
          case 'error':
            this.log.warn(message);
            break;
          default:
            this.log.debug(message);
            break;
        }
      })
      .on('quit', () => {
        this.log.error('nodemon has exited');
        return this.exit(-2);
      })
      .on('crash', () => {
        if (this.isJSController()) {
          this.log.debug('nodemon has exited as expected');
          return this.exit(-1);
        }
      });

    if (!this.isJSController()) {
      this.socketEvents.on('objectChange', (args: any) => {
        if (Array.isArray(args) && args.length > 1 && args[0] === `system.adapter.${this.adapterName}.0`) {
          this.log.notice(`Adapter configuration changed, restarting nodemon...`);
          nodemon.restart();
        }
      });
    }
  }

  async handleNodemonDetailMsg(message: string): Promise<void> {
    const match = message.match(/child pid: (\d+)/);
    if (!match) {
      return;
    }

    const debugPid = await this.waitForNodeChildProcess(parseInt(match[1]));

    this.log.box(`Debugger is now available on process id ${debugPid}`);
  }

  async setupDevServer(
    adminPort: number,
    dependencies: DependencyVersions,
    backupFile?: string,
    remote?: string,
  ): Promise<void> {
    this.log.notice(`Setting up in ${this.profileDir}`);

    // create the configuration
    const config = {
      system: {
        memoryLimitMB: 0,
        hostname: `dev-${this.adapterName}-${hostname()}`,
        instanceStartInterval: 2000,
        compact: false,
        allowShellCommands: false,
        memLimitWarn: 100,
        memLimitError: 50,
      },
      multihostService: {
        enabled: false,
      },
      network: {
        IPv4: true,
        IPv6: false,
        bindAddress: '127.0.0.1',
        useSystemNpm: true,
      },
      objects: {
        type: 'file',
        host: '127.0.0.1',
        port: this.getPort(adminPort, OBJECTS_DB_PORT_OFFSET),
        noFileCache: false,
        maxQueue: 1000,
        connectTimeout: 2000,
        writeFileInterval: 5000,
        dataDir: '',
        options: {
          auth_pass: null,
          retry_max_delay: 5000,
          retry_max_count: 19,
          db: 0,
          family: 0,
        },
      },
      states: {
        type: 'file',
        host: '127.0.0.1',
        port: this.getPort(adminPort, STATES_DB_PORT_OFFSET),
        connectTimeout: 2000,
        writeFileInterval: 30000,
        dataDir: '',
        options: {
          auth_pass: null,
          retry_max_delay: 5000,
          retry_max_count: 19,
          db: 0,
          family: 0,
        },
      },
      log: {
        level: 'debug',
        maxDays: 7,
        noStdout: false,
        transport: {
          file1: {
            type: 'file',
            enabled: true,
            filename: 'log/iobroker',
            fileext: '.log',
            maxsize: null,
            maxFiles: null,
          },
        },
      },
      plugins: {},
      dataDir: '../../iobroker-data/',
    };
    const configFile = path.join('iobroker-data', 'iobroker.json');
    await this.target.writeJson(configFile, config, { spaces: 2 });

    // create the package file
    if (this.isJSController()) {
      // if this dev-server is used to debug JS-Controller, don't install a published version
      delete dependencies['iobroker.js-controller'];
    }
    const pkg = {
      name: `dev-server.${this.adapterName}`,
      version: '1.0.0',
      private: true,
      dependencies,
      'dev-server': {
        adminPort,
        remote,
      },
    };
    await this.target.writeJson('package.json', pkg, { spaces: 2 });

    await this.verifyIgnoreFiles();

    this.log.notice('Installing js-controller and admin...');
    await this.target.execBlocking('npm install --loglevel error --production');

    if (backupFile) {
      const fullPath = path.resolve(backupFile);
      this.log.notice(`Restoring backup from ${fullPath}`);
      if (this.target instanceof RemoteTarget) {
        const remoteFileName = 'backup.tgz';
        await this.target.uploadFile(fullPath, remoteFileName);
        await this.target.execBlocking(`${IOBROKER_COMMAND} restore "${remoteFileName}"`);
      } else {
        await this.target.execBlocking(`${IOBROKER_COMMAND} restore "${fullPath}"`);
      }
    }

    if (this.isJSController()) {
      await this.installLocalAdapter();
    }

    await this.uploadAndAddAdapter('admin');

    // reconfigure admin instance (only listen to local IP address)
    this.log.notice('Configure admin.0');
    await this.target.execBlocking(
      `${IOBROKER_COMMAND} set admin.0 --port ${this.getPort(adminPort, HIDDEN_ADMIN_PORT_OFFSET)} --bind 127.0.0.1`,
    );

    if (!this.isJSController()) {
      // install local adapter
      await this.installLocalAdapter();
      await this.uploadAndAddAdapter(this.adapterName);

      // installing any dependencies
      const { common } = await readJson(path.join(this.rootDir, 'io-package.json'));
      const adapterDeps = [
        ...this.getDependencies(common.dependencies),
        ...this.getDependencies(common.globalDependencies),
      ];
      this.log.debug(`Found ${adapterDeps.length} adapter dependencies`);
      for (const adapter of adapterDeps) {
        try {
          await this.installRepoAdapter(adapter);
        } catch (error) {
          this.log.debug(`Couldn't install iobroker.${adapter}: ${error}`);
        }
      }

      this.log.notice(`Stop ${this.adapterName}.0`);
      await this.target.execBlocking(`${IOBROKER_COMMAND} stop ${this.adapterName} 0`);
    }

    this.log.notice('Disable statistics reporting');
    await this.target.execBlocking(`${IOBROKER_COMMAND} object set system.config common.diag="none"`);

    this.log.notice('Disable license confirmation');
    await this.target.execBlocking(`${IOBROKER_COMMAND} object set system.config common.licenseConfirmed=true`);

    this.log.notice('Disable missing info adapter warning');
    await this.target.execBlocking(`${IOBROKER_COMMAND} object set system.config common.infoAdapterInstall=true`);

    this.log.notice('Set default log level for adapters to debug');
    await this.target.execBlocking(`${IOBROKER_COMMAND} object set system.config common.defaultLogLevel="debug"`);

    this.log.notice('Set adapter repository to beta');
    await this.target.execBlocking(`${IOBROKER_COMMAND} object set system.config common.activeRepo="beta"`);
  }

  private async verifyIgnoreFiles(): Promise<void> {
    this.log.notice(`Verifying .npmignore and .gitignore`);
    let relative = path.relative(this.rootDir, this.tempDir).replace('\\', '/');
    if (relative.startsWith('..')) {
      // the temporary directory is outside the root, so no worries!
      return;
    }
    if (!relative.endsWith('/')) {
      relative += '/';
    }
    const tempDirRegex = new RegExp(
      `\\s${this.escapeStringRegexp(relative)
        .replace(/[\\/]$/, '')
        .replace(/(\\\\|\/)/g, '[\\/]')}`,
    );
    const verifyFile = async (filename: string, command: string, allowStar: boolean): Promise<void> => {
      try {
        const { stdout, stderr } = await this.executor.getExecOutput(command, this.rootDir);
        if (stdout.match(tempDirRegex) || stderr.match(tempDirRegex)) {
          this.log.error(bold(`Your ${filename} doesn't exclude the temporary directory "${relative}"`));
          const choices = [];
          if (allowStar) {
            choices.push({
              message: `Add wildcard to ${filename} for ".*" (recommended)`,
              name: 'add-star',
            });
          }
          choices.push(
            {
              message: `Add "${relative}" to ${filename}`,
              name: 'add-explicit',
            },
            {
              message: `Abort setup`,
              name: 'abort',
            },
          );
          type Action = 'add-star' | 'add-explicit' | 'abort';
          let action: Action;
          try {
            const result = await prompt<{ action: Action }>({
              name: 'action',
              type: 'select',
              message: 'What would you like to do?',
              choices,
            });
            action = result.action;
          } catch (error) {
            action = 'abort';
          }
          if (action === 'abort') {
            return this.exit(-1);
          }
          const filepath = path.resolve(this.rootDir, filename);
          let content = '';
          if (existsSync(filepath)) {
            content = await readFile(filepath, { encoding: 'utf-8' });
          }
          const eol = content.match(/\r\n/) ? '\r\n' : content.match(/\n/) ? '\n' : EOL;
          if (action === 'add-star') {
            content = `# exclude all dot-files and directories${eol}.*${eol}${eol}${content}`;
          } else {
            content = `${content}${eol}${eol}# ioBroker dev-server${eol}${relative}${eol}`;
          }
          await writeFile(filepath, content);
        }
      } catch (error) {
        this.log.debug(`Couldn't check ${filename}: ${error}`);
      }
    };
    await verifyFile('.npmignore', 'npm pack --dry-run', true);
    await verifyFile('.gitignore', 'git status --short --untracked-files=all', false);
  }

  private async uploadAndAddAdapter(name: string): Promise<void> {
    // upload the already installed adapter
    await this.uploadAdapter(name);

    const command = `${IOBROKER_COMMAND} list instances`;
    const output = await this.target.getExecOutput(command);
    if (output.includes(`system.adapter.${name}.0 `)) {
      this.log.info(`Instance ${name}.0 already exists, not adding it again`);
      return;
    }

    // create an instance
    this.log.notice(`Add ${name}.0`);
    await this.target.execBlocking(`${IOBROKER_COMMAND} add ${name} 0`);
  }

  private async uploadAdapter(name: string): Promise<void> {
    this.log.notice(`Upload iobroker.${name}`);
    await this.target.execBlocking(`${IOBROKER_COMMAND} upload ${name}`);
  }

  private async installLocalAdapter(): Promise<void> {
    this.log.notice(`Install local iobroker.${this.adapterName}`);

    const pkg = await this.readPackageJson();
    if (pkg.scripts?.build) {
      this.executor.execSync('npm run build', this.rootDir);
    }

    const { stdout } = await this.executor.getExecOutput('npm pack', this.rootDir);
    const filename = stdout.trim();
    this.log.info(`Packed to ${filename}`);

    const fullPath = path.join(this.rootDir, filename);
    await this.target.execBlocking(`npm install "${fullPath}"`);

    await rimraf(fullPath);
  }

  private async installRepoAdapter(adapterName: string): Promise<void> {
    this.log.notice(`Install iobroker.${adapterName}`);
    await this.target.execBlocking(`${IOBROKER_COMMAND} install ${adapterName}`);
  }

  private async readDevServerConfig(): Promise<DevServerConfig | undefined> {
    try {
      const tempPkg = await readJson(path.join(this.profileDir, 'package.json'));
      return tempPkg['dev-server'] as DevServerConfig;
    } catch {
      return undefined;
    }
  }

  /**
   * This method is largely borrowed from ioBroker.js-controller/lib/tools.js
   * @param dependencies The global or local dependency list from io-package.json
   * @returns the list of adapters (without js-controller) found in the dependencies.
   */
  private getDependencies(dependencies: any): string[] {
    const adapters: string[] = [];
    if (Array.isArray(dependencies)) {
      dependencies.forEach((rule) => {
        if (typeof rule === 'string') {
          // No version given, all are okay
          adapters.push(rule);
        } else {
          // can be object containing single adapter or multiple
          Object.keys(rule)
            .filter((adapter) => !adapters.includes(adapter))
            .forEach((adapter) => adapters.push(adapter));
        }
      });
    } else if (typeof dependencies === 'string') {
      // its a single string without version requirement
      adapters.push(dependencies);
    } else if (dependencies) {
      adapters.push(...Object.keys(dependencies));
    }
    return adapters.filter((a) => a !== 'js-controller');
  }

  private escapeStringRegexp(value: string): string {
    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
  }

  private async exit(exitCode: number): Promise<never> {
    await this.executor.killAllChildren();
    await this.target.killAllChildren();
    process.exit(exitCode);
  }
}

(() => new DevServer())();
