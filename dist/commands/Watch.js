import chokidar from 'chokidar';
import fg from 'fast-glob';
import { existsSync } from 'node:fs';
import path from 'node:path';
import nodemon from 'nodemon';
import { RunCommandBase } from './RunCommandBase.js';
import { delay } from './utils.js';
export class Watch extends RunCommandBase {
    startAdapter;
    noInstall;
    doNotWatch;
    useBrowserSync;
    constructor(owner, startAdapter, noInstall, doNotWatch, useBrowserSync) {
        super(owner);
        this.startAdapter = startAdapter;
        this.noInstall = noInstall;
        this.doNotWatch = doNotWatch;
        this.useBrowserSync = useBrowserSync;
    }
    async doRun() {
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
        const adapterRunDir = path.join('node_modules', `iobroker.${this.adapterName}`);
        if (!this.config.useSymlinks) {
            this.log.notice('Starting file synchronization');
            // This is not necessary when using symlinks
            await this.startFileSync(adapterRunDir, mainFileSuffix);
            this.log.notice('File synchronization ready');
        }
        if (this.startAdapter) {
            await delay(3000);
            await this.startNodemon(adapterRunDir, pkg.main);
        }
        else {
            const runner = isTypeScriptMain ? 'node -r @alcalzone/esbuild-register' : 'node';
            this.log.box(`You can now start the adapter manually by running\n    ` +
                `${runner} node_modules/iobroker.${this.adapterName}/${pkg.main} --debug 0\nfrom within\n    ${this.profilePath}`);
        }
    }
    async startTscWatch() {
        this.log.notice('Starting tsc --watch');
        this.log.debug('Waiting for first successful tsc build...');
        await this.rootDir.spawnAndAwaitOutput('npm', ['run', 'watch:ts'], /watching (files )?for/i, {
            shell: true,
        });
    }
    startFileSync(destinationDir, mainFileSuffix) {
        this.log.debug(`Starting file system sync from ${this.rootPath} to ${destinationDir}`);
        const inSrc = (filename) => path.join(this.rootPath, filename);
        const inDest = (filename) => path.join(destinationDir, filename);
        return new Promise((resolve, reject) => {
            const patternList = ['js', 'map'];
            if (!patternList.includes(mainFileSuffix)) {
                patternList.push(mainFileSuffix);
            }
            const patterns = this.getFilePatterns(patternList, true);
            const ignoreFiles = [];
            const watcher = chokidar.watch(fg.sync(patterns), { cwd: this.rootPath });
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
            /* For debugging:
            watcher.on('all', (event, path) => {
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
                    else if (!existsSync(inSrc(`${filename}.map`))) {
                        // copy file and add sourcemap
                        await this.addSourcemap(src, dest, true);
                    }
                    else {
                        await this.profileDir.copyFileTo(src, dest);
                    }
                }
                catch {
                    this.log.warn(`Couldn't sync ${filename}`);
                }
            };
            watcher.on('add', async (filename) => {
                if (ready) {
                    await syncFile(filename);
                }
                else if (!filename.endsWith('.map') && !(await this.profileDir.exists(inDest(filename)))) {
                    // ignore files during initial sync if they don't exist in the target directory (except for sourcemaps)
                    this.log.silly(`Ignoring file ${filename}`);
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
            watcher.on('unlink', async (filename) => {
                await this.profileDir.unlink(inDest(filename));
                const map = inDest(`${filename}.map`);
                if (await this.profileDir.exists(map)) {
                    await this.profileDir.unlink(map);
                }
            });
        });
    }
    startNodemon(baseDir, scriptName) {
        const fullBaseDir = path.resolve(this.profilePath, baseDir);
        const script = path.resolve(fullBaseDir, scriptName);
        this.log.notice(`Starting nodemon for ${script}`);
        let isExiting = false;
        process.on('SIGINT', () => {
            isExiting = true;
        });
        nodemon(this.createNodemonConfig(script, fullBaseDir));
        nodemon
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
                    nodemon.restart();
                }
            });
        }
        return Promise.resolve();
    }
    createNodemonConfig(script, fullBaseDir) {
        const args = this.isJSController() ? [] : ['--debug', '0'];
        const ignoreList = [
            path.join(fullBaseDir, 'admin'),
            // avoid recursively following symlinks
            path.join(fullBaseDir, '.dev-server'),
        ];
        if (this.doNotWatch.length > 0) {
            this.doNotWatch.forEach(entry => ignoreList.push(path.join(fullBaseDir, entry)));
        }
        // Determine the appropriate execMap
        const execMap = {
            js: 'node --inspect --preserve-symlinks --preserve-symlinks-main',
            mjs: 'node --inspect --preserve-symlinks --preserve-symlinks-main',
            ts: 'node --inspect --preserve-symlinks --preserve-symlinks-main -r @alcalzone/esbuild-register',
        };
        return {
            script,
            cwd: fullBaseDir,
            stdin: false,
            verbose: true,
            // dump: true, // this will output the entire config and not do anything
            colours: false,
            watch: [fullBaseDir],
            ignore: ignoreList,
            ignoreRoot: [],
            delay: 2000,
            execMap,
            signal: 'SIGINT',
            args,
        };
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
