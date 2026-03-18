import chalk from 'chalk';
import path from 'node:path';
import { IOBROKER_CLI, IOBROKER_CONTROLLER } from './CommandBase.js';
import { RemoteConnection } from './RemoteConnection.js';
import { ADAPTER_DEBUGGER_PORT, RunCommandBase } from './RunCommandBase.js';
export class Debug extends RunCommandBase {
    wait;
    noInstall;
    constructor(owner, wait, noInstall) {
        super(owner);
        this.wait = wait;
        this.noInstall = noInstall;
    }
    async prepare() {
        await super.prepare();
        if (this.profileDir instanceof RemoteConnection) {
            await this.profileDir.tunnelPort(ADAPTER_DEBUGGER_PORT);
        }
    }
    async doRun() {
        if (!this.noInstall) {
            await this.buildLocalAdapter();
            await this.installLocalAdapter();
        }
        await this.copySourcemaps();
        if (this.isJSController()) {
            await this.startJsControllerDebug();
            await this.startServer();
        }
        else {
            await this.startJsController();
            await this.startServer();
            await this.startAdapterDebug();
        }
    }
    async copySourcemaps() {
        const outDir = path.join('node_modules', `iobroker.${this.adapterName}`);
        this.log.notice(`Creating or patching sourcemaps in ${outDir}`);
        const sourcemaps = await this.findFiles('map', true);
        if (sourcemaps.length === 0) {
            this.log.debug(`Couldn't find any sourcemaps in ${this.rootPath},\nwill try to reverse map .js files`);
            // search all .js files that exist in the node module in the temp directory as well as in the root directory and
            // create sourcemap files for each of them
            const jsFiles = await this.findFiles('js', true);
            await Promise.all(jsFiles.map(async (js) => {
                const src = path.join(this.rootPath, js);
                const dest = path.join(outDir, js);
                await this.addSourcemap(src, dest, false);
            }));
            return;
        }
        // copy all *.map files to the node module in the temp directory and
        // change their sourceRoot so they can be found in the development directory
        await Promise.all(sourcemaps.map(async (sourcemap) => {
            const src = path.join(this.rootPath, sourcemap);
            const dest = path.join(outDir, sourcemap);
            await this.patchSourcemap(src, dest);
        }));
    }
    async startJsControllerDebug() {
        this.log.notice(`Starting debugger for ${this.adapterName}`);
        const nodeArgs = ['--preserve-symlinks', '--preserve-symlinks-main', IOBROKER_CONTROLLER];
        if (this.wait) {
            nodeArgs.unshift('--inspect-brk');
        }
        else {
            nodeArgs.unshift('--inspect');
        }
        const pid = await this.profileDir.spawn('node', nodeArgs, code => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1);
        });
        await this.waitForJsController();
        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on process id ${pid}`);
    }
    async startAdapterDebug() {
        this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
        const args = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            IOBROKER_CLI,
            'debug',
            `${this.adapterName}.0`,
        ];
        if (this.config.remote) {
            args.unshift(`--inspect=127.0.0.1:${ADAPTER_DEBUGGER_PORT}`);
        }
        if (this.wait) {
            args.push('--wait');
        }
        const pid = await this.profileDir.spawn('node', args, code => {
            console.error(chalk.yellow(`Adapter debugging exited with code ${code}`));
            return this.exit(-1);
        });
        let debugTarget;
        if (pid) {
            const debugPid = await this.waitForNodeChildProcess(pid);
            debugTarget = `process id ${debugPid}`;
        }
        else {
            debugTarget = `port 127.0.0.1:${ADAPTER_DEBUGGER_PORT}`;
        }
        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on ${debugTarget}`);
    }
}
