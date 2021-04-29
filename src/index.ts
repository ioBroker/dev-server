#!/usr/bin/env node

import yargs = require('yargs/yargs');
import browserSync from 'browser-sync';
import * as cp from 'child_process';
import chokidar from 'chokidar';
import express from 'express';
import fg from 'fast-glob';
import * as fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import nodemon from 'nodemon';
import { hostname } from 'os';
import * as path from 'path';
import psTree from 'ps-tree';
import { Mapping, RawSourceMap, SourceMapGenerator } from 'source-map';
import { promisify } from 'util';
import { Logger } from './logger';
import chalk = require('chalk');
import rimraf = require('rimraf');
import acorn = require('acorn');

const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const copyFileAsync = promisify(fs.copyFile);

const DEFAULT_TEMP_DIR_NAME = '.dev-server';
const CORE_MODULE = 'iobroker.js-controller';
const IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
const IOBROKER_COMMAND = `node ${IOBROKER_CLI}`;
const DEFAULT_ADMIN_PORT = 8081;
const HIDDEN_ADMIN_PORT_OFFSET = 12345;
const HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
const STATES_DB_PORT_OFFSET = 16345;
const OBJECTS_DB_PORT_OFFSET = 18345;

interface DevServerConfig {
  adminPort: number;
}

class DevServer {
  private readonly log = new Logger();
  private rootDir!: string;
  private adapterName!: string;
  private tempDir!: string;

  constructor() {
    yargs(process.argv.slice(2))
      .usage('Usage: $0 <command> [options]\n   or: $0 <command> --help   to see available options for a command')
      .command(
        ['setup', 's'],
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
          force: { type: 'boolean', hidden: true },
        },
        async (args) => await this.setup(args.adminPort, args.jsController, !!args.force),
      )
      .command(
        ['update', 'ud'],
        'Update ioBroker and its dependencies to the latest versions',
        {},
        async () => await this.update(),
      )
      .command(
        ['run', 'r', '*'],
        'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload',
        {},
        async () => await this.run(),
      )
      .command(
        ['watch', 'w'],
        'Run ioBroker dev-server and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.',
        {},
        async () => await this.watch(),
      )
      .command(
        ['debug', 'd'],
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
        ['upload', 'ul'],
        'Upload the current version of your adapter to the ioBroker dev-server. This is only required if you changed something relevant in your io-package.json',
        {},
        async () => await this.upload(),
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
      .check((argv) => {
        // console.log('check', argv);
        this.rootDir = path.resolve(argv.root);
        this.tempDir = path.resolve(this.rootDir, argv.temp);
        this.adapterName = this.findAdapterName();
        return true;
      })
      .help().argv;
  }

  private findAdapterName(): string {
    try {
      const ioPackage = this.readJson(path.join(this.rootDir, 'io-package.json'));
      const adapterName = ioPackage.common.name;
      this.log.debug(`Using adapter name "${adapterName}"`);
      return adapterName;
    } catch (error) {
      this.log.warn(error);
      this.log.error('You must run dev-server in the adapter root directory (where io-package.json resides).');
      process.exit(-1);
    }
  }

  private readJson(filename: string): any {
    const json = fs.readFileSync(filename, 'utf-8');
    return JSON.parse(json);
  }

  private readPackageJson(): any {
    return this.readJson(path.join(this.rootDir, 'package.json'));
  }

  private getPort(adminPort: number, offset: number): number {
    let port = adminPort + offset;
    if (port > 65000) {
      port -= 63000;
    }
    return port;
  }

  ////////////////// Command Handlers //////////////////

  async setup(adminPort: number, jsController: string, force: boolean): Promise<void> {
    if (force) {
      this.log.notice(`Deleting ${this.tempDir}`);
      await this.rimraf(this.tempDir);
    }

    if (this.isSetUp()) {
      this.log.error(`dev-server is already set up in "${this.tempDir}".`);
      this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
      return;
    }

    await this.setupDevServer(adminPort, jsController);

    this.log.box(`dev-server was sucessfully set up in ${this.tempDir}.`);
  }

  private async update(): Promise<void> {
    this.checkSetup();
    this.log.notice('Updating everything...');
    this.execSync('npm update --loglevel error', this.tempDir);
    await this.installLocalAdapter();
    this.uploadAdapter(this.adapterName);

    this.log.box(`dev-server was sucessfully updated.`);
  }

