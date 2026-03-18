import * as cp from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import type { IEnvironment } from './IEnvironment.js';
import { delay, getChildProcesses, readJson, writeJson } from './utils.js';

export class LocalDirectory implements IEnvironment {
    protected readonly childProcesses: cp.ChildProcess[] = [];

    constructor(
        private readonly directory: string,
        private readonly log: Logger,
    ) {}

    public readFile(relPath: string): Promise<string> {
        return readFile(path.join(this.directory, relPath), { encoding: 'utf-8' });
    }

    public writeFile(relPath: string, data: string): Promise<void> {
        return writeFile(path.join(this.directory, relPath), data, { encoding: 'utf-8' });
    }

    public readJson<T = any>(relPath: string): Promise<T> {
        return readJson<T>(path.join(this.directory, relPath));
    }

    public async writeJson(relPath: string, data: any): Promise<void> {
        return writeJson(path.join(this.directory, relPath), data);
    }

    public async copyFileTo(src: string, dest: string): Promise<void> {
        await copyFile(src, path.join(this.directory, dest));
    }

    public exists(relPath: string): Promise<boolean> {
        return Promise.resolve(existsSync(path.join(this.directory, relPath)));
    }

    public async unlink(relPath: string): Promise<void> {
        const fullPath = path.join(this.directory, relPath);
        await unlink(fullPath);
    }

    public exec(command: string): Promise<void> {
        this.log.debug(`${this.directory}> ${command}`);
        cp.execSync(command, { cwd: this.directory, stdio: 'inherit' });
        return Promise.resolve();
    }

    public async execWithExistingFile(fullPath: string, commandBuilder: (localPath: string) => string): Promise<void> {
        await this.exec(commandBuilder(fullPath));
    }

    public async execWithNewFile(fullPath: string, commandBuilder: (localPath: string) => string): Promise<void> {
        await this.exec(commandBuilder(fullPath));
    }

    public getExecOutput(command: string): Promise<{ stdout: string; stderr: string }> {
        this.log.debug(`${this.directory}> ${command}`);
        return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            this.childProcesses.push(
                cp.exec(command, { cwd: this.directory, encoding: 'ascii' }, (err, stdout, stderr) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ stdout, stderr });
                    }
                }),
            );
        });
    }

    public async spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null> {
        const proc = await this.spawnProcess(command, args);
        proc.on('exit', async code => {
            await onExit(code ?? -1);
        });
        return proc.pid ?? null;
    }

    public async spawnAndAwaitOutput(
        command: string,
        args: ReadonlyArray<string>,
        awaitMsg: string | RegExp,
        options?: cp.SpawnOptions,
    ): Promise<cp.ChildProcess> {
        const proc = await this.spawnProcess(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
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

    private spawnProcess(
        command: string,
        args: ReadonlyArray<string>,
        options?: cp.SpawnOptions,
    ): Promise<cp.ChildProcess> {
        return new Promise((resolve, reject) => {
            let processSpawned = false;
            this.log.debug(`${this.directory}> ${command} ${args.join(' ')}`);
            const proc = cp.spawn(command, args, {
                stdio: ['ignore', 'inherit', 'inherit'],
                cwd: this.directory,
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

    public async exitChildProcesses(signal = 'SIGINT'): Promise<void> {
        const childPids = this.childProcesses.map(p => p.pid).filter(p => !!p) as number[];
        const tryKill = (pid: number, signal: string): void => {
            try {
                process.kill(pid, signal);
            } catch {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map(pid => getChildProcesses(pid)));
            children.forEach(ch => ch.forEach(c => tryKill(parseInt(c.PID), signal)));
        } catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error as Error}`);
        }
        if (childPids.length) {
            childPids.forEach(pid => tryKill(pid, signal));
            if (signal !== 'SIGKILL') {
                // first try SIGINT and give it 5s to exit itself before killing the processes left
                await delay(5000);
                return this.exitChildProcesses('SIGKILL');
            }
        }
    }

    public sendSigIntToChildProcesses(): void {
        this.childProcesses.forEach(p => p.kill('SIGINT'));
    }
}
