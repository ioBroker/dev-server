import { DBConnection } from '@iobroker/testing/build/tests/integration/lib/dbConnection';
import { readJson } from 'fs-extra';
import * as cp from 'node:child_process';
import path from 'node:path';
import psTree from 'ps-tree';
import { rimraf } from 'rimraf';
import type { DevServer } from '../DevServer';
import { delay } from './utils';

export const IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
export const IOBROKER_COMMAND = `node ${IOBROKER_CLI}`;

export const HIDDEN_ADMIN_PORT_OFFSET = 12345;
export const HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
export const STATES_DB_PORT_OFFSET = 16345;
export const OBJECTS_DB_PORT_OFFSET = 18345;

export abstract class CommandBase {
    protected readonly childProcesses: cp.ChildProcess[] = [];

    constructor(protected readonly owner: DevServer) {}

    protected get log() {
        return this.owner.log;
    }

    protected get rootDir(): string {
        return this.owner.rootDir;
    }

    protected get profileDir(): string {
        return this.owner.profileDir;
    }

    protected get profileName(): string {
        return this.owner.profileName;
    }

    protected get adapterName(): string {
        return this.owner.adapterName;
    }

    protected get config() {
        if (!this.owner.config) {
            throw new Error('DevServer is not configured yet');
        }

        return this.owner.config;
    }

    public abstract run(): Promise<void>;

    protected getPort(offset: number): number {
        return this.config.adminPort + offset;
    }

    protected isJSController(): boolean {
        return this.adapterName === 'js-controller';
    }

    protected readPackageJson(): Promise<any> {
        return readJson(path.join(this.rootDir, 'package.json'));
    }

    /**
     * Read and parse the io-package.json file from the adapter directory
     *
     * @returns Promise resolving to the parsed io-package.json content
     */
    protected async readIoPackageJson(): Promise<any> {
        return readJson(path.join(this.rootDir, 'io-package.json'));
    }

    protected isTypeScriptMain(mainFile: string): boolean {
        return !!(mainFile && mainFile.endsWith('.ts'));
    }

    protected async installLocalAdapter(doInstall = true): Promise<void> {
        this.log.notice(`Install local iobroker.${this.adapterName}`);

        if (this.config.useSymlinks) {
            // This is the expected relative path
            const relativePath = path.relative(this.profileDir, this.rootDir);
            // Check if it is already used in package.json
            const tempPkg = await readJson(path.join(this.profileDir, 'package.json'));
            const depPath = tempPkg.dependencies?.[`iobroker.${this.adapterName}`];
            // If not, install it
            if (depPath !== relativePath) {
                this.execSync(`npm install "${relativePath}"`, this.profileDir);
            }
        } else {
            const { stdout } = await this.getExecOutput('npm pack', this.rootDir);
            const filename = stdout.trim();
            this.log.info(`Packed to ${filename}`);
            if (doInstall) {
                const fullPath = path.join(this.rootDir, filename);
                this.execSync(`npm install "${fullPath}"`, this.profileDir);
                await rimraf(fullPath);
            }
        }
    }

    protected async buildLocalAdapter(): Promise<void> {
        const pkg = await this.readPackageJson();
        if (pkg.scripts?.build) {
            this.log.notice(`Build iobroker.${this.adapterName}`);
            this.execSync('npm run build', this.rootDir);
        }
    }

    protected uploadAdapter(name: string): void {
        this.log.notice(`Upload iobroker.${name}`);
        this.execSync(`${IOBROKER_COMMAND} upload ${name}`, this.profileDir);
    }

    protected async withDb<T>(method: (db: DBConnection) => Promise<T>): Promise<T> {
        const db = new DBConnection('iobroker', this.profileDir, this.log);
        await db.start();
        try {
            return await method(db);
        } finally {
            await db.stop();
        }
    }

    protected async updateObject<T extends string = string>(
        id: T,
        method: (obj: ioBroker.ObjectIdToObjectType<T>) => ioBroker.SettableObject<ioBroker.ObjectIdToObjectType<T>>,
    ): Promise<void> {
        await this.withDb(async db => {
            const obj = await db.getObject(id);
            if (obj) {
                // @ts-expect-error fix later
                await db.setObject(id, method(obj));
            }
        });
    }

    protected execSync(command: string, cwd: string, options?: cp.ExecSyncOptionsWithBufferEncoding): Buffer {
        options = { cwd: cwd, stdio: 'inherit', ...options };
        this.log.debug(`${cwd}> ${command}`);
        return cp.execSync(command, options);
    }

