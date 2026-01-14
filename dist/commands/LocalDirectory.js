import * as cp from 'node:child_process';
import path from 'node:path';
import { delay, getChildProcesses, readJson } from './utils.js';
export class LocalDirectory {
    directory;
    log;
    childProcesses = [];
    constructor(directory, log) {
        this.directory = directory;
        this.log = log;
    }
    readJson(relPath) {
        return readJson(path.join(this.directory, relPath));
    }
    async installTarball(tarballPath) {
        await this.exec(`npm install "${tarballPath}"`);
    }
    exec(command) {
        this.log.debug(`${this.directory}> ${command}`);
        cp.execSync(command, { cwd: this.directory, stdio: 'inherit' });
        return Promise.resolve();
    }
    getExecOutput(command) {
        this.log.debug(`${this.directory}> ${command}`);
        return new Promise((resolve, reject) => {
            this.childProcesses.push(cp.exec(command, { cwd: this.directory, encoding: 'ascii' }, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({ stdout, stderr });
                }
            }));
        });
    }
    async spawn(command, args, onExit) {
        const proc = await this.spawnProcess(command, args);
        proc.on('exit', async (code) => {
            await onExit(code ?? -1);
        });
        return proc.pid ?? null;
    }
    async spawnAndAwaitOutput(command, args, awaitMsg, options) {
        const proc = await this.spawnProcess(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
        return new Promise((resolve, reject) => {
            const handleStream = (isStderr) => (data) => {
                let str = data.toString('utf-8');
                // eslint-disable-next-line no-control-regex
                str = str.replace(/\x1Bc/, ''); // filter the "clear screen" ANSI code (used by tsc)
                if (str) {
                    str = str.trimEnd();
                    if (isStderr) {
                        console.error(str);
                    }
                    else {
                        console.log(str);
                    }
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
    spawnProcess(command, args, options) {
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
    async exitChildProcesses(signal = 'SIGINT') {
        const childPids = this.childProcesses.map(p => p.pid).filter(p => !!p);
        const tryKill = (pid, signal) => {
            try {
                process.kill(pid, signal);
            }
            catch {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map(pid => getChildProcesses(pid)));
            children.forEach(ch => ch.forEach(c => tryKill(parseInt(c.PID), signal)));
        }
        catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error}`);
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
    sendSigIntToChildProcesses() {
        this.childProcesses.forEach(p => p.kill('SIGINT'));
    }
}
