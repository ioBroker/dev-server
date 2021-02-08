#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const yargs = require("yargs/yargs");
const child_process_1 = require("child_process");
const express_1 = __importDefault(require("express"));
const fs = __importStar(require("fs"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const os_1 = require("os");
const path = __importStar(require("path"));
const util_1 = require("util");
const chalk = require("chalk");
const rimraf = require("rimraf");
const boxen = require("boxen");
const mkdirAsync = util_1.promisify(fs.mkdir);
const writeFileAsync = util_1.promisify(fs.writeFile);
const DEFAULT_TEMP_DIR_NAME = '.devserver';
const CORE_MODULE = 'iobroker.js-controller';
const IOBROKER_COMMAND = 'node node_modules/iobroker.js-controller/iobroker.js';
const DEFAULT_ADMIN_PORT = 8081;
const HIDDEN_ADMIN_PORT = 18881;
const HIDDEN_BROWSER_SYNC_PORT = 18882;
class DevServer {
    constructor() {
        this.runCommands = ['run', 'watch', 'debug'];
        const argv = yargs(process.argv.slice(2))
            .usage('Usage: $0 <command> [options]')
            .command(['install', 'i'], 'Install devserver in the current directory. This should always be called in the directory where the package.json file of your adapter is located.')
            .command(['update', 'ud'], 'Update devserver and its dependencies to the latest versions')
            .command(['run', 'r', '*'], 'Run ioBroker devserver, the adapter will not run, but you may test the Admin UI with hot-reload')
            .command('watch', 'Run ioBroker devserver and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.')
            .command('debug', 'Run ioBroker devserver and start the adapter from ioBroker in "debug" mode. You may attach a debugger to the running adapter.')
            .command(['upload', 'ul'], 'Upload the current version of your adapter to the devserver. This is only required if you changed something relevant in your io-package.json')
            .options({
            adapter: {
                type: 'string',
                alias: 'a',
                description: 'Overwrite the adapter name\n(by default the name is taken from package.json)',
            },
            adminPort: {
                type: 'number',
                default: DEFAULT_ADMIN_PORT,
                alias: 'p',
                description: 'TCP port on which ioBroker.admin will be available',
            },
            temp: {
                type: 'string',
                alias: 't',
                default: DEFAULT_TEMP_DIR_NAME,
                description: 'Directory where the local devserver will be installed',
            },
            jsController: {
                type: 'string',
                alias: 'j',
                default: 'latest',
                description: 'Define which version of js-controller to be used.\n(Only relavant for "install".)',
            },
            forceInstall: { type: 'boolean', hidden: true },
            root: { type: 'string', alias: 'r', hidden: true, default: '.' },
        })
            .check((argv) => {
            if (argv._.length === 0) {
                argv._.push('run');
            }
            // expand short command names
            this.runCommands.forEach((cmd) => {
                if (argv._.includes(cmd[0])) {
                    argv._.push(cmd);
                }
            });
            // ensure only one of the run commands is included
            this.runCommands.forEach((cmd) => {
                if (argv._.includes(cmd)) {
                    this.runCommands.forEach((other) => {
                        if (other !== cmd && argv._.includes(other)) {
                            throw new Error(`Can't combine ${cmd} and ${other}. You may only use one at a time.`);
                        }
                    });
                }
            });
            return true;
        })
            .help().argv;
        //console.log('argv', argv);
        this.argv = argv;
        this.rootDir = path.resolve(argv.root);
        this.adapterName = argv.adapter || this.findAdapterName();
        this.tempDir = path.resolve(this.rootDir, argv.temp);
    }
    async run() {
        if (this.argv.forceInstall) {
            console.log(chalk.blue(`Deleting ${this.tempDir}`));
            await this.rimraf(this.tempDir);
        }
        const jsControllerDir = path.join(this.tempDir, 'node_modules', CORE_MODULE);
        if (!fs.existsSync(jsControllerDir)) {
            await this.install();
        }
        else if (this.argv._.includes('install')) {
            console.log(chalk.red(`Devserver is already installed in "${this.tempDir}".`));
            console.log(`Use --force-install to reinstall from scratch.`);
        }
        if (this.argv._.includes('update')) {
            await this.update();
        }
        if (this.argv._.includes('upload')) {
            await this.installLocalAdapter();
            this.uploadAdapter(this.adapterName);
        }
        const runCommand = this.runCommands.find((c) => this.argv._.includes(c));
        if (runCommand) {
            await this.runServer(runCommand);
        }
    }
    findAdapterName() {
        const pkg = this.readPackageJson();
        const pkgName = pkg.name;
        const match = pkgName.match(/^iobroker\.(.+)$/);
        if (!match || !match[1]) {
            throw new Error(`Invalid package name in package.json: "${pkgName}"`);
        }
        const adapterName = match[1];
        console.log(chalk.gray(`Found adapter name: "${adapterName}"`));
        return adapterName;
    }
    readPackageJson() {
        const json = fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf-8');
        return JSON.parse(json);
    }
    async runServer(runCommand) {
        console.log(chalk.gray(`Running ${runCommand} inside ${this.tempDir}`));
        const proc = child_process_1.spawn('node', ['node_modules/iobroker.js-controller/controller.js'], {
            stdio: ['ignore', 'inherit', 'inherit'],
            cwd: this.tempDir,
        });
        process.on('beforeExit', () => proc.kill());
        proc.on('exit', (code) => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            process.exit(-1);
        });
        process.on('SIGINT', () => {
            server.close();
            // do not kill this process when receiving SIGINT, but let all child processes exit first
        });
        // figure out if we need parcel (React)
        const pkg = this.readPackageJson();
        const scripts = pkg.scripts;
        if (scripts && scripts['watch:parcel']) {
            // use parcel
            console.log(chalk.gray('Starting parcel'));
            await this.startParcel();
        }
        console.log(chalk.gray('Starting browser-sync'));
        this.startBrowserSync();
        // browser-sync proxy
        const app = express_1.default();
        const adminPattern = `/adapter/${this.adapterName}/**`;
        const pathRewrite = {};
        pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
        app.use(http_proxy_middleware_1.createProxyMiddleware([adminPattern, '/browser-sync/**'], {
            target: `http://localhost:${HIDDEN_BROWSER_SYNC_PORT}`,
            //ws: true, // can't have two web-socket connections proxying to different locations
            pathRewrite,
        }));
        // admin proxy
        app.use(http_proxy_middleware_1.createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
            target: `http://localhost:${HIDDEN_ADMIN_PORT}`,
            ws: true,
        }));
        const server = app.listen(this.argv.adminPort);
        server.on('listening', () => {
            console.log(boxen(chalk.green(`Admin is now reachable under http://localhost:${this.argv.adminPort}/`), {
                padding: 1,
                borderStyle: 'round',
            }));
        });
    }
    startParcel() {
        return new Promise((resolve, reject) => {
            var _a, _b;
            const proc = child_process_1.exec('npm run watch:parcel');
            (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
                console.log(data);
                if (data.includes(`Built in`)) {
                    resolve();
                }
            });
            (_b = proc.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
                console.error(data);
                reject();
            });
            process.on('beforeExit', () => proc.kill());
        });
    }
    startBrowserSync() {
        var bs = require('browser-sync').create();
        const adminPath = path.resolve(this.rootDir, 'admin/');
        const config = {
            server: { baseDir: adminPath, directory: true },
            port: HIDDEN_BROWSER_SYNC_PORT,
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
    async install() {
        console.log(chalk.blue(`Installing to ${this.tempDir}`));
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
                hostname: `dev-${this.adapterName}-${os_1.hostname()}`,
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
            name: `devserver.${this.adapterName}`,
            version: '1.0.0',
            private: true,
            dependencies: {
                'iobroker.js-controller': this.argv.jsController,
                'iobroker.admin': 'latest',
                'iobroker.info': 'latest',
            },
        };
        await writeFileAsync(path.join(this.tempDir, 'package.json'), JSON.stringify(pkg, null, 2));
        console.log(chalk.blue('Installing everything...'));
        this.execSync('npm install --loglevel error --production', this.tempDir);
        this.uploadAndAddAdapter('admin');
        this.uploadAndAddAdapter('info');
        // reconfigure admin instance (only listen to local IP address)
        console.log(chalk.blue('Configure admin.0'));
        this.execSync(`${IOBROKER_COMMAND} set admin.0 --port ${HIDDEN_ADMIN_PORT} --bind 127.0.0.1`, this.tempDir);
        // install local adapter
        await this.installLocalAdapter();
        this.uploadAndAddAdapter(this.adapterName);
        console.log(chalk.blue(`Stop ${this.adapterName}.0`));
        this.execSync(`${IOBROKER_COMMAND} stop ${this.adapterName} 0`, this.tempDir);
    }
    uploadAndAddAdapter(name) {
        // upload the already installed adapter
        this.uploadAdapter(name);
        // create an instance
        console.log(chalk.blue(`Add ${name}.0`));
        this.execSync(`${IOBROKER_COMMAND} add ${name} 0`, this.tempDir);
    }
    uploadAdapter(name) {
        console.log(chalk.blue(`Upload iobroker.${name}`));
        this.execSync(`${IOBROKER_COMMAND} upload ${name}`, this.tempDir);
    }
    async installLocalAdapter() {
        console.log(chalk.blue(`Install local iobroker.${this.adapterName}`));
        const command = 'npm pack';
        console.log(chalk.gray(`${this.rootDir}> ${command}`));
        const filename = child_process_1.execSync(command, { cwd: this.rootDir, encoding: 'ascii' }).trim();
        console.log(`Packed to ${filename}`);
        const fullPath = path.join(this.rootDir, filename);
        this.execSync(`npm install --no-save "${fullPath}"`, this.tempDir);
        await this.rimraf(fullPath);
    }
    async update() {
        console.log(chalk.blue('Updating everything...'));
        this.execSync('npm update --loglevel error', this.tempDir);
        await this.installLocalAdapter();
    }
    execSync(command, cwd, options) {
        options = { cwd: cwd, stdio: 'inherit', ...options };
        console.log(chalk.gray(`${cwd}> ${command}`));
        return child_process_1.execSync(command, options);
    }
    rimraf(name) {
        return new Promise((resolve, reject) => rimraf(name, (err) => (err ? reject(err) : resolve())));
    }
}
(() => new DevServer().run().catch((e) => {
    console.error(chalk.red(e));
    process.exit(-1);
}))();
