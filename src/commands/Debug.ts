import chalk from 'chalk';
import type { DevServer } from '../DevServer.js';
import { IOBROKER_CLI } from './CommandBase.js';
import { RunCommandBase } from './RunCommandBase.js';

export class Debug extends RunCommandBase {
    constructor(
        owner: DevServer,
        private readonly wait: boolean,
        private readonly noInstall: boolean,
    ) {
        super(owner);
    }

    public async run(): Promise<void> {
        if (!this.noInstall) {
            await this.buildLocalAdapter();
            await this.installLocalAdapter();
        }

        await this.copySourcemaps();

        if (this.isJSController()) {
            await this.startJsControllerDebug();
            await this.startServer();
        } else {
            await this.startJsController();
            await this.startServer();
            await this.startAdapterDebug();
        }
    }

    private async startJsControllerDebug(): Promise<void> {
        this.log.notice(`Starting debugger for ${this.adapterName}`);

        const nodeArgs = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            'node_modules/iobroker.js-controller/controller.js',
        ];
        if (this.wait) {
            nodeArgs.unshift('--inspect-brk');
        } else {
            nodeArgs.unshift('--inspect');
        }
        const pid = await this.profileDir.spawn('node', nodeArgs, code => {
            console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1);
        });
        await this.waitForJsController();

        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on process id ${pid}`);
    }

    private async startAdapterDebug(): Promise<void> {
        this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
        const args = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            IOBROKER_CLI,
            'debug',
            `${this.adapterName}.0`,
        ];
        if (this.wait) {
            args.push('--wait');
        }
        const pid = await this.profileDir.spawn('node', args, code => {
            console.error(chalk.yellow(`Adapter debugging exited with code ${code}`));
            return this.exit(-1);
        });

        if (!pid) {
            throw new Error(`PID of adapter debugger unknown!`);
        }
        const debugPid = await this.waitForNodeChildProcess(pid);

        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on process id ${debugPid}`);
    }
}
