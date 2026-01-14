import enquirer from 'enquirer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type ConnectConfig, Client as SSHClient } from 'ssh2';
import { exec as ssh2ExecAsync } from 'ssh2-exec/promises';
import type { RemoteConfig } from '../DevServer.js';
import { type Logger } from '../logger.js';
import type { IEnvironment } from './IEnvironment.js';

export class RemoteConnection implements IEnvironment {
    private client = new SSHClient();
    private homeDir?: string;

    constructor(
        private readonly config: RemoteConfig,
        private readonly log: Logger,
    ) {}

    public async connect(): Promise<void> {
        this.log.notice(`Connecting to ${this.config.user}@${this.config.host}...`);
        await new Promise<void>((resolve, reject) => {
            this.client.once('ready', () => {
                resolve();
            });
            this.client.once('error', err => {
                this.log.error(`SSH connection error: ${err.message}`);
                reject(err);
            });
            const connectConfig: ConnectConfig = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.user,
            };
            if (this.config.privateKeyPath) {
                connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
            } else {
                connectConfig.tryKeyboard = true;
                this.client.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
                    this.log.notice(instructions);
                    async function askPassword(): Promise<string[]> {
                        const result: string[] = [];
                        for (const p of prompts) {
                            const answer = await enquirer.prompt<{ password: string }>({
                                name: 'password',
                                type: p.echo ? 'text' : 'password',
                                message: p.prompt,
                            });
                            result.push(answer.password);
                        }
                        return result;
                    }
                    askPassword()
                        .then(finish)
                        .catch(err => this.log.error(`Error getting password: ${err}`));
                });
            }

            this.client.connect(connectConfig);
        });

        this.log.notice('Remote SSH connection established');
    }

    public close(): void {
        this.client.end();
    }

    public spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null> {
        throw new Error('Method not implemented.');
    }

    public async exec(command: string): Promise<void> {
        const basePath = `~/.dev-server/${this.config.id}`;
        this.log.debug(`${this.config.user}@${this.config.host}:${basePath}> ${command}`);

        command = this.asBashCommand(`cd ${basePath} ; ${command}`);

        return new Promise((resolve, reject) => {
            this.client.exec(command, { pty: true }, (err, stream) => {
                if (err) {
                    return reject(err);
                }
                stream.on('close', (code: number, signal: string) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Command failed with code ${code} (${signal})`));
                    }
                });

                stream.pipe(process.stdout, { end: false });
                stream.stderr.pipe(process.stderr, { end: false });
            });
        });
    }

    public async getExecOutput(command: string): Promise<string> {
        this.log.debug(`${this.config.user}@${this.config.host}> ${command}`);
        command = this.asBashCommand(command);
        const result = await ssh2ExecAsync({
            ssh: this.client,
            command,
            end: false,
        });
        return result.stdout;
    }

    private asBashCommand(command: string): string {
        command = `/usr/bin/bash -lic '${command.replace(/'/g, "'\\''")}'`;
        this.log.silly(`Remote command: ${command}`);
        return command;
    }

    public exitChildProcesses(_signal: string): Promise<void> {
        throw new Error('Method not implemented.');
    }

    public sendSigIntToChildProcesses(): void {
        throw new Error('Method not implemented.');
    }

    public async installTarball(tarballPath: string): Promise<void> {
        const filename = path.basename(tarballPath);
        await this.upload(tarballPath, filename);
        await this.exec(`npm install "./${filename}"`);
    }

    public async upload(localPath: string, relPath: string): Promise<void> {
        this.log.notice(`Uploading ${relPath} to remote host...`);
        const homeDir = await this.getHomeDir();
        const remotePath = `${homeDir}/.dev-server/${this.config.id}/${relPath}`;
        await new Promise<void>((resolve, reject) => {
            this.client.sftp((err, sftp) => {
                if (err) {
                    return reject(err);
                }
                this.log.silly(`${localPath} -> ${remotePath}`);
                sftp.fastPut(localPath, remotePath, {}, putErr => {
                    if (putErr) {
                        return reject(putErr);
                    }
                    resolve();
                });
            });
        });
    }

    private async getHomeDir(): Promise<string> {
        if (!this.homeDir) {
            this.homeDir = (await this.getExecOutput('echo $HOME')).trim();
        }
        return this.homeDir;
    }
}
