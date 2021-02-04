import yargs = require('yargs/yargs');
import { execSync, spawn } from 'child_process';
import express from 'express';
import * as fs from 'fs';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { hostname } from 'os';
import * as path from 'path';
import { promisify } from 'util';
import chalk = require('chalk');

const mkdirAsync = promisify(fs.mkdir);
const writeFileAsync = promisify(fs.writeFile);

const TEMP_DIR_NAME = '.devserver';
const CORE_MODULE = 'iobroker.js-controller';
const IOBROKER_COMMAND = 'node node_modules/iobroker.js-controller/iobroker.js';
const HIDDEN_ADMIN_PORT = 18881;
const HIDDEN_BROWSER_SYNC_PORT = 18882;

class DevServer {
  constructor() {}

  async run(): Promise<void> {
    const argv = yargs(process.argv.slice(2)).options({
      adapter: { type: 'string', alias: 'a' },
      adminPort: { type: 'number', default: 8081, alias: 'p' },
      forceInstall: { type: 'boolean', hidden: true },
      root: { type: 'string', alias: 'r', hidden: true, default: '.' },
    }).argv;
    //console.log('argv', argv);
    const rootDir = path.resolve(argv.root);

    const jsControllerDir = path.join(rootDir, 'node_modules', CORE_MODULE);

    if (!argv.forceInstall && fs.existsSync(jsControllerDir)) {
      await this.runLocally(rootDir, argv.adapter || this.findAdapterName(path.join(rootDir, '..')), argv.adminPort);
    } else {
      const tempDir = path.join(rootDir, TEMP_DIR_NAME);
      await this.installAndLaunch(tempDir, argv.adapter || this.findAdapterName(rootDir), argv.adminPort);
    }
  }

  private findAdapterName(dir: string): string {
    const pkg = this.readPackageJson(dir);
    const adapterName = pkg.name.split('.')[1];
    console.log(chalk.gray(`Found adapter name: "${adapterName}"`));
    return adapterName;
  }

  private readPackageJson(dir: string): any {
    const json = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
    return JSON.parse(json);
  }

  async runLocally(rootDir: string, adapter: string, adminPort: number): Promise<void> {
    console.log(chalk.gray(`Running inside ${rootDir}`));

    const proc = spawn('node', ['node_modules/iobroker.js-controller/controller.js'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: rootDir,
    });

    proc.on('exit', (code) => {
      console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
      process.exit(-1);
    });

    process.on('SIGINT', () => {
      server.close();
      // do not kill this process when receiving SIGINT, but let all child processes exit first
    });

    this.startBrowserSync();

    const app = express();

    const adminPattern = `/adapter/${adapter}/**`;

    // browser-sync proxy
    const pathRewrite: Record<string, string> = {};
    pathRewrite[`^/adapter/${adapter}/`] = '/';
    app.use(
      createProxyMiddleware([adminPattern, '/browser-sync/**'], {
        target: `http://localhost:${HIDDEN_BROWSER_SYNC_PORT}`,
        // ws: true,
        pathRewrite,
      }),
    );

    // admin proxy
    app.use(createProxyMiddleware(`!${adminPattern}`, { target: `http://localhost:${HIDDEN_ADMIN_PORT}`, ws: true }));
    const server = app.listen(adminPort);

    console.log(chalk.green(`Admin is now reachable under http://localhost:${adminPort}/`));
  }

  private startBrowserSync(): void {
    var bs = require('browser-sync').create();

    /**
     * Run Browsersync with server config
     */
    bs.init({
      server: { baseDir: '../admin', directory: true },
      port: HIDDEN_BROWSER_SYNC_PORT,
      open: false,
      ui: false,
      logLevel: 'silent',
      files: ['../admin/**'],
      plugins: [
        {
          module: 'bs-html-injector',
          options: {
            files: ['../admin/*.html'],
          },
        },
      ],
    });
  }

  async installAndLaunch(tempDir: string, adapter: string, adminPort: number): Promise<void> {
    if (!fs.existsSync(path.join(tempDir, 'iobroker-data'))) {
      await this.install(tempDir, adapter);
    }

    console.log(chalk.gray(`Starting locally in ${tempDir}`));
    execSync(`node node_modules/iobroker-dev-server/build/index.js -a ${adapter} -p ${adminPort}`, {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: tempDir,
    });
  }

  async install(tempDir: string, adapter: string): Promise<void> {
    console.log(chalk.blue(`Installing to ${tempDir}`));
    if (!fs.existsSync(tempDir)) {
      await mkdirAsync(tempDir);
    }

    // create the data directory
    const dataDir = path.join(tempDir, 'iobroker-data');
    if (!fs.existsSync(dataDir)) {
      await mkdirAsync(dataDir);
    }

    // create the configuration
    const config = {
      system: {
        memoryLimitMB: 0,
        hostname: `dev-${adapter}-${hostname()}`,
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
        port: 19901,
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
        port: 19900,
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
        noStdout: true,
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
    const myPkg = this.readPackageJson(path.join(__dirname, '..'));
    const dependencies: Record<string, string> = {
      'iobroker.js-controller': 'latest',
      'iobroker.admin': 'latest',
      'iobroker.info': 'latest',
    };
    dependencies[myPkg.name] = 'UncleSamSwiss/iobroker-dev-server'; //myPkg.version;
    const pkg = {
      name: 'unused__launcher',
      version: '1.0.0',
      private: true,
      dependencies,
      scripts: {
        devserver: 'iobroker-dev-server',
      },
    };
    await writeFileAsync(path.join(tempDir, 'package.json'), JSON.stringify(pkg, null, 2));

    console.log(chalk.blue('Installing everything...'));
    execSync('npm install --loglevel error --production', {
      stdio: 'inherit',
      cwd: tempDir,
    });

    this.uploadAndAddAdapter('admin', tempDir);
    this.uploadAndAddAdapter('info', tempDir);

    // reconfigure admin instance (only listen to local IP address)
    console.log(chalk.blue('Configure admin.0'));
    execSync(`${IOBROKER_COMMAND} set admin.0 --port ${HIDDEN_ADMIN_PORT} --bind 127.0.0.1`, {
      stdio: 'inherit',
      cwd: tempDir,
    });

    console.log(chalk.blue(`Link local iobroker.${adapter}`));
    execSync('npm link', {
      stdio: 'inherit',
      cwd: path.join(tempDir, '..'),
    });
    execSync(`npm link iobroker.${adapter}`, {
      stdio: 'inherit',
      cwd: tempDir,
    });
    this.uploadAndAddAdapter(adapter, tempDir);
  }

  private uploadAndAddAdapter(name: string, cwd: string) {
    // upload the already installed adapter
    console.log(chalk.blue(`Upload iobroker.${name}`));
    execSync(`${IOBROKER_COMMAND} upload ${name}`, {
      stdio: 'inherit',
      cwd: cwd,
    });

    // create an instance
    console.log(chalk.blue(`Add ${name}.0`));
    execSync(`${IOBROKER_COMMAND} add ${name} 0`, {
      stdio: 'inherit',
      cwd: cwd,
    });
  }
}

(() =>
  new DevServer().run().catch((e) => {
    console.error(chalk.red(e));
    process.exit(-1);
  }))();
