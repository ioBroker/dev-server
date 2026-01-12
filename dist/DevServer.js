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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevServer = void 0;
const axios_1 = __importDefault(require("axios"));
const chalk_1 = __importDefault(require("chalk"));
const enquirer_1 = require("enquirer");
const fs_extra_1 = require("fs-extra");
const path = __importStar(require("node:path"));
const semver_1 = require("semver");
const yargs_1 = __importDefault(require("yargs/yargs"));
const Backup_1 = require("./commands/Backup");
const Debug_1 = require("./commands/Debug");
const Run_1 = require("./commands/Run");
const Setup_1 = require("./commands/Setup");
const Update_1 = require("./commands/Update");
const Upload_1 = require("./commands/Upload");
const Watch_1 = require("./commands/Watch");
const logger_1 = require("./logger");
const DEFAULT_TEMP_DIR_NAME = '.dev-server';
const CORE_MODULE = 'iobroker.js-controller';
const DEFAULT_ADMIN_PORT = 8081;
const DEFAULT_PROFILE_NAME = 'default';
class DevServer {
    constructor() {
        const parser = (0, yargs_1.default)(process.argv.slice(2));
        void parser
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
            remote: {
                type: 'boolean',
                alias: 'r',
                description: 'Run ioBroker and the adapter on a remote host',
            },
            force: { type: 'boolean', hidden: true },
            symlinks: {
                type: 'boolean',
                alias: 'l',
                default: false,
                description: 'Use symlinks instead of packing and installing the current adapter for a smoother dev experience. Requires JS-Controller 5+.',
            },
        }, async (args) => await this.setup(args.adminPort, { ['iobroker.js-controller']: args.jsController, ['iobroker.admin']: args.admin }, args.backupFile, !!args.remote, !!args.force, args.symlinks))
            .command(['update [profile]', 'ud'], 'Update ioBroker and its dependencies to the latest versions', {}, async () => await this.update())
            .command(['run [profile]', 'r'], 'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload', {
            noBrowserSync: {
                type: 'boolean',
                alias: 'b',
                description: 'Do not use BrowserSync for hot-reload (serve static files instead)',
            },
        }, async (args) => await this.run(!args.noBrowserSync))
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
            noBrowserSync: {
                type: 'boolean',
                alias: 'b',
                description: 'Do not use BrowserSync for hot-reload (serve static files instead)',
            },
        }, async (args) => await this.watch(!args.noStart, !!args.noInstall, args.doNotWatch, !args.noBrowserSync))
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
            .middleware(async () => await this.parseConfig())
            .wrap(Math.min(100, parser.terminalWidth()))
            .help().argv;
    }
    setLogger(argv) {
        this.log = new logger_1.Logger(argv.verbose ? 'silly' : 'debug');
        return Promise.resolve();
    }
    async checkVersion() {
        try {
            const { name, version: localVersion } = await this.readMyPackageJson();
            const { data: { version: releaseVersion }, } = await axios_1.default.get(`https://registry.npmjs.org/${name}/latest`, { timeout: 1000 });
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
                    return process.exit(0);
                }
                this.log.warn(`We strongly recommend to update ${name} as soon as possible.`);
            }
        }
        catch (_a) {
            // ignore
        }
    }
    async readMyPackageJson() {
        return (0, fs_extra_1.readJson)(path.join(__dirname, '..', 'package.json'));
    }
    async setDirectories(argv) {
        this.rootDir = path.resolve(argv.root);
        this.tempDir = path.resolve(this.rootDir, argv.temp);
        if ((0, fs_extra_1.existsSync)(path.join(this.tempDir, 'package.json'))) {
            // we are still in the old directory structure (no profiles), let's move it
            const intermediateDir = path.join(this.rootDir, `${DEFAULT_TEMP_DIR_NAME}-temp`);
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
                    this.log.box(chalk_1.default.yellow(`You didn't specify the profile name in the command line. ` +
                        `You may do so the next time by appending the profile name to your command.\nExample:\n` +
                        `> dev-server ${process.argv.slice(2).join(' ')} ${profileNames[profileNames.length - 1]} `));
                    const response = await (0, enquirer_1.prompt)({
                        name: 'profile',
                        type: 'select',
                        message: 'Please choose a profile',
                        choices: profileNames.map(p => ({
                            name: p,
                            hint: chalk_1.default.gray(`(Admin Port: ${profiles[p]['dev-server'].adminPort})`),
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
        this.adapterName = await this.findAdapterName();
    }
    async parseConfig() {
        let pkg;
        try {
            pkg = await (0, fs_extra_1.readJson)(path.join(this.profileDir, 'package.json'));
        }
        catch (_a) {
            // not all commands need the config
            return;
        }
        this.config = pkg['dev-server'];
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
            return process.exit(-1);
        }
    }
    ////////////////// Command Handlers //////////////////
    async setup(adminPort, dependencies, backupFile, remote, force, useSymlinks) {
        const setup = new Setup_1.Setup(this, adminPort, dependencies, backupFile, force, useSymlinks);
        await setup.run();
    }
    async update() {
        await this.checkSetup();
        const update = new Update_1.Update(this);
        await update.run();
    }
    async run(useBrowserSync = true) {
        await this.checkSetup();
        const run = new Run_1.Run(this, useBrowserSync);
        await run.run();
    }
    async watch(startAdapter, noInstall, doNotWatch, useBrowserSync = true) {
        let doNotWatchArr = [];
        if (typeof doNotWatch === 'string') {
            doNotWatchArr.push(doNotWatch);
        }
        else if (Array.isArray(doNotWatch)) {
            doNotWatchArr = doNotWatch;
        }
        await this.checkSetup();
        const watch = new Watch_1.Watch(this, noInstall, startAdapter, doNotWatchArr, useBrowserSync);
        await watch.run();
    }
    async debug(wait, noInstall) {
        await this.checkSetup();
        const debug = new Debug_1.Debug(this, wait, noInstall);
        await debug.run();
    }
    async upload() {
        await this.checkSetup();
        const upload = new Upload_1.Upload(this);
        await upload.run();
        this.log.box(`The latest content of iobroker.${this.adapterName} was uploaded to ${this.profileDir}.`);
    }
    async backup(filename) {
        await this.checkSetup();
        this.log.notice('Creating backup');
        const fullPath = path.resolve(filename);
        const backup = new Backup_1.Backup(this, fullPath);
        await backup.run();
    }
    async profile() {
        const profiles = await this.getProfiles();
        const table = Object.keys(profiles).map(name => {
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
        table.unshift([
            chalk_1.default.bold('Profile Name'),
            chalk_1.default.bold('Admin URL'),
            chalk_1.default.bold('js-controller'),
            chalk_1.default.bold('admin'),
        ]);
        this.log.info(`The following profiles exist in ${this.tempDir}`);
        this.log.table(table.filter(r => !!r));
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
        return pkgs.filter(p => !!p).reduce((old, [e, pkg]) => ({ ...old, [e]: pkg }), {});
    }
    async checkSetup() {
        if (!this.isSetUp()) {
            this.log.error(`dev-server is not set up in ${this.profileDir}.\nPlease use the command "setup" first to set up dev-server.`);
            return process.exit(-1);
        }
    }
    isSetUp() {
        const jsControllerDir = path.join(this.profileDir, 'node_modules', CORE_MODULE);
        return (0, fs_extra_1.existsSync)(jsControllerDir);
    }
}
exports.DevServer = DevServer;
(() => new DevServer())();
