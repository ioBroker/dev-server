"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Watch = void 0;
const chokidar_1 = __importDefault(require("chokidar"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const fs_extra_1 = require("fs-extra");
const node_path_1 = __importDefault(require("node:path"));
const nodemon_1 = __importDefault(require("nodemon"));
const RunCommandBase_1 = require("./RunCommandBase");
const utils_1 = require("./utils");
class Watch extends RunCommandBase_1.RunCommandBase {
    constructor(owner, startAdapter, noInstall, doNotWatch, useBrowserSync) {
        super(owner);
        this.startAdapter = startAdapter;
        this.noInstall = noInstall;
        this.doNotWatch = doNotWatch;
        this.useBrowserSync = useBrowserSync;
    }
    async run() {
        if (!this.noInstall) {
            await this.buildLocalAdapter();
            await this.installLocalAdapter();
        }
        if (this.isJSController()) {
            // this watches actually js-controller
            await this.startAdapterWatch();
            await this.startServer(this.useBrowserSync);
        }
        else {
            await this.startJsController();
            await this.startServer(this.useBrowserSync);
            await this.startAdapterWatch();
        }
    }
    async startAdapterWatch() {
        var _a;
        // figure out if we need to watch for TypeScript changes
        const pkg = await this.readPackageJson();
        const scripts = pkg.scripts;
        if (scripts && scripts['watch:ts']) {
            this.log.notice(`Starting TypeScript watch: ${this.startAdapter}`);
            // use TSC
            await this.startTscWatch();
        }
        const isTypeScriptMain = this.isTypeScriptMain(pkg.main);
        const mainFileSuffix = pkg.main.split('.').pop();
        // start sync
        const adapterRunDir = node_path_1.default.join(this.profileDir, 'node_modules', `iobroker.${this.adapterName}`);
        if (!((_a = this.config) === null || _a === void 0 ? void 0 : _a.useSymlinks)) {
            this.log.notice('Starting file synchronization');
            // This is not necessary when using symlinks
            await this.startFileSync(adapterRunDir, mainFileSuffix);
            this.log.notice('File synchronization ready');
        }
        if (this.startAdapter) {
            await (0, utils_1.delay)(3000);
            this.log.notice('Starting Nodemon');
            await this.startNodemon(adapterRunDir, pkg.main, this.doNotWatch);
        }
        else {
            const runner = isTypeScriptMain ? 'node -r @alcalzone/esbuild-register' : 'node';
            this.log.box(`You can now start the adapter manually by running\n    ` +
                `${runner} node_modules/iobroker.${this.adapterName}/${pkg.main} --debug 0\nfrom within\n    ${this.profileDir}`);
        }
    }
    async startTscWatch() {
        this.log.notice('Starting tsc --watch');
        this.log.debug('Waiting for first successful tsc build...');
        await this.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], this.rootDir, /watching (files )?for/i, {
            shell: true,
        });
    }
    startFileSync(destinationDir, mainFileSuffix) {
        this.log.notice(`Starting file system sync from ${this.rootDir}`);
        const inSrc = (filename) => node_path_1.default.join(this.rootDir, filename);
        const inDest = (filename) => node_path_1.default.join(destinationDir, filename);
        return new Promise((resolve, reject) => {
            const patternList = ['js', 'map'];
            if (!patternList.includes(mainFileSuffix)) {
                patternList.push(mainFileSuffix);
            }
            const patterns = this.getFilePatterns(patternList, true);
            const ignoreFiles = [];
            const watcher = chokidar_1.default.watch(fast_glob_1.default.sync(patterns), { cwd: this.rootDir });
            let ready = false;
            let initialEventPromises = [];
            watcher.on('error', reject);
            watcher.on('ready', async () => {
                this.log.debug('Initial scan complete. Ready for changes.');
                ready = true;
                await Promise.all(initialEventPromises);
                initialEventPromises = [];
                resolve();
            });
            watcher.on('all', (event, path) => {
                console.log(event, path);
            });
            const syncFile = async (filename) => {
                try {
                    this.log.debug(`Synchronizing ${filename}`);
                    const src = inSrc(filename);
                    const dest = inDest(filename);
                    if (filename.endsWith('.map')) {
                        await this.patchSourcemap(src, dest);
                    }
                    else if (!(0, fs_extra_1.existsSync)(inSrc(`${filename}.map`))) {
                        // copy file and add sourcemap
                        await this.addSourcemap(src, dest, true);
                    }
                    else {
                        await (0, fs_extra_1.copyFile)(src, dest);
                    }
                }
                catch (_a) {
                    this.log.warn(`Couldn't sync ${filename}`);
                }
            };
            watcher.on('add', (filename) => {
                if (ready) {
                    void syncFile(filename);
                }
                else if (!filename.endsWith('map') && !(0, fs_extra_1.existsSync)(inDest(filename))) {
                    // ignore files during initial sync if they don't exist in the target directory (except for sourcemaps)
                    ignoreFiles.push(filename);
                }
                else {
                    initialEventPromises.push(syncFile(filename));
                }
            });
            watcher.on('change', (filename) => {
                if (!ignoreFiles.includes(filename)) {
                    const resPromise = syncFile(filename);
                    if (!ready) {
                        initialEventPromises.push(resPromise);
                    }
                }
            });
            watcher.on('unlink', (filename) => {
                (0, fs_extra_1.unlinkSync)(inDest(filename));
                const map = inDest(`${filename}.map`);
                if ((0, fs_extra_1.existsSync)(map)) {
                    (0, fs_extra_1.unlinkSync)(map);
                }
            });
        });
    }
    startNodemon(baseDir, scriptName, doNotWatch) {
        const script = node_path_1.default.resolve(baseDir, scriptName);
        this.log.notice(`Starting nodemon for ${script}`);
        let isExiting = false;
        process.on('SIGINT', () => {
            isExiting = true;
        });
        const args = this.isJSController() ? [] : ['--debug', '0'];
        const ignoreList = [
            node_path_1.default.join(baseDir, 'admin'),
            // avoid recursively following symlinks
            node_path_1.default.join(baseDir, '.dev-server'),
        ];
        if (doNotWatch.length > 0) {
            doNotWatch.forEach(entry => ignoreList.push(node_path_1.default.join(baseDir, entry)));
        }
        // Determine the appropriate execMap
        const execMap = {
            js: 'node --inspect --preserve-symlinks --preserve-symlinks-main',
            mjs: 'node --inspect --preserve-symlinks --preserve-symlinks-main',
            ts: 'node --inspect --preserve-symlinks --preserve-symlinks-main -r @alcalzone/esbuild-register',
        };
        (0, nodemon_1.default)({
            script,
            cwd: baseDir,
            stdin: false,
            verbose: true,
            // dump: true, // this will output the entire config and not do anything
            colours: false,
            watch: [baseDir],
            ignore: ignoreList,
            ignoreRoot: [],
            delay: 2000,
            execMap,
            signal: 'SIGINT', // wrong type definition: signal is of type "string?"
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
                    void this.handleNodemonDetailMsg(msg.message);
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
                    this.log.notice('Adapter configuration changed, restarting nodemon...');
                    nodemon_1.default.restart();
                }
            });
        }
        return Promise.resolve();
    }
    async handleNodemonDetailMsg(message) {
        const match = message.match(/child pid: (\d+)/);
        if (!match) {
            return;
        }
        const debugPid = await this.waitForNodeChildProcess(parseInt(match[1]));
        this.log.box(`Debugger is now available on process id ${debugPid}`);
    }
}
exports.Watch = Watch;
