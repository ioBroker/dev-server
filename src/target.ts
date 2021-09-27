import * as cp from 'child_process';
import { copy, existsSync, mkdirp, readFile, unlink, writeFile, writeJson, WriteOptions } from 'fs-extra';
import path from 'path';
import psTree from 'ps-tree';
import { Logger } from './logger';
import { rimraf } from './utils';

export interface Target {
  deleteAll(): Promise<void>;

  existsSync(path: string): boolean;

  unlink(path: string): Promise<void>;

  readText(file: string): Promise<string>;

  writeText(file: string, content: string): Promise<void>;

  writeJson(file: string, object: unknown, options?: WriteOptions): Promise<void>;

  uploadFile(localFile: string, remoteFile: string): Promise<void>;

  execBlocking(command: string): Promise<Buffer>;

  spawn(command: string, args: ReadonlyArray<string>): Promise<Process>;

  getExecOutput(command: string): Promise<string>;

  killAllChildren(): Promise<void>;
}

export interface Process {
  on(event: 'exit', callback: (code: number) => void): Process;

  readonly pid?: number;
}

export class LocalTarget implements Target {
  private readonly executor: ProcessExecutor;

  constructor(private readonly profileDir: string, private readonly log: Logger) {
    this.executor = new ProcessExecutor(this.log);
  }

  deleteAll(): Promise<void> {
    this.log.notice(`Deleting ${this.profileDir}`);
    return rimraf(this.profileDir);
  }

  existsSync(pathname: string): boolean {
    return existsSync(path.join(this.profileDir, pathname));
  }

  unlink(pathname: string): Promise<void> {
    return unlink(path.join(this.profileDir, pathname));
  }

  readText(file: string): Promise<string> {
    return readFile(path.join(this.profileDir, file), { encoding: 'utf-8' });
  }

  writeText(file: string, content: string): Promise<void> {
    return writeFile(path.join(this.profileDir, file), content);
  }

  uploadFile(localFile: string, remoteFile: string): Promise<void> {
    return copy(localFile, path.join(this.profileDir, remoteFile));
  }

  async writeJson(file: string, object: unknown, options?: WriteOptions): Promise<void> {
    const fullPath = path.join(this.profileDir, file);
    await mkdirp(path.dirname(fullPath));
    return writeJson(fullPath, object, options);
  }

  async execBlocking(command: string): Promise<Buffer> {
    return this.executor.execSync(command, this.profileDir);
  }

  async spawn(command: string, args: readonly string[]): Promise<Process> {
    const proc = this.executor.spawn(command, args, this.profileDir);
    return proc;
  }

  async getExecOutput(command: string): Promise<string> {
    const { stdout } = await this.executor.getExecOutput(command, this.profileDir);
    return stdout;
  }

  killAllChildren(): Promise<void> {
    return this.executor.killAllChildren();
  }
}

export class RemoteTarget implements Target {
  constructor(
    private readonly remote: string,
    private readonly profileDir: string,
    private readonly adapterName: string,
    private readonly log: Logger,
  ) {}

  deleteAll(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  existsSync(path: string): boolean {
    throw new Error('Method not implemented.');
  }

  unlink(path: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  readText(_file: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  writeText(file: string, content: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  uploadFile(localFile: string, remoteFile: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async writeJson(file: string, object: unknown, options?: WriteOptions): Promise<void> {
    if (file === 'package.json') {
      // special case: the package file in the root of the profile directory must also exist locally
      const fullPath = path.join(this.profileDir, file);
      await mkdirp(path.dirname(fullPath));
      await writeJson(fullPath, object, options);
    }

    throw new Error('Method not implemented.');
  }

  execBlocking(_command: string): Promise<Buffer> {
    throw new Error('Method not implemented.');
  }

  spawn(_command: string, _args: readonly string[]): Promise<Process> {
    throw new Error('Method not implemented.');
  }

  getExecOutput(_command: string): Promise<string> {
    throw new Error('Method not implemented.');
  }

  killAllChildren(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

export class ProcessExecutor {
  private readonly childProcesses: cp.ChildProcess[] = [];

  constructor(private readonly log: Logger) {}

  execSync(command: string, cwd: string, options?: cp.ExecSyncOptionsWithBufferEncoding): Buffer {
    options = { cwd: cwd, stdio: 'inherit', ...options };
    this.log.debug(`${cwd}> ${command}`);
    return cp.execSync(command, options);
  }

  getExecOutput(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
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

  spawn(command: string, args: ReadonlyArray<string>, cwd: string, options?: cp.SpawnOptions): cp.ChildProcess {
    this.log.debug(`${cwd}> ${command} ${args.join(' ')}`);
    const proc = cp.spawn(command, args, {
      stdio: ['ignore', 'inherit', 'inherit'],
      cwd: cwd,
      ...options,
    });
    this.childProcesses.push(proc);
    let alive = true;
    proc.on('exit', () => (alive = false));
    process.on('exit', () => alive && proc.kill());
    return proc;
  }

  spawnAndAwaitOutput(
    command: string,
    args: ReadonlyArray<string>,
    cwd: string,
    awaitMsg: string | RegExp,
    options?: cp.SpawnOptions,
  ): Promise<cp.ChildProcess> {
    return new Promise<cp.ChildProcess>((resolve, reject) => {
      const proc = this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
      proc.stdout?.on('data', (data: Buffer) => {
        let str = data.toString('utf-8');
        str = str.replace(/\x1Bc/, ''); // filter the "clear screen" ANSI code (used by tsc)
        if (str) {
          str = str.trimEnd();
          console.log(str);
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
      });
      proc.on('exit', (code) => reject(`Exited with ${code}`));
      process.on('SIGINT', () => {
        proc.kill();
        reject('SIGINT');
      });
    });
  }

  getChildProcesses(parentPid: number): Promise<readonly psTree.PS[]> {
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

  async killAllChildren(): Promise<void> {
    const childPids = this.childProcesses.map((p) => p.pid).filter((p) => !!p) as number[];
    const tryKill = (pid: number): void => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // ignore
      }
    };
    try {
      const children = await Promise.all(childPids.map((pid) => this.getChildProcesses(pid)));
      children.forEach((ch) => ch.forEach((c) => tryKill(parseInt(c.PID))));
    } catch (error) {
      this.log.error(`Couldn't kill grand-child processes: ${error}`);
    }
    childPids.forEach((pid) => tryKill(pid));
  }
}
