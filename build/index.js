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
const mkdirAsync = util_1.promisify(fs.mkdir);
const writeFileAsync = util_1.promisify(fs.writeFile);
const TEMP_DIR_NAME = '.devserver';
const CORE_MODULE = 'iobroker.js-controller';
const IOBROKER_COMMAND = 'node node_modules/iobroker.js-controller/iobroker.js';
const HIDDEN_ADMIN_PORT = 18881;
const HIDDEN_BROWSER_SYNC_PORT = 18882;
class DevServer {
    constructor() { }
    async run() {
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
        }
        else {
            const tempDir = path.join(rootDir, TEMP_DIR_NAME);
            await this.installAndLaunch(tempDir, argv.adapter || this.findAdapterName(rootDir), argv.adminPort);
        }
    }
    findAdapterName(dir) {
        const pkg = this.readPackageJson(dir);
        const adapterName = pkg.name.split('.')[1];
        console.log(chalk.gray(`Found adapter name: "${adapterName}"`));
        return adapterName;
    }
    readPackageJson(dir) {
        const json = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
        return JSON.parse(json);
    }
    async runLocally(rootDir, adapter, adminPort) {
        console.log(chalk.gray(`Running inside ${rootDir}`));
        const proc = child_process_1.spawn('node', ['node_modules/iobroker.js-controller/controller.js'], {
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
        const app = express_1.default();
        const adminPattern = `/adapter/${adapter}/**`;
        // browser-sync proxy
        const pathRewrite = {};
        pathRewrite[`^/adapter/${adapter}/`] = '/';
        app.use(http_proxy_middleware_1.createProxyMiddleware([adminPattern, '/browser-sync/**'], {
            target: `http://localhost:${HIDDEN_BROWSER_SYNC_PORT}`,
            // ws: true,
            pathRewrite,
        }));
        // admin proxy
        app.use(http_proxy_middleware_1.createProxyMiddleware(`!${adminPattern}`, { target: `http://localhost:${HIDDEN_ADMIN_PORT}`, ws: true }));
        const server = app.listen(adminPort);
        console.log(chalk.green(`Admin is now reachable under http://localhost:${adminPort}/`));
    }
    startBrowserSync() {
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
    async installAndLaunch(tempDir, adapter, adminPort) {
        if (!fs.existsSync(path.join(tempDir, 'iobroker-data'))) {
            await this.install(tempDir, adapter);
        }
        console.log(chalk.gray(`Starting locally in ${tempDir}`));
        child_process_1.execSync(`node node_modules/iobroker-dev-server/build/index.js -a ${adapter} -p ${adminPort}`, {
            stdio: ['ignore', 'inherit', 'inherit'],
            cwd: tempDir,
        });
    }
    async install(tempDir, adapter) {
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
                hostname: `dev-${adapter}-${os_1.hostname()}`,
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
        const dependencies = {
            'iobroker.js-controller': 'latest',
            'iobroker.admin': 'latest',
            'iobroker.info': 'latest',
        };
        //dependencies[myPkg.name] = myPkg.version;
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
        child_process_1.execSync('npm install --loglevel error --production', {
            stdio: 'inherit',
            cwd: tempDir,
        });
        this.uploadAndAddAdapter('admin', tempDir);
        this.uploadAndAddAdapter('info', tempDir);
        // reconfigure admin instance (only listen to local IP address)
        console.log(chalk.blue('Configure admin.0'));
        child_process_1.execSync(`${IOBROKER_COMMAND} set admin.0 --port ${HIDDEN_ADMIN_PORT} --bind 127.0.0.1`, {
            stdio: 'inherit',
            cwd: tempDir,
        });
        console.log(chalk.blue(`Link local iobroker.${adapter}`));
        child_process_1.execSync('npm link', {
            stdio: 'inherit',
            cwd: path.join(tempDir, '..'),
        });
        child_process_1.execSync(`npm link iobroker.${adapter}`, {
            stdio: 'inherit',
            cwd: tempDir,
        });
        this.uploadAndAddAdapter(adapter, tempDir);
    }
    uploadAndAddAdapter(name, cwd) {
        // upload the already installed adapter
        console.log(chalk.blue(`Upload iobroker.${name}`));
        child_process_1.execSync(`${IOBROKER_COMMAND} upload ${name}`, {
            stdio: 'inherit',
            cwd: cwd,
        });
        // create an instance
        console.log(chalk.blue(`Add ${name}.0`));
        child_process_1.execSync(`${IOBROKER_COMMAND} add ${name} 0`, {
            stdio: 'inherit',
            cwd: cwd,
        });
    }
}
(() => new DevServer().run().catch((e) => {
    console.error(chalk.red(e));
    process.exit(-1);
}))();
