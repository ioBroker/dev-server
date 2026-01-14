import enquirer from 'enquirer';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client as SSHClient } from 'ssh2';
import { exec as ssh2ExecAsync } from 'ssh2-exec/promises';
export class RemoteConnection {
    config;
    log;
    client = new SSHClient();
    connectState = 'disconnected';
    homeDir;
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }
    async connect() {
        if (this.connectState !== 'disconnected') {
            return;
        }
        this.log.notice(`Connecting to ${this.config.user}@${this.config.host}...`);
        this.connectState = 'connecting';
        await new Promise((resolve, reject) => {
            this.client.once('ready', () => {
                this.connectState = 'connected';
                resolve();
            });
            this.client.once('error', err => {
                this.log.error(`SSH connection error: ${err.message}`);
                this.connectState = 'disconnected';
                reject(err);
            });
            const connectConfig = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.user,
            };
            if (this.config.privateKeyPath) {
                connectConfig.privateKey = readFileSync(this.config.privateKeyPath);
            }
            else {
                connectConfig.tryKeyboard = true;
                this.client.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
                    this.log.notice(instructions);
                    async function askPassword() {
                        const result = [];
                        for (const p of prompts) {
                            const answer = await enquirer.prompt({
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
    }
    close() {
        if (this.connectState !== 'connected') {
            return;
        }
        this.log.debug('Closing remote SSH connection');
        this.connectState = 'disconnected';
        this.client.end();
    }
    spawn(command, args, onExit) {
        throw new Error('Method not implemented.');
    }
    async exec(command) {
        const basePath = `~/.dev-server/${this.config.id}`;
        this.log.debug(`${this.config.user}@${this.config.host}:${basePath}> ${command}`);
        command = this.asBashCommand(`cd ${basePath} ; ${command}`);
        return new Promise((resolve, reject) => {
            this.client.exec(command, { pty: true }, (err, stream) => {
                if (err) {
                    return reject(err);
                }
                stream.on('close', (code, signal) => {
                    if (code === 0) {
                        resolve();
                    }
                    else {
                        reject(new Error(`Command failed with code ${code} (${signal})`));
                    }
                });
                stream.pipe(process.stdout, { end: false });
                stream.stderr.pipe(process.stderr, { end: false });
            });
        });
    }
    async execWithExistingFile(fullPath, commandBuilder) {
        const filename = path.basename(fullPath);
        const remotePath = await this.upload(fullPath, filename);
        await this.exec(commandBuilder(remotePath));
        await this.exec(`rm -f "${remotePath}"`);
    }
    async execWithNewFile(localPath, commandBuilder) {
        const filename = path.basename(localPath);
        const homeDir = await this.getHomeDir();
        const remotePath = `${homeDir}/.dev-server/${this.config.id}/${filename}`;
        await this.exec(commandBuilder(remotePath));
        this.log.notice(`Transferring ${remotePath} from remote host...`);
        await new Promise((resolve, reject) => {
            this.client.sftp((err, sftp) => {
                if (err) {
                    return reject(err);
                }
                this.log.silly(`${remotePath} -> ${localPath}`);
                sftp.fastGet(remotePath, localPath, {}, putErr => {
                    if (putErr) {
                        return reject(putErr);
                    }
                    resolve();
                });
            });
        });
        await this.exec(`rm -f "${remotePath}"`);
    }
    async getExecOutput(command) {
        this.log.debug(`${this.config.user}@${this.config.host}> ${command}`);
        command = this.asBashCommand(command);
        const result = await ssh2ExecAsync({
            ssh: this.client,
            command,
            end: false,
        });
        return result.stdout;
    }
    asBashCommand(command) {
        command = `/usr/bin/bash -lic '${command.replace(/'/g, "'\\''")}'`;
        this.log.silly(`Remote command: ${command}`);
        return command;
    }
    exitChildProcesses(_signal) {
        throw new Error('Method not implemented.');
    }
    sendSigIntToChildProcesses() {
        throw new Error('Method not implemented.');
    }
    async upload(localPath, relPath) {
        this.log.notice(`Transferring ${relPath} to remote host...`);
        const homeDir = await this.getHomeDir();
        const remotePath = `${homeDir}/.dev-server/${this.config.id}/${relPath}`;
        await new Promise((resolve, reject) => {
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
        return remotePath;
    }
    async getHomeDir() {
        if (!this.homeDir) {
            this.homeDir = (await this.getExecOutput('echo $HOME')).trim();
        }
        return this.homeDir;
    }
}
