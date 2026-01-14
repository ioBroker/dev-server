import { DBConnection } from '@iobroker/testing/build/tests/integration/lib/dbConnection.js';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { EOL, hostname } from 'node:os';
import path from 'node:path';
import { rimraf } from 'rimraf';
import { CommandBase, HIDDEN_ADMIN_PORT_OFFSET, IOBROKER_COMMAND, OBJECTS_DB_PORT_OFFSET, STATES_DB_PORT_OFFSET, } from './CommandBase.js';
import { escapeStringRegexp, writeJson } from './utils.js';
export class Setup extends CommandBase {
    adminPort;
    dependencies;
    backupFile;
    force;
    useSymlinks;
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
            this.log.notice(`Deleting ${this.profilePath}`);
            await rimraf(this.profilePath);
        }
        if (this.owner.isSetUp()) {
            this.log.error(`dev-server is already set up in "${this.profilePath}".`);
            this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
            return;
        }
        this.owner.config = {
            adminPort: this.adminPort,
            useSymlinks: this.useSymlinks,
        };
        await this.buildLocalAdapter();
        this.log.notice(`Setting up in ${this.profilePath}`);
        await this.setupDevServer();
        const commands = ['run', 'watch', 'debug'];
        this.log.box(`dev-server was successfully set up in\n${this.profilePath}.\n\n` +
            `You may now execute one of the following commands\n\n${commands
                .map(command => `dev-server ${command} ${this.profileName}`)
                .join('\n')}\n\nto use dev-server.`);
    }
    async setupDevServer() {
        // create the data directory
        const dataDir = path.join(this.profilePath, 'iobroker-data');
        await mkdir(dataDir, { recursive: true });
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
                type: 'jsonl',
                host: '127.0.0.1',
                port: this.getPort(OBJECTS_DB_PORT_OFFSET),
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
                port: this.getPort(STATES_DB_PORT_OFFSET),
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
        await writeJson(path.join(dataDir, 'iobroker.json'), config);
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
        await writeJson(path.join(this.profilePath, 'package.json'), pkg);
        // Tell npm to link the local adapter folder instead of creating a copy
        if (this.config.useSymlinks) {
            await writeFile(path.join(this.profilePath, '.npmrc'), 'install-links=false', 'utf8');
        }
        await this.verifyIgnoreFiles();
        this.log.notice('Installing js-controller and admin...');
        await this.installDependencies();
        if (this.backupFile) {
            const fullPath = path.resolve(this.backupFile);
            this.log.notice(`Restoring backup from ${fullPath}`);
            await this.profileDir.exec(`${IOBROKER_COMMAND} restore "${fullPath}"`);
        }
        if (this.isJSController()) {
            await this.installLocalAdapter();
        }
        await this.uploadAndAddAdapter('admin');
        // reconfigure admin instance (only listen to local IP address)
        this.log.notice('Configure admin.0');
        await this.updateObject('system.adapter.admin.0', admin => {
            admin.native.port = this.getPort(HIDDEN_ADMIN_PORT_OFFSET);
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
                    await this.installRepoAdapter(adapter);
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
        await this.profileDir.exec('npm install --loglevel error --production');
    }
    async verifyIgnoreFiles() {
        this.log.notice(`Verifying .npmignore and .gitignore`);
        let relative = path.relative(this.rootPath, this.owner.tempPath).replace('\\', '/');
        if (relative.startsWith('..')) {
            // the temporary directory is outside the root, so no worries!
            return;
        }
        if (!relative.endsWith('/')) {
            relative += '/';
        }
        const tempDirRegex = new RegExp(`\\s${escapeStringRegexp(relative)
            .replace(/[\\/]$/, '')
            .replace(/(\\\\|\/)/g, '[\\/]')}`);
        const verifyFile = async (fileName, command, allowStar) => {
            try {
                const { stdout, stderr } = await this.rootDir.getExecOutput(command);
                if (stdout.match(tempDirRegex) || stderr.match(tempDirRegex)) {
                    this.log.error(chalk.bold(`Your ${fileName} doesn't exclude the temporary directory "${relative}"`));
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
                        const result = await enquirer.prompt({
                            name: 'action',
                            type: 'select',
                            message: 'What would you like to do?',
                            choices,
                        });
                        action = result.action;
                    }
                    catch {
                        action = 'abort';
                    }
                    if (action === 'abort') {
                        return this.exit(-1);
                    }
                    const filepath = path.resolve(this.rootPath, fileName);
                    let content = '';
                    if (existsSync(filepath)) {
                        content = await readFile(filepath, { encoding: 'utf-8' });
                    }
                    const eol = content.match(/\r\n/) ? '\r\n' : content.match(/\n/) ? '\n' : EOL;
                    if (action === 'add-star') {
                        content = `# exclude all dot-files and directories${eol}.*${eol}${eol}${content}`;
                    }
                    else {
                        content = `${content}${eol}${eol}# ioBroker dev-server${eol}${relative}${eol}`;
                    }
                    await writeFile(filepath, content);
                }
            }
            catch (error) {
                this.log.debug(`Couldn't check ${fileName}: ${error}`);
            }
        };
        await verifyFile('.npmignore', 'npm pack --dry-run', true);
        // Only verify .gitignore if we're in a git repository
        if (existsSync(path.join(this.rootPath, '.git'))) {
            await verifyFile('.gitignore', 'git status --short --untracked-files=all', false);
        }
        else {
            this.log.debug('Skipping .gitignore verification: not in a git repository');
        }
    }
    async uploadAndAddAdapter(name) {
        // upload the already installed adapter
        await this.uploadAdapter(name);
        if (await this.hasAdapterInstance(name)) {
            this.log.info(`Instance ${name}.0 already exists, not adding it again`);
        }
        else {
            // create an instance
            this.log.notice(`Add ${name}.0`);
            await this.profileDir.exec(`${IOBROKER_COMMAND} add ${name} 0`);
        }
    }
    async hasAdapterInstance(name) {
        return await this.withDb(async (db) => {
            const instance = await db.getObject(`system.adapter.${name}.0`);
            return !!instance;
        });
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
    async installRepoAdapter(adapterName) {
        this.log.notice(`Install iobroker.${adapterName}`);
        await this.profileDir.exec(`${IOBROKER_COMMAND} install ${adapterName}`);
    }
    async withDb(method) {
        const db = new DBConnection('iobroker', this.profilePath, this.log);
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
                // @ts-expect-error fix later
                await db.setObject(id, method(obj));
            }
        });
    }
}
