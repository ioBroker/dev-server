import chalk from 'chalk';
import { IOBROKER_CLI, IOBROKER_CONTROLLER } from './CommandBase.js';
import { RemoteConnection } from './RemoteConnection.js';
import { RunCommandBase } from './RunCommandBase.js';
const DEBUGGER_PORT = 9229;
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
            await this.profileDir.tunnelPort(DEBUGGER_PORT);
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
            args.unshift(`--inspect=127.0.0.1:${DEBUGGER_PORT}`);
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
            debugTarget = `port 127.0.0.1:${DEBUGGER_PORT}`;
        }
        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on ${debugTarget}`);
    }
}
