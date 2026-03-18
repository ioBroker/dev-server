import path from 'node:path';
import { rimraf } from 'rimraf';
import type { DevServer, DevServerConfig } from '../DevServer.js';
import type { Logger } from '../logger.js';
import type { IEnvironment } from './IEnvironment.js';
import { LocalDirectory } from './LocalDirectory.js';
import { RemoteConnection } from './RemoteConnection.js';
import { getChildProcesses, readJson } from './utils.js';

export const IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
export const IOBROKER_COMMAND = `node ${IOBROKER_CLI}`;
export const IOBROKER_CONTROLLER = 'node_modules/iobroker.js-controller/controller.js';

export const HIDDEN_ADMIN_PORT_OFFSET = 12345;
export const HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
export const STATES_DB_PORT_OFFSET = 16345;
export const OBJECTS_DB_PORT_OFFSET = 18345;

export abstract class CommandBase {
    protected readonly rootDir: LocalDirectory;
    protected profileDir: IEnvironment;

    constructor(protected readonly owner: DevServer) {
        this.rootDir = new LocalDirectory(this.rootPath, this.log);
        if (this.owner.config?.remote) {
            this.profileDir = new RemoteConnection(this.owner.config.remote, this.log);
        } else {
            this.profileDir = new LocalDirectory(this.profilePath, this.log);
        }
    }

    protected get log(): Logger {
        return this.owner.log;
    }

    protected get rootPath(): string {
        return this.owner.rootPath;
    }

    protected get profilePath(): string {
        return this.owner.profilePath;
    }

    protected get adapterName(): string {
        return this.owner.adapterName;
    }

    protected get config(): DevServerConfig {
        if (!this.owner.config) {
            throw new Error('DevServer is not configured yet');
        }

        return this.owner.config;
    }

    public async run(): Promise<void> {
        await this.prepare();
        await this.doRun();
        await this.teardown();
    }

    protected async prepare(): Promise<void> {
        if (this.profileDir instanceof RemoteConnection) {
            await this.profileDir.connect();
        }
    }

    protected abstract doRun(): Promise<void>;

    protected teardown(): Promise<void> {
        if (this.profileDir instanceof RemoteConnection) {
            this.profileDir.close();
        }

        return Promise.resolve();
    }

    protected getPort(offset: number): number {
        return this.config.adminPort + offset;
    }

    protected isJSController(): boolean {
        return this.adapterName === 'js-controller';
    }

    protected readPackageJson(): Promise<any> {
        return this.rootDir.readJson('package.json');
    }

    /**
     * Read and parse the io-package.json file from the adapter directory
     *
     * @returns Promise resolving to the parsed io-package.json content
     */
    protected readIoPackageJson(): Promise<any> {
        return this.rootDir.readJson('io-package.json');
    }

    protected isTypeScriptMain(mainFile: string): boolean {
        return !!(mainFile && mainFile.endsWith('.ts'));
    }

    protected async installLocalAdapter(doInstall = true): Promise<void> {
        this.log.notice(`Install local iobroker.${this.adapterName}`);

        if (this.config.useSymlinks) {
            // This is the expected relative path
            const relativePath = path.relative(this.profilePath, this.rootPath);
            // Check if it is already used in package.json
            const tempPkg = await readJson(path.join(this.profilePath, 'package.json'));
            const depPath = tempPkg.dependencies?.[`iobroker.${this.adapterName}`];
            // If not, install it
            if (depPath !== relativePath) {
                await this.profileDir.exec(`npm install "${relativePath}"`);
            }
        } else {
            const { stdout } = await this.rootDir.getExecOutput('npm pack');
            const filename = stdout.trim();
            this.log.info(`Packed to ${filename}`);
            const fullPath = path.join(this.rootPath, filename);
            if (doInstall) {
                await this.profileDir.execWithExistingFile(fullPath, f => `npm install "${f}"`);
                await rimraf(fullPath);
            } else {
                await this.profileDir.execWithExistingFile(fullPath, f => `ls -la "${f}"`);
            }
        }
    }

    protected async buildLocalAdapter(): Promise<void> {
        const pkg = await this.readPackageJson();
        if (pkg.scripts?.build) {
            this.log.notice(`Build iobroker.${this.adapterName}`);
            await this.rootDir.exec('npm run build');
        }
    }

    protected async uploadAdapter(name: string): Promise<void> {
        this.log.notice(`Upload iobroker.${name}`);
        await this.profileDir.exec(`${IOBROKER_COMMAND} upload ${name}`);
    }

    protected async exit(exitCode: number, signal = 'SIGINT'): Promise<never> {
        await this.rootDir.exitChildProcesses(signal);
        await this.profileDir.exitChildProcesses(signal);
        process.exit(exitCode);
    }

    protected async waitForNodeChildProcess(parentPid: number): Promise<number | undefined> {
        const start = new Date().getTime();
        while (start + 2000 > new Date().getTime()) {
            const processes = await getChildProcesses(parentPid);
            const child = processes.find(p => p.COMMAND.match(/node/i));
            if (child) {
                return parseInt(child.PID);
            }
        }

        this.log.debug(`No node child process of ${parentPid} found, assuming parent process was reused.`);
        return parentPid;
    }
}
