import enquirer from 'enquirer';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { type ConnectConfig, type SFTPWrapper, Client as SSHClient } from 'ssh2';
import { exec as ssh2ExecAsync } from 'ssh2-exec/promises';
import type { RemoteConfig } from '../DevServer.js';
import { type Logger } from '../logger.js';
import type { IEnvironment } from './IEnvironment.js';

type ConnectState = 'disconnected' | 'connecting' | 'connected';

export class RemoteConnection implements IEnvironment {
    private client = new SSHClient();
    private connectState: ConnectState = 'disconnected';
    private readonly childProcesses: number[] = [];
    private readonly tunnelServers: Server[] = [];
    private connectSftp?: Promise<SftpConnection>;
    private homeDir?: string;

    constructor(
        private readonly config: RemoteConfig,
        private readonly log: Logger,
    ) {}

    public async connect(): Promise<void> {
        if (this.connectState !== 'disconnected') {
            return;
        }

        this.log.notice(`Connecting to ${this.config.user}@${this.config.host}...`);
        this.connectState = 'connecting';
        await new Promise<void>((resolve, reject) => {
            this.client.once('ready', () => {
                this.connectState = 'connected';
                resolve();
            });
            this.client.once('error', err => {
                this.log.error(`SSH connection error: ${err.message}`);
                this.connectState = 'disconnected';
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

        this.log.debug('Remote SSH connection established');

        process.on(
            'SIGINT',
            (): void =>
                void this.exitChildProcesses('SIGINT').catch(e =>
                    this.log.silly(`Couldn't exit child processes: ${e.message}`),
                ),
        );
    }

    public close(): void {
        if (this.connectState !== 'connected') {
            return;
        }

        this.log.debug('Closing tunnels...');
        for (const server of this.tunnelServers) {
            server.close();
        }
        this.tunnelServers.length = 0;

        this.log.debug('Closing remote SSH connection');
        this.connectState = 'disconnected';
        this.client.end();
    }

    public async spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null> {
        const basePath = this.getBasePath();
        this.log.debug(`${this.config.user}@${this.config.host}:${basePath}> ${command}`);

        command = this.asBashCommand(
            `cd ${basePath} ; echo "PID=>$$<" ; exec ${command} ${args.map(a => `"${a}"`).join(' ')}`,
        );

        return new Promise((resolve, reject) => {
            this.client.exec(command, { pty: true }, (err, stream) => {
                if (err) {
                    return reject(err);
                }
                resolve(null);

                stream.once('data', (data: Buffer) => {
                    const match = data.toString().match(/PID=>(\d+)</);
                    if (match) {
                        const pid = parseInt(match[1], 10);
                        this.log.silly(`Spawned remote process with PID ${pid}`);
                        this.childProcesses.push(pid);
                    }
                });

                stream.on('close', (code: number | undefined) => {
                    onExit(code ?? 1)?.catch((e: any) => this.log.error(`Error in onExit handler: ${e.message}`));
                });

                stream.pipe(process.stdout, { end: false });
                stream.stderr.pipe(process.stderr, { end: false });
            });
        });
    }

    public async exec(command: string): Promise<void> {
        const basePath = this.getBasePath();
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

    public async execWithExistingFile(fullPath: string, commandBuilder: (remotePath: string) => string): Promise<void> {
        const filename = path.basename(fullPath);
        const remotePath = await this.upload(fullPath, filename);
        await this.exec(commandBuilder(remotePath));
    }

    public async execWithNewFile(localPath: string, commandBuilder: (remotePath: string) => string): Promise<void> {
        const filename = path.basename(localPath);
        const homeDir = await this.getHomeDir();
        const remotePath = `${this.getBasePath(homeDir)}/${filename}`;
        await this.exec(commandBuilder(remotePath));

        const sftp = await this.getSftp();
        await sftp.get(remotePath, localPath);

        await this.exec(`rm -f "${remotePath}"`);
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

    public async exitChildProcesses(signal: string): Promise<void> {
        if (signal === 'SIGKILL') {
            this.close();
        } else if (this.childProcesses.length > 0) {
            const pids = [...this.childProcesses];
            this.childProcesses.length = 0;
            for (const pid of pids) {
                try {
                    await this.exec(`kill -s ${signal} ${pid}`);
                } catch (err: any) {
                    this.log.silly(`Failed to send ${signal} to remote process ${pid}: ${err}`);
                }
            }

            // wait forever, hoping the remote processes will exit and close the connection
            return new Promise<void>(() => {});
        }
    }

    public sendSigIntToChildProcesses(): void {
        // this method is only used locally when there is no TTY
        this.close();
    }

    public async tunnelPort(port: number): Promise<void> {
        this.log.notice(`Preparing tunnel for port ${port}...`);
        const server = createServer(sock => {
            sock.pause();

            this.log.silly(`Client connected to port ${port}, opening tunnel...`);
            this.client.forwardOut('127.0.0.1', port, '127.0.0.1', port, (err, stream) => {
                if (err) {
                    this.log.silly(`forwardOut for port ${port} failed: ${err.message}`);
                    sock.destroy();
                    return;
                }

                this.log.silly(`Tunnel for port ${port} established (${sock.remoteAddress}:${sock.remotePort}).`);
                sock.pipe(stream);
                stream.pipe(sock);
                sock.resume();
            });
        });

        this.tunnelServers.push(server);
        return new Promise<void>((resolve, reject) => {
            server.on('error', err => {
                this.log.error(`Failed to create local tunnel server: ${err.message}`);
                reject(err);
            });
            server.on('listening', () => {
                resolve();
            });
            server.listen(port, '127.0.0.1');
        });
    }

    public async upload(localPath: string, relPath: string): Promise<string> {
        const homeDir = await this.getHomeDir();
        const remotePath = `${this.getBasePath(homeDir)}/${relPath}`;

        const sftp = await this.getSftp();
        await sftp.put(localPath, remotePath);

        return remotePath;
    }

    private getBasePath(home = '~'): string {
        return `${home}/.dev-server/${this.config.id}`;
    }

    private getSftp(): Promise<SftpConnection> {
        if (!this.connectSftp) {
            this.connectSftp = new Promise<SftpConnection>((resolve, reject) => {
                this.client.sftp((err, sftp) => {
                    if (err) {
                        return reject(err);
                    }
                    resolve(new SftpConnection(sftp, this.log));
                });
            });
        }
        return this.connectSftp;
    }

    private async getHomeDir(): Promise<string> {
        if (!this.homeDir) {
            this.homeDir = (await this.getExecOutput('echo $HOME')).trim();
        }
        return this.homeDir;
    }
}

class SftpConnection {
    private currentOperation?: Promise<void>;

    constructor(
        private sftp: SFTPWrapper,
        private log: Logger,
    ) {}

    public async get(remotePath: string, localPath: string): Promise<void> {
        await this.currentOperation;

        this.log.notice(`Transferring ${remotePath} from remote host...`);
        this.currentOperation = new Promise<void>((resolve, reject) => {
            this.log.silly(`${remotePath} -> ${localPath}`);
            this.sftp.fastGet(remotePath, localPath, {}, putErr => {
                if (putErr) {
                    return reject(putErr);
                }
                resolve();
            });
        });
        return this.currentOperation;
    }

    public async put(localPath: string, remotePath: string): Promise<void> {
        await this.currentOperation;

        this.log.notice(`Transferring ${localPath} to remote host...`);
        this.currentOperation = new Promise<void>((resolve, reject) => {
            this.log.silly(`${localPath} -> ${remotePath}`);
            this.sftp.fastPut(localPath, remotePath, {}, putErr => {
                if (putErr) {
                    return reject(putErr);
                }
                resolve();
            });
        });
        return this.currentOperation;
    }
}