  async run(): Promise<void> {
    this.checkSetup();
    await this.startServer();
  }

  async watch(): Promise<void> {
    this.checkSetup();
    await this.installLocalAdapter();
    await this.startServer();
    await this.startAdapterWatch();
  }

  async debug(wait: boolean): Promise<void> {
    this.checkSetup();
    await this.installLocalAdapter();
    await this.copySourcemaps();
    await this.startServer();
    await this.startAdapterDebug(wait);
  }

  async upload(): Promise<void> {
    this.checkSetup();
    await this.installLocalAdapter();
    this.uploadAdapter(this.adapterName);

    this.log.box(`The latest content of iobroker.${this.adapterName} was uploaded to ${this.tempDir}.`);
  }

  ////////////////// Command Helper Methods //////////////////

  checkSetup(): void {
    if (!this.isSetUp()) {
      this.log.error(
        `dev-server is not set up in ${this.tempDir}.\nPlease use the command "setup" first to set up dev-server.`,
      );
      process.exit(-1);
    }
  }

  isSetUp(): boolean {
    const jsControllerDir = path.join(this.tempDir, 'node_modules', CORE_MODULE);
    return fs.existsSync(jsControllerDir);
  }

  async startServer(): Promise<void> {
    this.log.notice(`Running inside ${this.tempDir}`);

    const tempPkg = this.readJson(path.join(this.tempDir, 'package.json'));
    const config = tempPkg['dev-server'] as DevServerConfig;
    if (!config) {
      throw new Error(`Couldn't find dev-server configuration in package.json`);
    }

    const proc = this.spawn('node', ['node_modules/iobroker.js-controller/controller.js'], this.tempDir);
    proc.on('exit', (code) => {
      console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
      process.exit(-1);
    });

    // figure out if we need parcel (React)
    const pkg = this.readPackageJson();
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
    app.use(
      createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
        target: `http://localhost:${this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET)}`,
        ws: true,
      }),
    );

    // start express
    this.log.notice(`Starting web server on port ${config.adminPort}`);
    const server = app.listen(config.adminPort);

    process.on('SIGINT', () => {
      this.log.notice('dev-server is exiting...');
      server.close();
      // do not kill this process when receiving SIGINT, but let all child processes exit first
    });

    await new Promise<void>((resolve, reject) => {
      server.on('listening', resolve);
      server.on('error', reject);
      server.on('close', reject);
    });

    this.log.box(`Admin is now reachable under http://localhost:${config.adminPort}/`);
  }

  private async copySourcemaps(): Promise<void> {
    const outDir = path.join(this.tempDir, 'node_modules', `iobroker.${this.adapterName}`);
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
   * @param dest The path to the JavaScript file which will get a sourcemap attached.
   * @param copyFromSrc Set to true to copy the JavaScript file from src to dest (not just modify dest).
   */
  private async addSourcemap(src: string, dest: string, copyFromSrc: boolean): Promise<void> {
    try {
      const mapFile = `${dest}.map`;
      const data = await this.createIdentitySourcemap(src.replace(/\\/g, '/'));
      await writeFileAsync(mapFile, JSON.stringify(data));

      // append the sourcemap reference comment to the bottom of the file
      const fileContent = await readFileAsync(copyFromSrc ? src : dest, { encoding: 'utf-8' });
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

      await writeFileAsync(dest, updatedContent);
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
      const data = this.readJson(src);
      if (data.version !== 3) {
        throw new Error(`Unsupported sourcemap version: ${data.version}`);
      }
      data.sourceRoot = path.dirname(src).replace(/\\/g, '/');
      await writeFileAsync(dest, JSON.stringify(data));
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
    const fileContent = await readFileAsync(filename, { encoding: 'utf-8' });
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
      const mapping: Mapping = {
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
    await this.spawnAndAwaitOutput('npm', ['run', scriptName], this.rootDir, /(done in|watching (files )?for)/i, {
      shell: true,
    });
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
    const proc = this.spawn('node', args, this.tempDir);
    proc.on('exit', (code) => {
      console.error(chalk.yellow(`Adapter debugging exited with code ${code}`));
      process.exit(-1);
    });

    const debugPid = await this.waitForNodeChildProcess(proc.pid);

    this.log.box(`Debugger is now ${wait ? 'waiting' : 'available'} on process id ${debugPid}`);
  }

  private async waitForNodeChildProcess(parentPid: number): Promise<number | undefined> {
    const start = new Date().getTime();
    while (start + 2000 > new Date().getTime()) {
      const processes = await this.getChildProcesses(parentPid);
      const child = processes.find((p) => p.COMMAND.match(/node/i));
      if (child) {
        return parseInt(child.PID);
      }
    }

    this.log.debug(`No node child process of ${parentPid} found, assuming parent process was reused.`);
    return parentPid;
  }

  private getChildProcesses(parentPid: number): Promise<readonly psTree.PS[]> {
    return new Promise<readonly psTree.PS[]>((resolve, reject) =>
      psTree(parentPid, (err, children) => {
        if (err) {
          reject(err);
        } else {
          // fix for MacOS bug #11
          children.forEach((c: any) => {
            if (c.COMM && !c.COMMAND) {
              c.COMMAND = c.COMM;
            }
          });
          resolve(children);
        }
      }),
    );
  }

  private async startAdapterWatch(): Promise<void> {
    // figure out if we need to watch for TypeScript changes
    const pkg = this.readPackageJson();
    const scripts = pkg.scripts;
    if (scripts && scripts['watch:ts']) {
      // use TSC
      await this.startTscWatch();
    }

    // start sync
    const adapterRunDir = path.join(this.tempDir, 'node_modules', `iobroker.${this.adapterName}`);
    await this.startFileSync(adapterRunDir);

    this.startNodemon(adapterRunDir, pkg.main);
  }

  private async startTscWatch(): Promise<void> {
    this.log.notice('Starting tsc --watch');
    this.log.debug('Waiting for first successful tsc build...');
    await this.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], this.rootDir, /watching (files )?for/i, { shell: true });
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
          } else if (!fs.existsSync(inSrc(`${filename}.map`))) {
            // copy file and add sourcemap
            await this.addSourcemap(src, dest, true);
          } else {
            await copyFileAsync(src, dest);
          }
        } catch (error) {
          this.log.warn(`Couldn't sync ${filename}`);
        }
      };
      watcher.on('add', (filename: string) => {
        if (ready) {
          syncFile(filename);
        } else if (!filename.endsWith('map') && !fs.existsSync(inDest(filename))) {
          // ignore files during initial sync if they don't exist in the target directory
          ignoreFiles.push(filename);
        } else {
          this.log.debug(`Watching ${filename}`);
        }
      });
      watcher.on('change', (filename: string) => {
        if (!ignoreFiles.includes(filename)) {
          syncFile(filename);
        }
      });
      watcher.on('unlink', (filename: string) => {
        fs.unlinkSync(inDest(filename));
        const map = inDest(filename + '.map');
        if (fs.existsSync(map)) {
          fs.unlinkSync(map);
        }
      });
    });
  }

  private startNodemon(baseDir: string, scriptName: string): void {
    const script = path.resolve(baseDir, scriptName);
    this.log.notice(`Starting nodemon for ${script}`);

    let isExiting = false;
    process.on('SIGINT', () => {
      isExiting = true;
    });

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
      args: ['--debug', '0'],
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
        process.exit(-2);
      });
  }

  async handleNodemonDetailMsg(message: string): Promise<void> {
    const match = message.match(/child pid: (\d+)/);
    if (!match) {
      return;
    }

    const debigPid = await this.waitForNodeChildProcess(parseInt(match[1]));

    this.log.box(`Debugger is now available on process id ${debigPid}`);
  }

  async setupDevServer(adminPort: number, jsController: string): Promise<void> {
    this.log.notice(`Setting up in ${this.tempDir}`);
    if (!fs.existsSync(this.tempDir)) {
      await mkdirAsync(this.tempDir);
    }

    // create the data directory
    const dataDir = path.join(this.tempDir, 'iobroker-data');
    if (!fs.existsSync(dataDir)) {
      await mkdirAsync(dataDir);
    }

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
    await writeFileAsync(path.join(dataDir, 'iobroker.json'), JSON.stringify(config, null, 2));

    // create the package file
    const pkg = {
      name: `dev-server.${this.adapterName}`,
      version: '1.0.0',
      private: true,
      dependencies: {
        'iobroker.js-controller': jsController,
        'iobroker.admin': 'latest',
      },
      'dev-server': {
        adminPort: adminPort,
      },
    };
    await writeFileAsync(path.join(this.tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    this.log.notice('Installing js-controller and admin...');
    this.execSync('npm install --loglevel error --production', this.tempDir);

    this.uploadAndAddAdapter('admin');

    // reconfigure admin instance (only listen to local IP address)
    this.log.notice('Configure admin.0');
    this.execSync(
      `${IOBROKER_COMMAND} set admin.0 --port ${this.getPort(adminPort, HIDDEN_ADMIN_PORT_OFFSET)} --bind 127.0.0.1`,
      this.tempDir,
    );

    // install local adapter
    await this.installLocalAdapter();
    this.uploadAndAddAdapter(this.adapterName);

    this.log.notice(`Stop ${this.adapterName}.0`);
    this.execSync(`${IOBROKER_COMMAND} stop ${this.adapterName} 0`, this.tempDir);

    this.log.notice('Disable statistics reporting');
    this.execSync(`${IOBROKER_COMMAND} object set system.config common.diag="none"`, this.tempDir);

    this.log.notice('Disable license confirmation');
    this.execSync(`${IOBROKER_COMMAND} object set system.config common.licenseConfirmed=true`, this.tempDir);

    this.log.notice('Disable missing info adapter warning');
    this.execSync(`${IOBROKER_COMMAND} object set system.config common.infoAdapterInstall=true`, this.tempDir);
  }

  private uploadAndAddAdapter(name: string): void {
    // upload the already installed adapter
    this.uploadAdapter(name);

    // create an instance
    this.log.notice(`Add ${name}.0`);
    this.execSync(`${IOBROKER_COMMAND} add ${name} 0`, this.tempDir);
  }

  private uploadAdapter(name: string): void {
    this.log.notice(`Upload iobroker.${name}`);
    this.execSync(`${IOBROKER_COMMAND} upload ${name}`, this.tempDir);
  }

  private async installLocalAdapter(): Promise<void> {
    this.log.notice(`Install local iobroker.${this.adapterName}`);

    const command = 'npm pack';
    this.log.debug(`${this.rootDir}> ${command}`);
    const filename = cp.execSync(command, { cwd: this.rootDir, encoding: 'ascii' }).trim();
    this.log.info(`Packed to ${filename}`);

    const fullPath = path.join(this.rootDir, filename);
    this.execSync(`npm install --no-save "${fullPath}"`, this.tempDir);

    await this.rimraf(fullPath);
  }

  private execSync(command: string, cwd: string, options?: cp.ExecSyncOptionsWithBufferEncoding): Buffer {
    options = { cwd: cwd, stdio: 'inherit', ...options };
    this.log.debug(`${cwd}> ${command}`);
    return cp.execSync(command, options);
  }

  private spawn(command: string, args: ReadonlyArray<string>, cwd: string, options?: cp.SpawnOptions): cp.ChildProcess {
    this.log.debug(`${cwd}> ${command} ${args.join(' ')}`);
    const proc = cp.spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: cwd,
      ...options,
    });
    let alive = true;
    proc.on('exit', () => (alive = false));
    process.on('exit', () => alive && proc.kill());
    return proc;
  }

  private spawnAndAwaitOutput(
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
    awaitMsg: string | RegExp,
    options?: cp.SpawnOptions,
  ): Promise<cp.ChildProcess> {
    return new Promise<cp.ChildProcess>((resolve, reject) => {
      const proc = this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
      proc.stdout?.on('data', (data: Buffer) => {
        let str = data.toString('utf-8');
        str = str.replace(/\x1Bc/, ''); // filter the "clear screen" ANSI code (used by tsc)
        if (str) {
          str = str.trimEnd();
          console.log(str);
        }

        if (typeof awaitMsg === 'string') {
          if (str.includes(awaitMsg)) {
            resolve(proc);
          }
        } else {
          if (awaitMsg.test(str)) {
            resolve(proc);
          }
        }
      });
      proc.on('exit', (code) => reject(`Exited with ${code}`));
      process.on('SIGINT', () => {
        proc.kill();
        reject('SIGINT');
      });
    });
  }

  private rimraf(name: string): Promise<void> {
    return new Promise<void>((resolve, reject) => rimraf(name, (err) => (err ? reject(err) : resolve())));
  }
}

(() => new DevServer())();