    protected getExecOutput(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
        this.log.debug(`${cwd}> ${command}`);
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            this.childProcesses.push(
                cp.exec(command, { cwd, encoding: 'ascii' }, (err, stdout, stderr) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ stdout, stderr });
                    }
                }),
            );
        });
    }

    protected spawn(
        command: string,
        args: ReadonlyArray<string>,
        cwd: string,
        options?: cp.SpawnOptions,
    ): Promise<cp.ChildProcess> {
        return new Promise((resolve, reject) => {
            let processSpawned = false;
            this.log.debug(`${cwd}> ${command} ${args.join(' ')}`);
            const proc = cp.spawn(command, args, {
                stdio: ['ignore', 'inherit', 'inherit'],
                cwd: cwd,
                ...options,
            });
            this.childProcesses.push(proc);
            let alive = true;
            proc.on('spawn', () => {
                processSpawned = true;
                resolve(proc);
            });
            proc.on('error', err => {
                this.log.error(`Could not spawn ${command}: ${err}`);
                if (!processSpawned) {
                    reject(err);
                }
            });
            proc.on('exit', () => (alive = false));
            process.on('exit', () => alive && proc.kill('SIGINT'));
        });
    }

    protected async spawnAndAwaitOutput(
        command: string,
        args: ReadonlyArray<string>,
        cwd: string,
        awaitMsg: string | RegExp,
        options?: cp.SpawnOptions,
    ): Promise<cp.ChildProcess> {
        const proc = await this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
        return new Promise<cp.ChildProcess>((resolve, reject) => {
            const handleStream = (isStderr: boolean) => (data: Buffer) => {
                let str = data.toString('utf-8');
                // eslint-disable-next-line no-control-regex
                str = str.replace(/\x1Bc/, ''); // filter the "clear screen" ANSI code (used by tsc)
                if (str) {
                    str = str.trimEnd();
                    if (isStderr) {
                        console.error(str);
                    } else {
                        console.log(str);
                    }
                }

                if (typeof awaitMsg === 'string') {
                    if (str.includes(awaitMsg)) {
                        resolve(proc);
                    }
                } else {
                    if (awaitMsg.test(str)) {
                        resolve(proc);
                    }
                }
            };
            proc.stdout?.on('data', handleStream(false));
            proc.stderr?.on('data', handleStream(true));

            proc.on('exit', code => reject(new Error(`Exited with ${code}`)));
            process.on('SIGINT', () => {
                proc.kill('SIGINT');
                reject(new Error('SIGINT'));
            });
        });
    }

    protected async exit(exitCode: number, signal = 'SIGINT'): Promise<never> {
        const childPids = this.childProcesses.map(p => p.pid).filter(p => !!p) as number[];
        const tryKill = (pid: number, signal: string): void => {
            try {
                process.kill(pid, signal);
            } catch {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map(pid => this.getChildProcesses(pid)));
            children.forEach(ch => ch.forEach(c => tryKill(parseInt(c.PID), signal)));
        } catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error as Error}`);
        }
        if (childPids.length) {
            childPids.forEach(pid => tryKill(pid, signal));
            if (signal !== 'SIGKILL') {
                // first try SIGINT and give it 5s to exit itself before killing the processes left
                await delay(5000);
                return this.exit(exitCode, 'SIGKILL');
            }
        }
        process.exit(exitCode);
    }

    protected async waitForNodeChildProcess(parentPid: number): Promise<number | undefined> {
        const start = new Date().getTime();
        while (start + 2000 > new Date().getTime()) {
            const processes = await this.getChildProcesses(parentPid);
            const child = processes.find(p => p.COMMAND.match(/node/i));
            if (child) {
                return parseInt(child.PID);
            }
        }

        this.log.debug(`No node child process of ${parentPid} found, assuming parent process was reused.`);
        return parentPid;
    }

    private getChildProcesses(parentPid: number): Promise<readonly psTree.PS[]> {
        return new Promise<readonly psTree.PS[]>((resolve, reject) =>
            psTree(parentPid, (err, children) => {
                if (err) {
                    reject(err);
                } else {
                    // fix for MacOS bug #11
                    children.forEach((c: any) => {
                        if (c.COMM && !c.COMMAND) {
                            c.COMMAND = c.COMM;
                        }
                    });
                    resolve(children);
                }
            }),
        );
    }
}
