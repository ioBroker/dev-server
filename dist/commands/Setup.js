"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Setup = void 0;
const chalk_1 = __importDefault(require("chalk"));
const enquirer_1 = require("enquirer");
const fs_extra_1 = require("fs-extra");
const node_os_1 = require("node:os");
const node_path_1 = __importDefault(require("node:path"));
const rimraf_1 = require("rimraf");
const CommandBase_1 = require("./CommandBase");
const utils_1 = require("./utils");
class Setup extends CommandBase_1.CommandBase {
    constructor(owner, adminPort, dependencies, backupFile, force, useSymlinks) {
        super(owner);
        this.adminPort = adminPort;
        this.dependencies = dependencies;
        this.backupFile = backupFile;
        this.force = force;
        this.useSymlinks = useSymlinks;
    }
    async run() {
        if (this.force) {
            this.log.notice(`Deleting ${this.profileDir}`);
            await (0, rimraf_1.rimraf)(this.profileDir);
        }
        if (this.owner.isSetUp()) {
            this.log.error(`dev-server is already set up in "${this.profileDir}".`);
            this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
            return;
        }
        this.owner.config = {
            adminPort: this.adminPort,
            useSymlinks: this.useSymlinks,
        };
        await this.buildLocalAdapter();
        this.log.notice(`Setting up in ${this.profileDir}`);
        await this.setupDevServer();
        const commands = ['run', 'watch', 'debug'];
        this.log.box(`dev-server was successfully set up in\n${this.profileDir}.\n\n` +
            `You may now execute one of the following commands\n\n${commands
                .map(command => `dev-server ${command} ${this.profileName}`)
                .join('\n')}\n\nto use dev-server.`);
    }
    async setupDevServer() {
        // create the data directory
        const dataDir = node_path_1.default.join(this.profileDir, 'iobroker-data');
        await (0, fs_extra_1.mkdirp)(dataDir);
        // create the configuration
        const config = {
            system: {
                memoryLimitMB: 0,
                hostname: `dev-${this.adapterName}-${(0, node_os_1.hostname)()}`,
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
                port: this.getPort(CommandBase_1.OBJECTS_DB_PORT_OFFSET),
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
                port: this.getPort(CommandBase_1.STATES_DB_PORT_OFFSET),
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
        await (0, fs_extra_1.writeJson)(node_path_1.default.join(dataDir, 'iobroker.json'), config, { spaces: 2 });
        // create the package file
        if (this.isJSController()) {
            // if this dev-server is used to debug JS-Controller, don't install a published version
            delete this.dependencies['iobroker.js-controller'];
        }
        // Check if the adapter uses TypeScript and add esbuild-register dependency if needed
        const adapterPkg = await this.readPackageJson();
        if (this.isTypeScriptMain(adapterPkg.main)) {
            this.dependencies['@alcalzone/esbuild-register'] = '^2.5.1-1';
        }
        const pkg = {
            name: `dev-server.${this.adapterName}`,
            version: '1.0.0',
            private: true,
            dependencies: this.dependencies,
            'dev-server': this.config,
        };
        await (0, fs_extra_1.writeJson)(node_path_1.default.join(this.profileDir, 'package.json'), pkg, { spaces: 2 });
        // Tell npm to link the local adapter folder instead of creating a copy
        if (this.config.useSymlinks) {
            await (0, fs_extra_1.writeFile)(node_path_1.default.join(this.profileDir, '.npmrc'), 'install-links=false', 'utf8');
        }
        await this.verifyIgnoreFiles();
        this.log.notice('Installing js-controller and admin...');
        await this.installDependencies();
        if (this.backupFile) {
            const fullPath = node_path_1.default.resolve(this.backupFile);
            this.log.notice(`Restoring backup from ${fullPath}`);
            this.execSync(`${CommandBase_1.IOBROKER_COMMAND} restore "${fullPath}"`, this.profileDir);
        }
        if (this.isJSController()) {
            await this.installLocalAdapter();
        }
        await this.uploadAndAddAdapter('admin');
        // reconfigure admin instance (only listen to local IP address)
        this.log.notice('Configure admin.0');
        await this.updateObject('system.adapter.admin.0', admin => {
            admin.native.port = this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET);
            admin.native.bind = '127.0.0.1';
            return admin;
        });
        if (!this.isJSController()) {
            // install local adapter
            await this.installLocalAdapter();
            await this.uploadAndAddAdapter(this.adapterName);
            // installing any dependencies
            const { common } = await this.readIoPackageJson();
            const adapterDeps = [
                ...this.getDependencies(common.dependencies),
                ...this.getDependencies(common.globalDependencies),
            ];
            this.log.debug(`Found ${adapterDeps.length} adapter dependencies`);
            for (const adapter of adapterDeps) {
                try {
                    this.installRepoAdapter(adapter);
                }
                catch (error) {
                    this.log.debug(`Couldn't install iobroker.${adapter}: ${error}`);
                }
            }
            this.log.notice(`Stop ${this.adapterName}.0`);
            await this.updateObject(`system.adapter.${this.adapterName}.0`, adapter => {
                adapter.common.enabled = false;
                return adapter;
            });
        }
        this.log.notice(`Patching "system.config"`);
        await this.updateObject('system.config', systemConfig => {
            systemConfig.common.diag = 'none'; // Disable statistics reporting
            systemConfig.common.licenseConfirmed = true; // Disable license confirmation
            systemConfig.common.defaultLogLevel = 'debug'; // Set the default log level for adapters to debug
            systemConfig.common.activeRepo = ['beta']; // Set adapter repository to beta
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
    async installDependencies() {
        this.execSync('npm install --loglevel error --production', this.profileDir);
    }
    async verifyIgnoreFiles() {
        this.log.notice(`Verifying .npmignore and .gitignore`);
        let relative = node_path_1.default.relative(this.rootDir, this.owner.tempDir).replace('\\', '/');
        if (relative.startsWith('..')) {
            // the temporary directory is outside the root, so no worries!
            return;
        }
        if (!relative.endsWith('/')) {
            relative += '/';
        }
        const tempDirRegex = new RegExp(`\\s${(0, utils_1.escapeStringRegexp)(relative)
            .replace(/[\\/]$/, '')
            .replace(/(\\\\|\/)/g, '[\\/]')}`);
        const verifyFile = async (fileName, command, allowStar) => {
            try {
                const { stdout, stderr } = await this.getExecOutput(command, this.rootDir);
                if (stdout.match(tempDirRegex) || stderr.match(tempDirRegex)) {
                    this.log.error(chalk_1.default.bold(`Your ${fileName} doesn't exclude the temporary directory "${relative}"`));
                    const choices = [];
                    if (allowStar) {
                        choices.push({
                            message: `Add wildcard to ${fileName} for ".*" (recommended)`,
                            name: 'add-star',
                        });
                    }
                    choices.push({
                        message: `Add "${relative}" to ${fileName}`,
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
                    catch (_a) {
                        action = 'abort';
                    }
                    if (action === 'abort') {
                        return this.exit(-1);
                    }
                    const filepath = node_path_1.default.resolve(this.rootDir, fileName);
                    let content = '';
                    if ((0, fs_extra_1.existsSync)(filepath)) {
                        content = await (0, fs_extra_1.readFile)(filepath, { encoding: 'utf-8' });
                    }
                    const eol = content.match(/\r\n/) ? '\r\n' : content.match(/\n/) ? '\n' : node_os_1.EOL;
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
                this.log.debug(`Couldn't check ${fileName}: ${error}`);
            }
        };
        await verifyFile('.npmignore', 'npm pack --dry-run', true);
        // Only verify .gitignore if we're in a git repository
        if ((0, fs_extra_1.existsSync)(node_path_1.default.join(this.rootDir, '.git'))) {
            await verifyFile('.gitignore', 'git status --short --untracked-files=all', false);
        }
        else {
            this.log.debug('Skipping .gitignore verification: not in a git repository');
        }
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
            this.execSync(`${CommandBase_1.IOBROKER_COMMAND} add ${name} 0`, this.profileDir);
        }
    }
    /**
     * This method is largely borrowed from ioBroker.js-controller/lib/tools.js
     *
     * @param dependencies The global or local dependency list from io-package.json
     * @returns the list of adapters (without js-controller) found in the dependencies.
     */
    getDependencies(dependencies) {
        const adapters = [];
        if (Array.isArray(dependencies)) {
            dependencies.forEach(rule => {
                if (typeof rule === 'string') {
                    // No version given, all are okay
                    adapters.push(rule);
                }
                else {
                    // can be object containing a single adapter or multiple
                    Object.keys(rule)
                        .filter(adapter => !adapters.includes(adapter))
                        .forEach(adapter => adapters.push(adapter));
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
        return adapters.filter(a => a !== 'js-controller');
    }
    installRepoAdapter(adapterName) {
        this.log.notice(`Install iobroker.${adapterName}`);
        this.execSync(`${CommandBase_1.IOBROKER_COMMAND} install ${adapterName}`, this.profileDir);
    }
}
exports.Setup = Setup;
