import enquirer from 'enquirer';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { SemVer } from 'semver';
import type { DependencyVersions, DevServer } from '../DevServer.js';
import { IOBROKER_COMMAND } from './CommandBase.js';
import { RemoteConnection } from './RemoteConnection.js';
import { Setup } from './Setup.js';

export class SetupRemote extends Setup {
    private remoteConnection?: RemoteConnection;

    constructor(
        owner: DevServer,
        adminPort: number,
        dependencies: DependencyVersions,
        backupFile: string | undefined,
        force: boolean,
    ) {
        super(owner, adminPort, dependencies, backupFile, force, false);
    }

    protected override async setupDevServer(): Promise<void> {
        const { dependencies } = await this.owner.readMyPackageJson();
        this.dependencies.nodemon = dependencies.nodemon || 'latest';
        try {
            await this.setupRemoteSsh();

            await super.setupDevServer();
        } finally {
            this.remoteConnection?.close();
            this.remoteConnection = undefined;
        }
    }

    private async setupRemoteSsh(): Promise<void> {
        const { host, port, user, auth } = await enquirer.prompt<{
            host: string;
            port: number;
            user: string;
            auth: 'Password' | 'SSH Key';
        }>([
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

        let privateKeyPath: string | undefined = undefined;
        if (auth === 'SSH Key') {
            const baseDir = path.join(homedir(), '.ssh');
            const files = await readdir(baseDir);
            const keyFiles = files.filter(f => files.includes(`${f}.pub`));

            if (keyFiles.length > 0) {
                const choices = keyFiles.map(f => path.join(baseDir, f));
                const MANUAL_OPTION = 'Enter path manually';
                choices.push(MANUAL_OPTION);
                const response = await enquirer.prompt<{ keyFile: string }>({
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
                const response = await enquirer.prompt<{ keyFile: string }>({
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

    protected override async installDependencies(): Promise<void> {
        await this.uploadToRemote('package.json');
        await this.uploadToRemote(path.join('iobroker-data', 'iobroker.json'));

        this.log.notice('Installing dependencies on remote host...');
        await super.installDependencies();
        //await this.remoteConnection!.run("/usr/bin/bash -lic 'npm install --loglevel error --production'", '');
    }

    private async connectRemote(): Promise<void> {
        if (!this.config.remote) {
            throw new Error('Remote configuration is missing');
        }

        this.remoteConnection = new RemoteConnection(this.config.remote, this.log);
        await this.remoteConnection.connect();
        this.profileDir = this.remoteConnection;
    }

    private async ensureRemoteReady(): Promise<void> {
        this.log.notice('Ensuring remote host is ready for dev-server...');

        try {
            const output = await this.remoteConnection!.getExecOutput('which node');
            const nodePath = output.trim();
            if (!nodePath) {
                throw new Error('Empty path');
            }
            this.log.notice(`Remote Node.js path: ${nodePath}`);
        } catch (error: any) {
            throw new Error('Node.js is not installed on the remote host', { cause: error });
        }

        const nodeVersion = await this.remoteConnection!.getExecOutput('node -v');
        this.log.notice(`Remote Node.js version: ${nodeVersion.trim()}`);

        const version = new SemVer(nodeVersion.trim(), true);
        if (version.major < 20) {
            throw new Error(`Remote Node.js version must be 20 or higher`);
        }

        await this.remoteConnection!.getExecOutput(`mkdir -p ~/.dev-server/${this.config.remote!.id}/iobroker-data`);
    }

    private async uploadToRemote(relPath: string): Promise<void> {
        const localPath = path.join(this.profilePath, relPath);
        await this.remoteConnection!.upload(localPath, relPath);
    }

    protected override async hasAdapterInstance(name: string): Promise<boolean> {
        try {
            await this.remoteConnection!.getExecOutput(
                `cd ~/.dev-server/${this.config.remote!.id} ; ${IOBROKER_COMMAND} object get system.adapter.${name}.0`,
            );
            return true;
        } catch {
            return false;
        }
    }

    protected async updateObject<T extends string = string>(
        id: T,
        method: (obj: ioBroker.ObjectIdToObjectType<T>) => ioBroker.SettableObject<ioBroker.ObjectIdToObjectType<T>>,
    ): Promise<void> {
        const obj: any = { native: {}, common: {} };
        method(obj);
        const command = `${IOBROKER_COMMAND} object extend ${id} '${JSON.stringify(obj)}'`;
        await this.remoteConnection!.exec(command);
    }

    protected override withDb<T>(): Promise<T> {
        // make sure this method is not used in remote setup
        throw new Error('Method not supported for remote setup.');
    }
}
