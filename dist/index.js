#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
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
const dbConnection_1 = require("@iobroker/testing/build/tests/integration/lib/dbConnection");
const axios_1 = __importDefault(require("axios"));
const browser_sync_1 = __importDefault(require("browser-sync"));
const chalk_1 = require("chalk");
const cp = __importStar(require("child_process"));
const enquirer_1 = require("enquirer");
const express_1 = __importDefault(require("express"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const fs_extra_1 = require("fs-extra");
const http_proxy_middleware_1 = require("http-proxy-middleware");
const net_1 = require("net");
const nodemon_1 = __importDefault(require("nodemon"));
const os_1 = require("os");
const path = __importStar(require("path"));
const ps_tree_1 = __importDefault(require("ps-tree"));
const semver_1 = require("semver");
const source_map_1 = require("source-map");
const ws_1 = __importDefault(require("ws"));
const jsonConfig_1 = require("./jsonConfig");
const logger_1 = require("./logger");
const chalk = require("chalk");
const rimraf = require("rimraf");
const acorn = require("acorn");
const EventEmitter = require("events");
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
class DevServer {
    constructor() {
        this.socketEvents = new EventEmitter();
        this.childProcesses = [];
        const parser = yargs(process.argv.slice(2));
        parser
            .usage('Usage: $0 <command> [options] [profile]\n   or: $0 <command> --help   to see available options for a command')
            .command(['setup [profile]', 's'], 'Set up dev-server in the current directory. This should always be called in the directory where the io-package.json file of your adapter is located.', {
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
            force: { type: 'boolean', hidden: true },
        }, async (args) => await this.setup(args.adminPort, { ['iobroker.js-controller']: args.jsController, ['iobroker.admin']: args.admin }, args.backupFile, !!args.force))
            .command(['update [profile]', 'ud'], 'Update ioBroker and its dependencies to the latest versions', {}, async () => await this.update())
            .command(['run [profile]', 'r'], 'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload', {}, async () => await this.run())
            .command(['watch [profile]', 'w'], 'Run ioBroker dev-server and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.', {
            noStart: {
                type: 'boolean',
                alias: 'n',
                description: 'Do not start the adapter itself, only watch for changes and sync them.',
            },
            noInstall: {
                type: 'boolean',
                alias: 'x',
                description: 'Do not build and install the adapter before starting.',
            },
            doNotWatch: {
                type: 'string',
                alias: 'w',
                description: 'Do not watch the given files or directories for changes (provide paths relative to the adapter base directory.',
            },
        }, async (args) => await this.watch(!args.noStart, !!args.noInstall, args.doNotWatch))
            .command(['debug [profile]', 'd'], 'Run ioBroker dev-server and start the adapter from ioBroker in "debug" mode. You may attach a debugger to the running adapter.', {
            wait: {
                type: 'boolean',
                alias: 'w',
                description: 'Start the adapter only once the debugger is attached.',
            },
            noInstall: {
                type: 'boolean',
                alias: 'x',
                description: 'Do not build and install the adapter before starting.',
            },
        }, async (args) => await this.debug(!!args.wait, !!args.noInstall))
            .command(['upload [profile]', 'ul'], 'Upload the current version of your adapter to the ioBroker dev-server. This is only required if you changed something relevant in your io-package.json', {}, async () => await this.upload())
            .command(['backup <filename> [profile]', 'b'], 'Create an ioBroker backup to the given file.', {}, async (args) => await this.backup(args.filename))
            .command(['profile', 'p'], 'List all dev-server profiles that exist in the current directory.', {}, async () => await this.profile())
            .options({
            temp: {
                type: 'string',
                alias: 't',
                default: DEFAULT_TEMP_DIR_NAME,
                description: 'Temporary directory where the dev-server data will be located',
            },
            root: { type: 'string', alias: 'r', hidden: true, default: '.' },
            verbose: { type: 'boolean', hidden: true, default: false },
        })
            .middleware(async (argv) => await this.setLogger(argv))
            .middleware(async () => await this.checkVersion())
            .middleware(async (argv) => await this.setDirectories(argv))
            .wrap(Math.min(100, parser.terminalWidth()))
            .help().argv;
    }
    async setLogger(argv) {
        this.log = new logger_1.Logger(argv.verbose ? 'silly' : 'debug');
    }
    async checkVersion() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { name, version: localVersion } = require('../package.json');
            const { data: { version: releaseVersion }, } = await axios_1.default.get(`https://cdn.jsdelivr.net/npm/${name}/package.json`, { timeout: 1000 });
            if ((0, semver_1.gt)(releaseVersion, localVersion)) {
                this.log.debug(`Found update from ${localVersion} to ${releaseVersion}`);
                const response = await (0, enquirer_1.prompt)({
                    name: 'update',
                    type: 'confirm',
                    message: `Version ${releaseVersion} of ${name} is available.\nWould you like to exit and update?`,
                    initial: true,
                });
                if (response.update) {
                    this.log.box(`Please update ${name} manually and restart your last command afterwards.\n` +
                        `If you installed ${name} globally, you can simply call:\n\nnpm install --global ${name}`);
                    return this.exit(0);
                }
                else {
                    this.log.warn(`We strongly recommend to update ${name} as soon as possible.`);
                }
            }
        }
        catch (error) { }
    }
    async setDirectories(argv) {
        this.rootDir = path.resolve(argv.root);
        this.tempDir = path.resolve(this.rootDir, argv.temp);
        if ((0, fs_extra_1.existsSync)(path.join(this.tempDir, 'package.json'))) {
            // we are still in the old directory structure (no profiles), let's move it
            const intermediateDir = path.join(this.rootDir, DEFAULT_TEMP_DIR_NAME + '-temp');
            const defaultProfileDir = path.join(this.tempDir, DEFAULT_PROFILE_NAME);
            this.log.debug(`Moving temporary data from ${this.tempDir} to ${defaultProfileDir}`);
            await (0, fs_extra_1.rename)(this.tempDir, intermediateDir);
            await (0, fs_extra_1.mkdir)(this.tempDir);
            await (0, fs_extra_1.rename)(intermediateDir, defaultProfileDir);
        }
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
        }
        else {
            if (argv._.includes('profile') || argv._.includes('p')) {
                // we don't care about the profile name
                profileName = DEFAULT_PROFILE_NAME;
            }
            else {
                if (profileNames.length === 0) {
                    profileName = DEFAULT_PROFILE_NAME;
                    this.log.debug(`Using default profile ${profileName}`);
                }
                else if (profileNames.length === 1) {
                    profileName = profileNames[0];
                    this.log.debug(`Using profile ${profileName}`);
                }
                else {
                    this.log.box((0, chalk_1.yellow)(`You didn't specify the profile name in the command line. ` +
                        `You may do so the next time by appending the profile name to your command.\nExample:\n` +
                        `> dev-server ${process.argv.slice(2).join(' ')} ${profileNames[profileNames.length - 1]} `));
                    const response = await (0, enquirer_1.prompt)({
                        name: 'profile',
                        type: 'select',
                        message: 'Please choose a profile',
                        choices: profileNames.map((p) => ({
                            name: p,
                            hint: (0, chalk_1.gray)(`(Admin Port: ${profiles[p]['dev-server'].adminPort})`),
                        })),
                    });
                    profileName = response.profile;
                }
            }
        }
        if (!profileName.match(/^[a-z0-9_-]+$/i)) {
            throw new Error(`Invaid profile name: "${profileName}", it may only contain a-z, 0-9, _ and -.`);
        }
        this.profileName = profileName;
        this.log.debug(`Using profile name "${this.profileName}"`);
        this.profileDir = path.join(this.tempDir, profileName);
        this.adapterName = await this.findAdapterName();
    }
    async findAdapterName() {
        try {
            const ioPackage = await (0, fs_extra_1.readJson)(path.join(this.rootDir, 'io-package.json'));
            const adapterName = ioPackage.common.name;
            this.log.debug(`Using adapter name "${adapterName}"`);
            return adapterName;
        }
        catch (error) {
            this.log.warn(error);
            this.log.error('You must run dev-server in the adapter root directory (where io-package.json resides).');
            return this.exit(-1);
        }
    }
    isJSController() {
        return this.adapterName === 'js-controller';
    }
    readPackageJson() {
        return (0, fs_extra_1.readJson)(path.join(this.rootDir, 'package.json'));
    }
    getPort(adminPort, offset) {
        let port = adminPort + offset;
        if (port > 65000) {
            port -= 63000;
        }
        return port;
    }
    ////////////////// Command Handlers //////////////////
    async setup(adminPort, dependencies, backupFile, force) {
        if (force) {
            this.log.notice(`Deleting ${this.profileDir}`);
            await this.rimraf(this.profileDir);
        }
        if (this.isSetUp()) {
            this.log.error(`dev-server is already set up in "${this.profileDir}".`);
            this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
            return;
        }
        await this.setupDevServer(adminPort, dependencies, backupFile);
        const commands = ['run', 'watch', 'debug'];
        this.log.box(`dev-server was sucessfully set up in\n${this.profileDir}.\n\n` +
            `You may now execute one of the following commands\n\n${commands
                .map((command) => `dev-server ${command} ${this.profileName}`)
                .join('\n')}\n\nto use dev-server.`);
    }
    async update() {
        await this.checkSetup();
        this.log.notice('Updating everything...');
        this.execSync('npm update --loglevel error', this.profileDir);
        this.uploadAdapter('admin');
        await this.buildLocalAdapter();
        await this.installLocalAdapter();
        if (!this.isJSController())
            this.uploadAdapter(this.adapterName);
        this.log.box(`dev-server was sucessfully updated.`);
    }
    async run() {
        await this.checkSetup();
        await this.startJsController();
        await this.startServer();
    }
    async watch(startAdapter, noInstall, doNotWatch) {
        let doNotWatchArr = [];
        if (typeof doNotWatch === 'string') {
            doNotWatchArr.push(doNotWatch);
        }
        else if (Array.isArray(doNotWatch)) {
            doNotWatchArr = doNotWatch;
        }
        await this.checkSetup();
        if (!noInstall) {
            await this.buildLocalAdapter();
            // await this.installLocalAdapter();
        }
        if (this.isJSController()) {
            // this watches actually js-controller
            await this.startAdapterWatch(startAdapter, doNotWatchArr);
            await this.startServer();
        }
        else {
            await this.startJsController();
            await this.startServer();
            await this.startAdapterWatch(startAdapter, doNotWatchArr);
        }
    }
    async debug(wait, noInstall) {
        await this.checkSetup();
        if (!noInstall) {
            await this.buildLocalAdapter();
            await this.installLocalAdapter();
        }
        await this.copySourcemaps();
        if (this.isJSController()) {
            await this.startJsControllerDebug(wait);
            await this.startServer();
        }
        else {
            await this.startJsController();
            await this.startServer();
            await this.startAdapterDebug(wait);
        }
    }
    async upload() {
        await this.checkSetup();
        await this.buildLocalAdapter();
        await this.installLocalAdapter();
        if (!this.isJSController())
            this.uploadAdapter(this.adapterName);
        this.log.box(`The latest content of iobroker.${this.adapterName} was uploaded to ${this.profileDir}.`);
    }
    async backup(filename) {
        const fullPath = path.resolve(filename);
        this.log.notice('Creating backup');
        this.execSync(`${IOBROKER_COMMAND} backup "${fullPath}"`, this.profileDir);
    }
    async profile() {
        const profiles = await this.getProfiles();
        const table = Object.keys(profiles).map((name) => {
            const pkg = profiles[name];
            const infos = pkg['dev-server'];
            const dependencies = pkg.dependencies;
            return [
                name,
                `http://127.0.0.1:${infos.adminPort}`,
                dependencies['iobroker.js-controller'],
                dependencies['iobroker.admin'],
            ];
        });
        table.unshift([(0, chalk_1.bold)('Profile Name'), (0, chalk_1.bold)('Admin URL'), (0, chalk_1.bold)('js-controller'), (0, chalk_1.bold)('admin')]);
        this.log.info(`The following profiles exist in ${this.tempDir}`);
        this.log.table(table.filter((r) => !!r));
    }
    ////////////////// Command Helper Methods //////////////////
    async getProfiles() {
        if (!(0, fs_extra_1.existsSync)(this.tempDir)) {
            return {};
        }
        const entries = await (0, fs_extra_1.readdir)(this.tempDir);
        const pkgs = await Promise.all(entries.map(async (e) => {
            try {
                const pkg = await (0, fs_extra_1.readJson)(path.join(this.tempDir, e, 'package.json'));
                const infos = pkg['dev-server'];
                const dependencies = pkg.dependencies;
                if ((infos === null || infos === void 0 ? void 0 : infos.adminPort) && dependencies) {
                    return [e, pkg];
                }
            }
            catch (_a) {
                return undefined;
            }
        }, {}));
        return pkgs.filter((p) => !!p).reduce((old, [e, pkg]) => ({ ...old, [e]: pkg }), {});
    }
    async checkSetup() {
        if (!this.isSetUp()) {
            this.log.error(`dev-server is not set up in ${this.profileDir}.\nPlease use the command "setup" first to set up dev-server.`);
            return this.exit(-1);
        }
    }
    isSetUp() {
        const jsControllerDir = path.join(this.profileDir, 'node_modules', CORE_MODULE);
        return (0, fs_extra_1.existsSync)(jsControllerDir);
    }
    checkPort(port, host = '127.0.0.1', timeout = 1000) {
        return new Promise((resolve, reject) => {
            const socket = new net_1.Socket();
            const onError = () => {
                socket.destroy();
                reject();
            };
            socket.setTimeout(timeout);
            socket.once('error', onError);
            socket.once('timeout', onError);
            socket.connect(port, host, () => {
                socket.end();
                resolve();
            });
        });
    }
    async waitForPort(port, offset = 0) {
        port = this.getPort(port, offset);
        this.log.debug(`Waiting for port ${port} to be available...`);
        let tries = 0;
        while (true) {
            try {
                await this.checkPort(port);
                this.log.debug(`Port ${port} is available...`);
                return true;
            }
            catch (_a) {
                if (tries++ > 30) {
                    this.log.error(`Port ${port} is not available after 30 seconds.`);
                    return false;
                }
                await this.delay(1000);
            }
        }
    }
    async waitForJsController() {
        const tempPkg = await (0, fs_extra_1.readJson)(path.join(this.profileDir, 'package.json'));
        const config = tempPkg['dev-server'];
        if (!config) {
            throw new Error(`Couldn't find dev-server configuration in package.json`);
        }
        if (!(await this.waitForPort(config.adminPort, OBJECTS_DB_PORT_OFFSET)) ||
            !(await this.waitForPort(config.adminPort, STATES_DB_PORT_OFFSET))) {
            throw new Error(`Couldn't start js-controller`);
        }
    }
    async startJsController() {
        const proc = await this.spawn('node', [
            '--inspect=127.0.0.1:9228',
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            'node_modules/iobroker.js-controller/controller.js',
        ], this.profileDir);
        proc.on('exit', async (code) => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1, 'SIGKILL');
        });
        this.log.notice('Waiting for js-controller to start...');
        await this.waitForJsController();
    }
    async startJsControllerDebug(wait) {
        this.log.notice(`Starting debugger for ${this.adapterName}`);
        const nodeArgs = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            'node_modules/iobroker.js-controller/controller.js',
        ];
        if (wait) {
            nodeArgs.unshift('--inspect-brk');
        }
        else {
            nodeArgs.unshift('--inspect');
        }
        const proc = await this.spawn('node', nodeArgs, this.profileDir);
        proc.on('exit', (code) => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1);
        });
        await this.waitForJsController();
        this.log.box(`Debugger is now ${wait ? 'waiting' : 'available'} on process id ${proc.pid}`);
    }
    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async startServer() {
        this.log.notice(`Running inside ${this.profileDir}`);
        const tempPkg = await (0, fs_extra_1.readJson)(path.join(this.profileDir, 'package.json'));
        const config = tempPkg['dev-server'];
        if (!config) {
            throw new Error(`Couldn't find dev-server configuration in package.json`);
        }
        const hiddenAdminPort = this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET);
        await this.waitForPort(hiddenAdminPort);
        const app = (0, express_1.default)();
        if (this.isJSController()) {
            // simply forward admin as-is
            app.use((0, http_proxy_middleware_1.createProxyMiddleware)({
                target: `http://127.0.0.1:${hiddenAdminPort}`,
                ws: true,
            }));
        }
        else if ((0, fs_extra_1.existsSync)(path.resolve(this.rootDir, 'admin/jsonConfig.json'))) {
            // JSON config
            await this.createJsonConfigProxy(app, config);
        }
        else {
            // HTML or React config
            await this.createHtmlConfigProxy(app, config);
        }
        // start express
        this.log.notice(`Starting web server on port ${config.adminPort}`);
        const server = app.listen(config.adminPort);
        let exiting = false;
        process.on('SIGINT', async () => {
            this.log.notice('dev-server is exiting...');
            exiting = true;
            server.close();
            // do not kill this process when receiving SIGINT, but let all child processes exit first
        });
        await new Promise((resolve, reject) => {
            server.on('listening', resolve);
            server.on('error', reject);
            server.on('close', reject);
        });
        if (!this.isJSController()) {
            const connectWebSocketClient = () => {
                if (exiting)
                    return;
                // TODO: replace this with @iobroker/socket-client
                this.websocket = new ws_1.default(`ws://127.0.0.1:${hiddenAdminPort}/?sid=${Date.now()}&name=admin`);
                this.websocket.on('open', () => this.log.silly('WebSocket open'));
                this.websocket.on('close', () => {
                    this.log.silly('WebSocket closed');
                    this.websocket = undefined;
                    setTimeout(connectWebSocketClient, 1000);
                });
                this.websocket.on('error', (error) => this.log.silly(`WebSocket error: ${error}`));
                this.websocket.on('message', (msg) => {
                    var _a;
                    const msgString = msg && typeof msg !== 'string' ? msg.toString() : null;
                    if (typeof msgString === 'string') {
                        try {
                            const data = JSON.parse(msgString);
                            if (!Array.isArray(data) || data.length === 0)
                                return;
                            switch (data[0]) {
                                case 0:
                                    if (data.length > 3) {
                                        this.socketEvents.emit(data[2], data[3]);
                                    }
                                    break;
                                case 1:
                                    // ping received, send pong (keep-alive)
                                    (_a = this.websocket) === null || _a === void 0 ? void 0 : _a.send('[2]');
                                    break;
                            }
                        }
                        catch (error) {
                            this.log.error(`Couldn't handle WebSocket message: ${error}`);
                        }
                    }
                });
            };
            connectWebSocketClient();
        }
        this.log.box(`Admin is now reachable under http://127.0.0.1:${config.adminPort}/`);
    }
    async createJsonConfigProxy(app, config) {
        const browserSyncPort = this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET);
        const bs = this.startBrowserSync(browserSyncPort, false);
        // whenever jsonConfig.json changes, we upload the new file
        const jsonConfig = path.resolve(this.rootDir, 'admin/jsonConfig.json');
        bs.watch(jsonConfig, undefined, async (e) => {
            var _a;
            if (e === 'change') {
                const content = await (0, fs_extra_1.readFile)(jsonConfig);
                (_a = this.websocket) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify([
                    3,
                    46,
                    'writeFile',
                    [`${this.adapterName}.admin`, 'jsonConfig.json', Buffer.from(content).toString('base64')],
                ]));
            }
        });
        // "proxy" for the main page which injects our script
        const adminUrl = `http://127.0.0.1:${this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET)}`;
        app.get('/', async (_req, res) => {
            const { data } = await axios_1.default.get(adminUrl);
            res.send((0, jsonConfig_1.injectCode)(data, this.adapterName));
        });
        // browser-sync proxy
        app.use((0, http_proxy_middleware_1.createProxyMiddleware)(['/browser-sync/**'], {
            target: `http://127.0.0.1:${browserSyncPort}`,
            //ws: true, // can't have two web-socket connections proxying to different locations
        }));
        // admin proxy
        app.use((0, http_proxy_middleware_1.createProxyMiddleware)({
            target: adminUrl,
            ws: true,
        }));
    }
    async createHtmlConfigProxy(app, config) {
        const pathRewrite = {};
        // figure out if we need to watch the React build
        let hasReact = false;
        if (!this.isJSController()) {
            const pkg = await this.readPackageJson();
            const scripts = pkg.scripts;
            if (scripts) {
                if (scripts['watch:react']) {
                    await this.startReact('watch:react');
                    hasReact = true;
                    if ((0, fs_extra_1.existsSync)(path.resolve(this.rootDir, 'admin/.watch'))) {
                        // rewrite the build directory to the .watch directory,
                        // because "watch:react" no longer updates the build directory automatically
                        pathRewrite[`^/adapter/${this.adapterName}/build/`] = '/.watch/';
                    }
                }
                else if (scripts['watch:parcel']) {
                    // use React with legacy script name
                    await this.startReact('watch:parcel');
                    hasReact = true;
                }
            }
        }
        const browserSyncPort = this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET);
        this.startBrowserSync(browserSyncPort, hasReact);
        // browser-sync proxy
        const adminPattern = `/adapter/${this.adapterName}/**`;
        pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
        app.use((0, http_proxy_middleware_1.createProxyMiddleware)([adminPattern, '/browser-sync/**'], {
            target: `http://127.0.0.1:${browserSyncPort}`,
            //ws: true, // can't have two web-socket connections proxying to different locations
            pathRewrite,
        }));
        // admin proxy
        app.use((0, http_proxy_middleware_1.createProxyMiddleware)([`!${adminPattern}`, '!/browser-sync/**'], {
            target: `http://127.0.0.1:${this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET)}`,
            ws: true,
        }));
    }
    async copySourcemaps() {
        const outDir = path.join(this.profileDir, 'node_modules', `iobroker.${this.adapterName}`);
        this.log.notice(`Creating or patching sourcemaps in ${outDir}`);
        const sourcemaps = await this.findFiles('map', true);
        if (sourcemaps.length === 0) {
            this.log.debug(`Couldn't find any sourcemaps in ${this.rootDir},\nwill try to reverse map .js files`);
            // search all .js files that exist in the node module in the temp directory as well as in the root directory and
            // create sourcemap files for each of them
            const jsFiles = await this.findFiles('js', true);
            await Promise.all(jsFiles.map(async (js) => {
                const src = path.join(this.rootDir, js);
                const dest = path.join(outDir, js);
                await this.addSourcemap(src, dest, false);
            }));
            return;
        }
        // copy all *.map files to the node module in the temp directory and
        // change their sourceRoot so they can be found in the development directory
        await Promise.all(sourcemaps.map(async (sourcemap) => {
            const src = path.join(this.rootDir, sourcemap);
            const dest = path.join(outDir, sourcemap);
            await this.patchSourcemap(src, dest);
        }));
    }
    /**
     * Create an identity sourcemap to point to a different source file.
     * @param src The path to the original JavaScript file.
     * @param dest The path to the JavaScript file which will get a sourcemap attached.
     * @param copyFromSrc Set to true to copy the JavaScript file from src to dest (not just modify dest).
     */
    async addSourcemap(src, dest, copyFromSrc) {
        try {
            const mapFile = `${dest}.map`;
            const data = await this.createIdentitySourcemap(src.replace(/\\/g, '/'));
            await (0, fs_extra_1.writeFile)(mapFile, JSON.stringify(data));
            // append the sourcemap reference comment to the bottom of the file
            const fileContent = await (0, fs_extra_1.readFile)(copyFromSrc ? src : dest, { encoding: 'utf-8' });
            const filename = path.basename(mapFile);
            let updatedContent = fileContent.replace(/(\/\/# sourceMappingURL=).+/, `$1${filename}`);
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
            await (0, fs_extra_1.writeFile)(dest, updatedContent);
            this.log.debug(`Created ${mapFile} from ${src}`);
        }
        catch (error) {
            this.log.warn(`Couldn't reverse map for ${src}: ${error}`);
        }
    }
    /**
     * Patch an existing sourcemap file.
     * @param src The path to the original sourcemap file to patch and copy.
     * @param dest The path to the sourcemap file that is created.
     */
    async patchSourcemap(src, dest) {
        try {
            const data = await (0, fs_extra_1.readJson)(src);
            if (data.version !== 3) {
                throw new Error(`Unsupported sourcemap version: ${data.version}`);
            }
            data.sourceRoot = path.dirname(src).replace(/\\/g, '/');
            await (0, fs_extra_1.writeJson)(dest, data);
            this.log.debug(`Patched ${dest} from ${src}`);
        }
        catch (error) {
            this.log.warn(`Couldn't patch ${dest}: ${error}`);
        }
    }
    getFilePatterns(extensions, excludeAdmin) {
        const exts = typeof extensions === 'string' ? [extensions] : extensions;
        const patterns = exts.map((e) => `./**/*.${e}`);
        patterns.push('!./.*/**');
        patterns.push('!./**/node_modules/**');
        patterns.push('!./test/**');
        if (excludeAdmin) {
            patterns.push('!./admin/**');
        }
        return patterns;
    }
    async findFiles(extension, excludeAdmin) {
        return await (0, fast_glob_1.default)(this.getFilePatterns(extension, excludeAdmin), { cwd: this.rootDir });
    }
    async createIdentitySourcemap(filename) {
        // thanks to https://github.com/gulp-sourcemaps/identity-map/blob/251b51598d02e5aedaea8f1a475dfc42103a2727/lib/generate.js [MIT]
        const generator = new source_map_1.SourceMapGenerator({ file: filename });
        const fileContent = await (0, fs_extra_1.readFile)(filename, { encoding: 'utf-8' });
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
    async startReact(scriptName) {
        this.log.notice('Starting React build');
        this.log.debug('Waiting for first successful React build...');
        await this.spawnAndAwaitOutput('npm', ['run', scriptName], this.rootDir, /(built in|done in|watching (files )?for)/i, {
            shell: true,
        });
    }
    startBrowserSync(port, hasReact) {
        this.log.notice('Starting browser-sync');
        const bs = browser_sync_1.default.create();
        const adminPath = path.resolve(this.rootDir, 'admin/');
        const config = {
            server: { baseDir: adminPath, directory: true },
            port: port,
            open: false,
            ui: false,
            logLevel: 'info',
            reloadDelay: hasReact ? 500 : 0,
            reloadDebounce: hasReact ? 500 : 0,
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
        return bs;
    }
    async startAdapterDebug(wait) {
        this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
        const args = ['--preserve-symlinks', '--preserve-symlinks-main', IOBROKER_CLI, 'debug', `${this.adapterName}.0`];
        if (wait) {
            args.push('--wait');
        }
        const proc = await this.spawn('node', args, this.profileDir);
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
    async waitForNodeChildProcess(parentPid) {
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
    getChildProcesses(parentPid) {
        return new Promise((resolve, reject) => (0, ps_tree_1.default)(parentPid, (err, children) => {
            if (err) {
                reject(err);
            }
            else {
                // fix for MacOS bug #11
                children.forEach((c) => {
                    if (c.COMM && !c.COMMAND) {
                        c.COMMAND = c.COMM;
                    }
                });
                resolve(children);
            }
        }));
    }
    async startAdapterWatch(startAdapter, doNotWatch) {
        // figure out if we need to watch for TypeScript changes
        const pkg = await this.readPackageJson();
        const scripts = pkg.scripts;
        if (scripts && scripts['watch:ts']) {
            // use TSC
            await this.startTscWatch();
        }
        // // start sync
        const adapterRunDir = path.join(this.profileDir, 'node_modules', `iobroker.${this.adapterName}`);
        // await this.startFileSync(adapterRunDir);
        if (startAdapter) {
            await this.delay(3000);
            await this.startNodemon(adapterRunDir, pkg.main, doNotWatch);
        }
        else {
            this.log.box(`You can now start the adapter manually by running\n    ` +
                `node node_modules/iobroker.${this.adapterName}/${pkg.main} --debug 0\nfrom within\n    ` +
                this.profileDir);
        }
    }
    async startTscWatch() {
        this.log.notice('Starting tsc --watch');
        this.log.debug('Waiting for first successful tsc build...');
        await this.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], this.rootDir, /watching (files )?for/i, { shell: true });
    }
    // private startFileSync(destinationDir: string): Promise<void> {
    //   this.log.notice(`Starting file system sync from ${this.rootDir}`);
    //   const inSrc = (filename: string): string => path.join(this.rootDir, filename);
    //   const inDest = (filename: string): string => path.join(destinationDir, filename);
    //   return new Promise<void>((resolve, reject) => {
    //     const patterns = this.getFilePatterns(['js', 'map'], true);
    //     const ignoreFiles = [] as string[];
    //     const watcher = chokidar.watch(patterns, { cwd: this.rootDir });
    //     let ready = false;
    //     let initialEventPromises: Promise<void>[] = [];
    //     watcher.on('error', reject);
    //     watcher.on('ready', async () => {
    //       ready = true;
    //       await Promise.all(initialEventPromises);
    //       initialEventPromises = [];
    //       resolve();
    //     });
    //     /*watcher.on('all', (event, path) => {
    //       console.log(event, path);
    //     });*/
    //     const syncFile = async (filename: string): Promise<void> => {
    //       try {
    //         this.log.debug(`Synchronizing ${filename}`);
    //         const src = inSrc(filename);
    //         const dest = inDest(filename);
    //         if (filename.endsWith('.map')) {
    //           await this.patchSourcemap(src, dest);
    //         } else if (!existsSync(inSrc(`${filename}.map`))) {
    //           // copy file and add sourcemap
    //           await this.addSourcemap(src, dest, true);
    //         } else {
    //           await copyFile(src, dest);
    //         }
    //       } catch (error) {
    //         this.log.warn(`Couldn't sync ${filename}`);
    //       }
    //     };
    //     watcher.on('add', (filename: string) => {
    //       if (ready) {
    //         syncFile(filename);
    //       } else if (!filename.endsWith('map') && !existsSync(inDest(filename))) {
    //         // ignore files during initial sync if they don't exist in the target directory (except for sourcemaps)
    //         ignoreFiles.push(filename);
    //       } else {
    //         initialEventPromises.push(syncFile(filename));
    //       }
    //     });
    //     watcher.on('change', (filename: string) => {
    //       if (!ignoreFiles.includes(filename)) {
    //         const resPromise = syncFile(filename);
    //         if (!ready) {
    //           initialEventPromises.push(resPromise);
    //         }
    //       }
    //     });
    //     watcher.on('unlink', (filename: string) => {
    //       unlinkSync(inDest(filename));
    //       const map = inDest(filename + '.map');
    //       if (existsSync(map)) {
    //         unlinkSync(map);
    //       }
    //     });
    //   });
    // }
    async startNodemon(baseDir, scriptName, doNotWatch) {
        const script = path.resolve(baseDir, scriptName);
        this.log.notice(`Starting nodemon for ${script}`);
        let isExiting = false;
        process.on('SIGINT', () => {
            isExiting = true;
        });
        const args = this.isJSController() ? [] : ['--debug', '0'];
        const ignoreList = [
            path.join(baseDir, 'admin'),
            // avoid recursively following symlinks
            path.join(baseDir, '.dev-server'),
        ];
        if (doNotWatch.length > 0) {
            doNotWatch.forEach((entry) => ignoreList.push(path.join(baseDir, entry)));
        }
        (0, nodemon_1.default)({
            script: script,
            stdin: false,
            verbose: true,
            // dump: true, // this will output the entire config and not do anything
            colours: false,
            watch: [baseDir],
            ignore: ignoreList,
            ignoreRoot: [],
            delay: 2000,
            execMap: { js: 'node --inspect --preserve-symlinks --preserve-symlinks-main' },
            signal: 'SIGINT',
            args,
        });
        nodemon_1.default
            .on('log', (msg) => {
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
            this.socketEvents.on('objectChange', (args) => {
                if (Array.isArray(args) && args.length > 1 && args[0] === `system.adapter.${this.adapterName}.0`) {
                    this.log.notice(`Adapter configuration changed, restarting nodemon...`);
                    nodemon_1.default.restart();
                }
            });
        }
    }
    async handleNodemonDetailMsg(message) {
        const match = message.match(/child pid: (\d+)/);
        if (!match) {
            return;
        }
        const debigPid = await this.waitForNodeChildProcess(parseInt(match[1]));
        this.log.box(`Debugger is now available on process id ${debigPid}`);
    }
    async setupDevServer(adminPort, dependencies, backupFile) {
        await this.buildLocalAdapter();
        this.log.notice(`Setting up in ${this.profileDir}`);
        // create the data directory
        const dataDir = path.join(this.profileDir, 'iobroker-data');
        await (0, fs_extra_1.mkdirp)(dataDir);
        // create the configuration
        const config = {
            system: {
                memoryLimitMB: 0,
                hostname: `dev-${this.adapterName}-${(0, os_1.hostname)()}`,
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
                type: 'jsonl',
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
                type: 'jsonl',
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
        await (0, fs_extra_1.writeJson)(path.join(dataDir, 'iobroker.json'), config, { spaces: 2 });
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
                adminPort: adminPort,
            },
        };
        await (0, fs_extra_1.writeJson)(path.join(this.profileDir, 'package.json'), pkg, { spaces: 2 });
        // Tell npm to link the local adapter folder instead of creating a copy
        await (0, fs_extra_1.writeFile)(path.join(this.profileDir, '.npmrc'), 'install-links=false', 'utf8');
        await this.verifyIgnoreFiles();
        this.log.notice('Installing js-controller and admin...');
        this.execSync('npm install --loglevel error --production', this.profileDir);
        if (backupFile) {
            const fullPath = path.resolve(backupFile);
            this.log.notice(`Restoring backup from ${fullPath}`);
            this.execSync(`${IOBROKER_COMMAND} restore "${fullPath}"`, this.profileDir);
        }
        if (this.isJSController()) {
            await this.installLocalAdapter();
        }
        await this.uploadAndAddAdapter('admin');
        // reconfigure admin instance (only listen to local IP address)
        this.log.notice('Configure admin.0');
        await this.updateObject('system.adapter.admin.0', (admin) => {
            admin.native.port = this.getPort(adminPort, HIDDEN_ADMIN_PORT_OFFSET);
            admin.native.bind = '127.0.0.1';
            return admin;
        });
        if (!this.isJSController()) {
            // install local adapter
            await this.installLocalAdapter();
            await this.uploadAndAddAdapter(this.adapterName);
            // installing any dependencies
            const { common } = await (0, fs_extra_1.readJson)(path.join(this.rootDir, 'io-package.json'));
            const adapterDeps = [
                ...this.getDependencies(common.dependencies),
                ...this.getDependencies(common.globalDependencies),
            ];
            this.log.debug(`Found ${adapterDeps.length} adapter dependencies`);
            for (const adapter of adapterDeps) {
                try {
                    await this.installRepoAdapter(adapter);
                }
                catch (error) {
                    this.log.debug(`Couldn't install iobroker.${adapter}: ${error}`);
                }
            }
            this.log.notice(`Stop ${this.adapterName}.0`);
            await this.updateObject(`system.adapter.${this.adapterName}.0`, (adapter) => {
                adapter.common.enabled = false;
                return adapter;
            });
        }
        this.log.notice(`Patching "system.config"`);
        await this.updateObject('system.config', (systemConfig) => {
            systemConfig.common.diag = 'none'; // Disable statistics reporting
            systemConfig.common.licenseConfirmed = true; // Disable license confirmation
            systemConfig.common.defaultLogLevel = 'debug'; // Set default log level for adapters to debug
            systemConfig.common.activeRepo = 'beta'; // Set adapter repository to beta
            // Set other details to dummy values that they are not empty like in a normal installation
            systemConfig.common.city = 'Berlin';
            systemConfig.common.country = 'Germany';
            systemConfig.common.longitude = 13.28;
            systemConfig.common.latitude = 52.5;
            systemConfig.common.language = 'en';
            systemConfig.common.tempUnit = '°C';
            systemConfig.common.currency = '€';
            return systemConfig;
        });
    }
    async verifyIgnoreFiles() {
        this.log.notice(`Verifying .npmignore and .gitignore`);
        let relative = path.relative(this.rootDir, this.tempDir).replace('\\', '/');
        if (relative.startsWith('..')) {
            // the temporary directory is outside the root, so no worries!
            return;
        }
        if (!relative.endsWith('/')) {
            relative += '/';
        }
        const tempDirRegex = new RegExp(`\\s${this.escapeStringRegexp(relative)
            .replace(/[\\/]$/, '')
            .replace(/(\\\\|\/)/g, '[\\/]')}`);
        const verifyFile = async (filename, command, allowStar) => {
            try {
                const { stdout, stderr } = await this.getExecOutput(command, this.rootDir);
                if (stdout.match(tempDirRegex) || stderr.match(tempDirRegex)) {
                    this.log.error((0, chalk_1.bold)(`Your ${filename} doesn't exclude the temporary directory "${relative}"`));
                    const choices = [];
                    if (allowStar) {
                        choices.push({
                            message: `Add wildcard to ${filename} for ".*" (recommended)`,
                            name: 'add-star',
                        });
                    }
                    choices.push({
                        message: `Add "${relative}" to ${filename}`,
                        name: 'add-explicit',
                    }, {
                        message: `Abort setup`,
                        name: 'abort',
                    });
                    let action;
                    try {
                        const result = await (0, enquirer_1.prompt)({
                            name: 'action',
                            type: 'select',
                            message: 'What would you like to do?',
                            choices,
                        });
                        action = result.action;
                    }
                    catch (error) {
                        action = 'abort';
                    }
                    if (action === 'abort') {
                        return this.exit(-1);
                    }
                    const filepath = path.resolve(this.rootDir, filename);
                    let content = '';
                    if ((0, fs_extra_1.existsSync)(filepath)) {
                        content = await (0, fs_extra_1.readFile)(filepath, { encoding: 'utf-8' });
                    }
                    const eol = content.match(/\r\n/) ? '\r\n' : content.match(/\n/) ? '\n' : os_1.EOL;
                    if (action === 'add-star') {
                        content = `# exclude all dot-files and directories${eol}.*${eol}${eol}${content}`;
                    }
                    else {
                        content = `${content}${eol}${eol}# ioBroker dev-server${eol}${relative}${eol}`;
                    }
                    await (0, fs_extra_1.writeFile)(filepath, content);
                }
            }
            catch (error) {
                this.log.debug(`Couldn't check ${filename}: ${error}`);
            }
        };
        await verifyFile('.npmignore', 'npm pack --dry-run', true);
        await verifyFile('.gitignore', 'git status --short --untracked-files=all', false);
    }
    async uploadAndAddAdapter(name) {
        // upload the already installed adapter
        this.uploadAdapter(name);
        if (await this.withDb(async (db) => {
            const instance = await db.getObject(`system.adapter.${name}.0`);
            if (instance) {
                this.log.info(`Instance ${name}.0 already exists, not adding it again`);
                return false;
            }
            return true;
        })) {
            // create an instance
            this.log.notice(`Add ${name}.0`);
            this.execSync(`${IOBROKER_COMMAND} add ${name} 0`, this.profileDir);
        }
    }
    uploadAdapter(name) {
        this.log.notice(`Upload iobroker.${name}`);
        this.execSync(`${IOBROKER_COMMAND} upload ${name}`, this.profileDir);
    }
    async buildLocalAdapter() {
        var _a;
        const pkg = await this.readPackageJson();
        if ((_a = pkg.scripts) === null || _a === void 0 ? void 0 : _a.build) {
            this.log.notice(`Build iobroker.${this.adapterName}`);
            this.execSync('npm run build', this.rootDir);
        }
    }
    async installLocalAdapter() {
        this.log.notice(`Install local iobroker.${this.adapterName}`);
        const relativePath = path.relative(this.profileDir, this.rootDir);
        this.execSync(`npm install "${relativePath}"`, this.profileDir);
    }
    async installRepoAdapter(adapterName) {
        this.log.notice(`Install iobroker.${adapterName}`);
        this.execSync(`${IOBROKER_COMMAND} install ${adapterName}`, this.profileDir);
    }
    /**
     * This method is largely borrowed from ioBroker.js-controller/lib/tools.js
     * @param dependencies The global or local dependency list from io-package.json
     * @returns the list of adapters (without js-controller) found in the dependencies.
     */
    getDependencies(dependencies) {
        const adapters = [];
        if (Array.isArray(dependencies)) {
            dependencies.forEach((rule) => {
                if (typeof rule === 'string') {
                    // No version given, all are okay
                    adapters.push(rule);
                }
                else {
                    // can be object containing single adapter or multiple
                    Object.keys(rule)
                        .filter((adapter) => !adapters.includes(adapter))
                        .forEach((adapter) => adapters.push(adapter));
                }
            });
        }
        else if (typeof dependencies === 'string') {
            // its a single string without version requirement
            adapters.push(dependencies);
        }
        else if (dependencies) {
            adapters.push(...Object.keys(dependencies));
        }
        return adapters.filter((a) => a !== 'js-controller');
    }
    async withDb(method) {
        const db = new dbConnection_1.DBConnection('iobroker', this.profileDir, this.log);
        await db.start();
        try {
            return await method(db);
        }
        finally {
            await db.stop();
        }
    }
    async updateObject(id, method) {
        await this.withDb(async (db) => {
            const obj = await db.getObject(id);
            if (obj) {
                await db.setObject(id, method(obj));
            }
        });
    }
    execSync(command, cwd, options) {
        options = { cwd: cwd, stdio: 'inherit', ...options };
        this.log.debug(`${cwd}> ${command}`);
        return cp.execSync(command, options);
    }
    getExecOutput(command, cwd) {
        this.log.debug(`${cwd}> ${command}`);
        return new Promise((resolve, reject) => {
            this.childProcesses.push(cp.exec(command, { cwd, encoding: 'ascii' }, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({ stdout, stderr });
                }
            }));
        });
    }
    spawn(command, args, cwd, options) {
        return new Promise((resolve, reject) => {
            let processSpawned = false;
            this.log.debug(`${cwd}> ${command} ${args.join(' ')}`);
            const proc = cp.spawn(command, args, {
                stdio: ['ignore', 'inherit', 'inherit'],
                cwd: cwd,
                ...options,
            });
            this.childProcesses.push(proc);
            let alive = true;
            proc.on('spawn', () => {
                processSpawned = true;
                resolve(proc);
            });
            proc.on('error', (err) => {
                this.log.error(`Could not spawn ${command}: ${err}`);
                if (!processSpawned) {
                    reject(err);
                }
            });
            proc.on('exit', () => (alive = false));
            process.on('exit', () => alive && proc.kill('SIGINT'));
        });
    }
    async spawnAndAwaitOutput(command, args, cwd, awaitMsg, options) {
        const proc = await this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
        return new Promise((resolve, reject) => {
            var _a, _b;
            const handleStream = (isStderr) => (data) => {
                let str = data.toString('utf-8');
                str = str.replace(/\x1Bc/, ''); // filter the "clear screen" ANSI code (used by tsc)
                if (str) {
                    str = str.trimEnd();
                    if (isStderr) {
                        console.error(str);
                    }
                    else {
                        console.log(str);
                    }
                }
                if (typeof awaitMsg === 'string') {
                    if (str.includes(awaitMsg)) {
                        resolve(proc);
                    }
                }
                else {
                    if (awaitMsg.test(str)) {
                        resolve(proc);
                    }
                }
            };
            (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', handleStream(false));
            (_b = proc.stderr) === null || _b === void 0 ? void 0 : _b.on('data', handleStream(true));
            proc.on('exit', (code) => reject(`Exited with ${code}`));
            process.on('SIGINT', () => {
                proc.kill('SIGINT');
                reject('SIGINT');
            });
        });
    }
    rimraf(name) {
        return new Promise((resolve, reject) => rimraf(name, (err) => (err ? reject(err) : resolve())));
    }
    escapeStringRegexp(value) {
        // Escape characters with special meaning either inside or outside character sets.
        // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
        return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
    }
    async exit(exitCode, signal = 'SIGINT') {
        const childPids = this.childProcesses.map((p) => p.pid).filter((p) => !!p);
        const tryKill = (pid, signal) => {
            try {
                process.kill(pid, signal);
            }
            catch (_a) {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map((pid) => this.getChildProcesses(pid)));
            children.forEach((ch) => ch.forEach((c) => tryKill(parseInt(c.PID), signal)));
        }
        catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error}`);
        }
        if (childPids.length) {
            childPids.forEach((pid) => tryKill(pid, signal));
            if (signal !== 'SIGKILL') {
                // first try SIGINT and give it 5s to exit itself before killing the processes left
                await this.delay(5000);
                return this.exit(exitCode, 'SIGKILL');
            }
        }
        process.exit(exitCode);
    }
}
(() => new DevServer())();
