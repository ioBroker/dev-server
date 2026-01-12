"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Debug = void 0;
const chalk_1 = __importDefault(require("chalk"));
const CommandBase_1 = require("./CommandBase");
const RunCommandBase_1 = require("./RunCommandBase");
class Debug extends RunCommandBase_1.RunCommandBase {
    constructor(owner, wait, noInstall) {
        super(owner);
        this.wait = wait;
        this.noInstall = noInstall;
    }
    async run() {
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
        const nodeArgs = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            'node_modules/iobroker.js-controller/controller.js',
        ];
        if (this.wait) {
            nodeArgs.unshift('--inspect-brk');
        }
        else {
            nodeArgs.unshift('--inspect');
        }
        const proc = await this.spawn('node', nodeArgs, this.profileDir);
        proc.on('exit', code => {
            console.error(chalk_1.default.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1);
        });
        await this.waitForJsController();
        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on process id ${proc.pid}`);
    }
    async startAdapterDebug() {
        this.log.notice(`Starting ioBroker adapter debugger for ${this.adapterName}.0`);
        const args = [
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            CommandBase_1.IOBROKER_CLI,
            'debug',
            `${this.adapterName}.0`,
        ];
        if (this.wait) {
            args.push('--wait');
        }
        const proc = await this.spawn('node', args, this.profileDir);
        proc.on('exit', code => {
            console.error(chalk_1.default.yellow(`Adapter debugging exited with code ${code}`));
            return this.exit(-1);
        });
        if (!proc.pid) {
            throw new Error(`PID of adapter debugger unknown!`);
        }
        const debugPid = await this.waitForNodeChildProcess(proc.pid);
        this.log.box(`Debugger is now ${this.wait ? 'waiting' : 'available'} on process id ${debugPid}`);
    }
}
exports.Debug = Debug;
