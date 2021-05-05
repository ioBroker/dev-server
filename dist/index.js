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
const axios_1 = __importDefault(require("axios"));
const browser_sync_1 = __importDefault(require("browser-sync"));
const chalk_1 = require("chalk");
const cp = __importStar(require("child_process"));
const chokidar_1 = __importDefault(require("chokidar"));
const enquirer_1 = require("enquirer");
const express_1 = __importDefault(require("express"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const fs_extra_1 = require("fs-extra");
const http_proxy_middleware_1 = require("http-proxy-middleware");
const nodemon_1 = __importDefault(require("nodemon"));
const os_1 = require("os");
const path = __importStar(require("path"));
const ps_tree_1 = __importDefault(require("ps-tree"));
const semver_1 = require("semver");
const source_map_1 = require("source-map");
const logger_1 = require("./logger");
const chalk = require("chalk");
const rimraf = require("rimraf");
const acorn = require("acorn");
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
        this.log = new logger_1.Logger();
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
            backupFile: {
                type: 'string',
                alias: 'b',
                description: 'Provide an ioBroker backup file to restore in this dev-server',
            },
            force: { type: 'boolean', hidden: true },
        }, async (args) => await this.setup(args.adminPort, args.jsController, args.backupFile, !!args.force))
            .command(['update [profile]', 'ud'], 'Update ioBroker and its dependencies to the latest versions', {}, async () => await this.update())
            .command(['run [profile]', 'r'], 'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload', {}, async () => await this.run())
            .command(['watch [profile]', 'w'], 'Run ioBroker dev-server and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.', {}, async () => await this.watch())
            .command(['debug [profile]', 'd'], 'Run ioBroker dev-server and start the adapter from ioBroker in "debug" mode. You may attach a debugger to the running adapter.', {
            wait: {
                type: 'boolean',
                alias: 'w',
                description: 'Start the adapter only once the debugger is attached.',
            },
        }, async (args) => await this.debug(!!args.wait))
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
        })
            .middleware(async () => await this.checkVersion())
            .middleware(async (argv) => await this.setDirectories(argv))
            .wrap(Math.min(100, parser.terminalWidth()))
            .help().argv;
    }
    async checkVersion() {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { name, version: localVersion } = require('../package.json');
            const { data: { version: releaseVersion }, } = await axios_1.default.get(`https://cdn.jsdelivr.net/npm/${name}/package.json`, { timeout: 1000 });
            if (semver_1.gt(releaseVersion, localVersion)) {
                this.log.debug(`Found update from ${localVersion} to ${releaseVersion}`);
                const response = await enquirer_1.prompt({
                    name: 'update',
                    type: 'confirm',
                    message: `Version ${releaseVersion} of ${name} is available.\nWould you like to exit and update?`,
                    initial: true,
                });
                if (response.update) {
                    this.log.box(`Please update ${name} manually and restart your last command afterwards.\n` +
                        `If you installed ${name} globally, you can simply call:\n\nnpm install --global ${name}`);
                    process.exit(0);
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
        if (fs_extra_1.existsSync(path.join(this.tempDir, 'package.json'))) {
            // we are still in the old directory structure (no profiles), let's move it
            const intermediateDir = path.join(this.rootDir, DEFAULT_TEMP_DIR_NAME + '-temp');
            const defaultProfileDir = path.join(this.tempDir, DEFAULT_PROFILE_NAME);
            this.log.debug(`Moving temporary data from ${this.tempDir} to ${defaultProfileDir}`);
            await fs_extra_1.rename(this.tempDir, intermediateDir);
            await fs_extra_1.mkdir(this.tempDir);
            await fs_extra_1.rename(intermediateDir, defaultProfileDir);
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
                    this.log.box(chalk_1.yellow(`You didn't specify the profile name in the command line. ` +
                        `You may do so the next time by appending the profile name to your command.\nExample:\n` +
                        `> dev-server ${process.argv.slice(2).join(' ')} ${profileNames[profileNames.length - 1]} `));
                    const response = await enquirer_1.prompt({
                        name: 'profile',
                        type: 'select',
                        message: 'Please choose a profile',
                        choices: profileNames.map((p) => ({
                            name: p,
                            hint: chalk_1.gray(`(Admin Port: ${profiles[p]['dev-server'].adminPort})`),
                        })),
                    });
                    profileName = response.profile;
                }
            }
        }
        if (!profileName.match(/^[a-z0-9_-]+$/i)) {
            throw new Error(`Invaid profile name: "${profileName}", it may only contain a-z, 0-9, _ and -.`);
        }
        this.profileDir = path.join(this.tempDir, profileName);
        this.adapterName = await this.findAdapterName();
    }
    async findAdapterName() {
        try {
            const ioPackage = await fs_extra_1.readJson(path.join(this.rootDir, 'io-package.json'));
            const adapterName = ioPackage.common.name;
            this.log.debug(`Using adapter name "${adapterName}"`);
            return adapterName;
        }
        catch (error) {
            this.log.warn(error);
            this.log.error('You must run dev-server in the adapter root directory (where io-package.json resides).');
            process.exit(-1);
        }
    }
    readPackageJson() {
        return fs_extra_1.readJson(path.join(this.rootDir, 'package.json'));
    }
    getPort(adminPort, offset) {
        let port = adminPort + offset;
        if (port > 65000) {
            port -= 63000;
        }
        return port;
    }
    ////////////////// Command Handlers //////////////////
    async setup(adminPort, jsController, backupFile, force) {
        if (force) {
            this.log.notice(`Deleting ${this.profileDir}`);
            await this.rimraf(this.profileDir);
        }
        if (this.isSetUp()) {
            this.log.error(`dev-server is already set up in "${this.profileDir}".`);
            this.log.debug(`Use --force to set it up from scratch (all data will be lost).`);
            return;
        }
        await this.setupDevServer(adminPort, jsController, backupFile);
        this.log.box(`dev-server was sucessfully set up in\n${this.profileDir}.`);
    }
    async update() {
        this.checkSetup();
        this.log.notice('Updating everything...');
        this.execSync('npm update --loglevel error', this.profileDir);
        await this.installLocalAdapter();
        this.uploadAdapter(this.adapterName);
        this.log.box(`dev-server was sucessfully updated.`);
    }
    async run() {
        this.checkSetup();
        await this.startServer();
    }
    async watch() {
        this.checkSetup();
        await this.installLocalAdapter();
        await this.startServer();
        await this.startAdapterWatch();
    }
    async debug(wait) {
        this.checkSetup();
        await this.installLocalAdapter();
        await this.copySourcemaps();
        await this.startServer();
        await this.startAdapterDebug(wait);
    }
    async upload() {
        this.checkSetup();
        await this.installLocalAdapter();
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
                `http://localhost:${infos.adminPort}`,
                dependencies['iobroker.js-controller'],
                dependencies['iobroker.admin'],
            ];
        });
        table.unshift([chalk_1.bold('Profile Name'), chalk_1.bold('Admin URL'), chalk_1.bold('js-controller'), chalk_1.bold('admin')]);
        this.log.info(`The following profiles exist in ${this.tempDir}`);
        this.log.table(table.filter((r) => !!r));
    }
    ////////////////// Command Helper Methods //////////////////
    async getProfiles() {
        if (!fs_extra_1.existsSync(this.tempDir)) {
            return {};
        }
        const entries = await fs_extra_1.readdir(this.tempDir);
        const pkgs = await Promise.all(entries.map(async (e) => {
            try {
                const pkg = await fs_extra_1.readJson(path.join(this.tempDir, e, 'package.json'));
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
    checkSetup() {
        if (!this.isSetUp()) {
            this.log.error(`dev-server is not set up in ${this.profileDir}.\nPlease use the command "setup" first to set up dev-server.`);
            process.exit(-1);
        }
    }
    isSetUp() {
        const jsControllerDir = path.join(this.profileDir, 'node_modules', CORE_MODULE);
        return fs_extra_1.existsSync(jsControllerDir);
    }
    async startServer() {
        this.log.notice(`Running inside ${this.profileDir}`);
        const tempPkg = await fs_extra_1.readJson(path.join(this.profileDir, 'package.json'));
        const config = tempPkg['dev-server'];
        if (!config) {
            throw new Error(`Couldn't find dev-server configuration in package.json`);
        }
        const proc = this.spawn('node', ['node_modules/iobroker.js-controller/controller.js'], this.profileDir);
        proc.on('exit', (code) => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            process.exit(-1);
        });
        // figure out if we need parcel (React)
        const pkg = await this.readPackageJson();
        const scripts = pkg.scripts;
        if (scripts) {
            if (scripts['watch:react']) {
                // use React with default script name
                await this.startReact();
            }
            else if (scripts['watch:parcel']) {
                // use React with legacy script name
                await this.startReact('watch:parcel');
            }
        }
        this.startBrowserSync(this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET));
        // browser-sync proxy
        const app = express_1.default();
        const adminPattern = `/adapter/${this.adapterName}/**`;
        const pathRewrite = {};
        pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
        app.use(http_proxy_middleware_1.createProxyMiddleware([adminPattern, '/browser-sync/**'], {
            target: `http://localhost:${this.getPort(config.adminPort, HIDDEN_BROWSER_SYNC_PORT_OFFSET)}`,
            //ws: true, // can't have two web-socket connections proxying to different locations
            pathRewrite,
        }));
        // admin proxy
        app.use(http_proxy_middleware_1.createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
            target: `http://localhost:${this.getPort(config.adminPort, HIDDEN_ADMIN_PORT_OFFSET)}`,
            ws: true,
        }));
        // start express
        this.log.notice(`Starting web server on port ${config.adminPort}`);
        const server = app.listen(config.adminPort);
        process.on('SIGINT', () => {
            this.log.notice('dev-server is exiting...');
            server.close();
            // do not kill this process when receiving SIGINT, but let all child processes exit first
        });
        await new Promise((resolve, reject) => {
            server.on('listening', resolve);
            server.on('error', reject);
            server.on('close', reject);
        });
        this.log.box(`Admin is now reachable under http://localhost:${config.adminPort}/`);
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
            this.patchSourcemap(src, dest);
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
            await fs_extra_1.writeFile(mapFile, JSON.stringify(data));
            // append the sourcemap reference comment to the bottom of the file
            const fileContent = await fs_extra_1.readFile(copyFromSrc ? src : dest, { encoding: 'utf-8' });
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
            await fs_extra_1.writeFile(dest, updatedContent);
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
            const data = await fs_extra_1.readJson(src);
            if (data.version !== 3) {
                throw new Error(`Unsupported sourcemap version: ${data.version}`);
            }
            data.sourceRoot = path.dirname(src).replace(/\\/g, '/');
            await fs_extra_1.writeJson(dest, data);
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
        patterns.push('!./node_modules/**');
        patterns.push('!./test/**');
        if (excludeAdmin) {
            patterns.push('!./admin/**');
        }
        return patterns;
    }
    async findFiles(extension, excludeAdmin) {
        return await fast_glob_1.default(this.getFilePatterns(extension, excludeAdmin), { cwd: this.rootDir });
    }
    async createIdentitySourcemap(filename) {
        // thanks to https://github.com/gulp-sourcemaps/identity-map/blob/251b51598d02e5aedaea8f1a475dfc42103a2727/lib/generate.js [MIT]
        const generator = new source_map_1.SourceMapGenerator({ file: filename });
        const fileContent = await fs_extra_1.readFile(filename, { encoding: 'utf-8' });
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
    async startReact(scriptName = 'watch:react') {
        this.log.notice('Starting React build');
        this.log.debug('Waiting for first successful React build...');
        await this.spawnAndAwaitOutput('npm', ['run', scriptName], this.rootDir, /(built in|done in|watching (files )?for)/i, {
            shell: true,
        });
    }
    startBrowserSync(port) {
        this.log.notice('Starting browser-sync');
        const bs = browser_sync_1.default.create();
        const adminPath = path.resolve(this.rootDir, 'admin/');
        const config = {
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
    async startAdapterDebug(wait) {
        this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
        const args = [IOBROKER_CLI, 'debug', `${this.adapterName}.0`];
        if (wait) {
            args.push('--wait');
        }
        const proc = this.spawn('node', args, this.profileDir);
        proc.on('exit', (code) => {
            console.error(chalk.yellow(`Adapter debugging exited with code ${code}`));
            process.exit(-1);
        });
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
        return new Promise((resolve, reject) => ps_tree_1.default(parentPid, (err, children) => {
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
    async startAdapterWatch() {
        // figure out if we need to watch for TypeScript changes
        const pkg = await this.readPackageJson();
        const scripts = pkg.scripts;
        if (scripts && scripts['watch:ts']) {
            // use TSC
            await this.startTscWatch();
        }
        // start sync
        const adapterRunDir = path.join(this.profileDir, 'node_modules', `iobroker.${this.adapterName}`);
        await this.startFileSync(adapterRunDir);
        this.startNodemon(adapterRunDir, pkg.main);
    }
    async startTscWatch() {
        this.log.notice('Starting tsc --watch');
        this.log.debug('Waiting for first successful tsc build...');
        await this.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], this.rootDir, /watching (files )?for/i, { shell: true });
    }
    startFileSync(destinationDir) {
        this.log.notice(`Starting file system sync from ${this.rootDir}`);
        const inSrc = (filename) => path.join(this.rootDir, filename);
        const inDest = (filename) => path.join(destinationDir, filename);
        return new Promise((resolve, reject) => {
            const patterns = this.getFilePatterns(['js', 'map'], true);
            const ignoreFiles = [];
            const watcher = chokidar_1.default.watch(patterns, { cwd: this.rootDir });
            let ready = false;
            watcher.on('error', reject);
            watcher.on('ready', () => {
                ready = true;
                resolve();
            });
            /*watcher.on('all', (event, path) => {
              console.log(event, path);
            });*/
            const syncFile = async (filename) => {
                try {
                    this.log.debug(`Synchronizing ${filename}`);
                    const src = inSrc(filename);
                    const dest = inDest(filename);
                    if (filename.endsWith('.map')) {
                        await this.patchSourcemap(src, dest);
                    }
                    else if (!fs_extra_1.existsSync(inSrc(`${filename}.map`))) {
                        // copy file and add sourcemap
                        await this.addSourcemap(src, dest, true);
                    }
                    else {
                        await fs_extra_1.copyFile(src, dest);
                    }
                }
                catch (error) {
                    this.log.warn(`Couldn't sync ${filename}`);
                }
            };
            watcher.on('add', (filename) => {
                if (ready) {
                    syncFile(filename);
                }
                else if (!filename.endsWith('map') && !fs_extra_1.existsSync(inDest(filename))) {
                    // ignore files during initial sync if they don't exist in the target directory
                    ignoreFiles.push(filename);
                }
                else {
                    this.log.debug(`Watching ${filename}`);
                }
            });
            watcher.on('change', (filename) => {
                if (!ignoreFiles.includes(filename)) {
                    syncFile(filename);
                }
            });
            watcher.on('unlink', (filename) => {
                fs_extra_1.unlinkSync(inDest(filename));
                const map = inDest(filename + '.map');
                if (fs_extra_1.existsSync(map)) {
                    fs_extra_1.unlinkSync(map);
                }
            });
        });
    }
    startNodemon(baseDir, scriptName) {
        const script = path.resolve(baseDir, scriptName);
        this.log.notice(`Starting nodemon for ${script}`);
        let isExiting = false;
        process.on('SIGINT', () => {
            isExiting = true;
        });
        nodemon_1.default({
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
            process.exit(-2);
        });
    }
    async handleNodemonDetailMsg(message) {
        const match = message.match(/child pid: (\d+)/);
        if (!match) {
            return;
        }
        const debigPid = await this.waitForNodeChildProcess(parseInt(match[1]));
        this.log.box(`Debugger is now available on process id ${debigPid}`);
    }
    async setupDevServer(adminPort, jsController, backupFile) {
        this.log.notice(`Setting up in ${this.profileDir}`);
        // create the data directory
        const dataDir = path.join(this.profileDir, 'iobroker-data');
        await fs_extra_1.mkdirp(dataDir);
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
        await fs_extra_1.writeJson(path.join(dataDir, 'iobroker.json'), config, { spaces: 2 });
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
        await fs_extra_1.writeJson(path.join(this.profileDir, 'package.json'), pkg, { spaces: 2 });
        this.log.notice('Installing js-controller and admin...');
        this.execSync('npm install --loglevel error --production', this.profileDir);
        if (backupFile) {
            const fullPath = path.resolve(backupFile);
            this.log.notice(`Restoring backup from ${fullPath}`);
            this.execSync(`${IOBROKER_COMMAND} restore "${fullPath}"`, this.profileDir);
        }
        this.uploadAndAddAdapter('admin');
        // reconfigure admin instance (only listen to local IP address)
        this.log.notice('Configure admin.0');
        this.execSync(`${IOBROKER_COMMAND} set admin.0 --port ${this.getPort(adminPort, HIDDEN_ADMIN_PORT_OFFSET)} --bind 127.0.0.1`, this.profileDir);
        // install local adapter
        await this.installLocalAdapter();
        this.uploadAndAddAdapter(this.adapterName);
        // installing any dependencies
        const { common } = await fs_extra_1.readJson(path.join(this.rootDir, 'io-package.json'));
        const dependencies = [
            ...this.getDependencies(common.dependencies),
            ...this.getDependencies(common.globalDependencies),
        ];
        this.log.debug(`Found ${dependencies.length} adapter dependencies`);
        for (const adapter of dependencies) {
            try {
                await this.installRepoAdapter(adapter);
            }
            catch (error) {
                this.log.debug(`Couldn't install iobroker.${adapter}: ${error}`);
            }
        }
        this.log.notice(`Stop ${this.adapterName}.0`);
        this.execSync(`${IOBROKER_COMMAND} stop ${this.adapterName} 0`, this.profileDir);
        this.log.notice('Disable statistics reporting');
        this.execSync(`${IOBROKER_COMMAND} object set system.config common.diag="none"`, this.profileDir);
        this.log.notice('Disable license confirmation');
        this.execSync(`${IOBROKER_COMMAND} object set system.config common.licenseConfirmed=true`, this.profileDir);
        this.log.notice('Disable missing info adapter warning');
        this.execSync(`${IOBROKER_COMMAND} object set system.config common.infoAdapterInstall=true`, this.profileDir);
    }
    uploadAndAddAdapter(name) {
        // upload the already installed adapter
        this.uploadAdapter(name);
        const command = `${IOBROKER_COMMAND} list instances`;
        const instances = this.getExecSyncOutput(command, this.profileDir);
        if (instances.includes(`system.adapter.${name}.0 `)) {
            this.log.info(`Instance ${name}.0 already exists, not adding it again`);
            return;
        }
        // create an instance
        this.log.notice(`Add ${name}.0`);
        this.execSync(`${IOBROKER_COMMAND} add ${name} 0`, this.profileDir);
    }
    uploadAdapter(name) {
        this.log.notice(`Upload iobroker.${name}`);
        this.execSync(`${IOBROKER_COMMAND} upload ${name}`, this.profileDir);
    }
    async installLocalAdapter() {
        this.log.notice(`Install local iobroker.${this.adapterName}`);
        const filename = this.getExecSyncOutput('npm pack', this.rootDir).trim();
        this.log.info(`Packed to ${filename}`);
        const fullPath = path.join(this.rootDir, filename);
        this.execSync(`npm install --no-save "${fullPath}"`, this.profileDir);
        await this.rimraf(fullPath);
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
    execSync(command, cwd, options) {
        options = { cwd: cwd, stdio: 'inherit', ...options };
        this.log.debug(`${cwd}> ${command}`);
        return cp.execSync(command, options);
    }
    getExecSyncOutput(command, cwd) {
        this.log.debug(`${cwd}> ${command}`);
        return cp.execSync(command, { cwd, encoding: 'ascii' });
    }
    spawn(command, args, cwd, options) {
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
    spawnAndAwaitOutput(command, args, cwd, awaitMsg, options) {
        return new Promise((resolve, reject) => {
            var _a;
            const proc = this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
            (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
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
                }
                else {
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
    rimraf(name) {
        return new Promise((resolve, reject) => rimraf(name, (err) => (err ? reject(err) : resolve())));
    }
}
(() => new DevServer())();
