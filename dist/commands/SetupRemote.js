import enquirer from 'enquirer';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { SemVer } from 'semver';
import { IOBROKER_COMMAND } from './CommandBase.js';
import { RemoteConnection } from './RemoteConnection.js';
import { Setup } from './Setup.js';
export class SetupRemote extends Setup {
    remoteConnection;
    constructor(owner, adminPort, dependencies, backupFile, force) {
        super(owner, adminPort, dependencies, backupFile, force, false);
    }
    async setupDevServer() {
        const { dependencies } = await this.owner.readMyPackageJson();
        this.dependencies.nodemon = dependencies.nodemon || 'latest';
        try {
            await this.setupRemoteSsh();
            await super.setupDevServer();
        }
        finally {
            this.remoteConnection?.close();
            this.remoteConnection = undefined;
        }
    }
    async setupRemoteSsh() {
        const { host, port, user, auth } = await enquirer.prompt([
            {
                name: 'host',
                type: 'text',
                message: 'Please enter the hostname or IP address of the remote host:',
                initial: '',
            },
            {
                name: 'port',
                type: 'number',
                message: 'Please enter the SSH port of the remote host:',
                initial: 22,
            },
            {
                name: 'user',
                type: 'text',
                message: 'Please enter the SSH username of the remote host:',
                initial: 'root',
            },
            {
                name: 'auth',
                type: 'select',
                message: 'Please select the authentication method:',
                choices: ['Password', 'SSH Key'],
            },
        ]);
        let privateKeyPath = undefined;
        if (auth === 'SSH Key') {
            const baseDir = path.join(homedir(), '.ssh');
            const files = await readdir(baseDir);
            const keyFiles = files.filter(f => files.includes(`${f}.pub`));
            if (keyFiles.length > 0) {
                const choices = keyFiles.map(f => path.join(baseDir, f));
                const MANUAL_OPTION = 'Enter path manually';
                choices.push(MANUAL_OPTION);
                const response = await enquirer.prompt({
                    name: 'keyFile',
                    type: 'select',
                    message: 'Please select the SSH key to use for authentication:',
                    choices,
                });
                if (response.keyFile !== MANUAL_OPTION) {
                    privateKeyPath = response.keyFile;
                }
            }
            if (!privateKeyPath) {
                const response = await enquirer.prompt({
                    name: 'keyFile',
                    type: 'text',
                    message: 'Please enter the path to the SSH key to use for authentication:',
                    initial: path.join(homedir(), '.ssh', 'id_rsa'),
                });
                privateKeyPath = response.keyFile;
            }
        }
        this.config.remote = {
            id: randomUUID(),
            host,
            port,
            user,
            privateKeyPath,
        };
        await this.connectRemote();
        await this.ensureRemoteReady();
    }
    async installDependencies() {
        await this.uploadToRemote('package.json');
        await this.uploadToRemote(path.join('iobroker-data', 'iobroker.json'));
        this.log.notice('Installing dependencies on remote host...');
        await super.installDependencies();
        //await this.remoteConnection!.run("/usr/bin/bash -lic 'npm install --loglevel error --production'", '');
    }
    async connectRemote() {
        if (!this.config.remote) {
            throw new Error('Remote configuration is missing');
        }
        this.remoteConnection = new RemoteConnection(this.config.remote, this.log);
        await this.remoteConnection.connect();
        this.profileDir = this.remoteConnection;
    }
    async ensureRemoteReady() {
        this.log.notice('Ensuring remote host is ready for dev-server...');
        try {
            const output = await this.remoteConnection.getExecOutput('which node');
            const nodePath = output.trim();
            if (!nodePath) {
                throw new Error('Empty path');
            }
            this.log.notice(`Remote Node.js path: ${nodePath}`);
        }
        catch (error) {
            throw new Error('Node.js is not installed on the remote host', { cause: error });
        }
        const nodeVersion = await this.remoteConnection.getExecOutput('node -v');
        this.log.notice(`Remote Node.js version: ${nodeVersion.trim()}`);
        const version = new SemVer(nodeVersion.trim(), true);
        if (version.major < 20) {
            throw new Error(`Remote Node.js version must be 20 or higher`);
        }
        await this.remoteConnection.getExecOutput(`mkdir -p ~/.dev-server/${this.config.remote.id}/iobroker-data`);
    }
    async uploadToRemote(relPath) {
        const localPath = path.join(this.profilePath, relPath);
        await this.remoteConnection.upload(localPath, relPath);
    }
    async hasAdapterInstance(name) {
        try {
            await this.remoteConnection.getExecOutput(`cd ~/.dev-server/${this.config.remote.id} ; ${IOBROKER_COMMAND} object get system.adapter.${name}.0`);
            return true;
        }
        catch {
            return false;
        }
    }
    async updateObject(id, method) {
        const obj = { native: {}, common: {} };
        method(obj);
        const command = `${IOBROKER_COMMAND} object extend ${id} '${JSON.stringify(obj)}'`;
        await this.remoteConnection.exec(command);
    }
    withDb() {
        // make sure this method is not used in remote setup
        throw new Error('Method not supported for remote setup.');
    }
}
