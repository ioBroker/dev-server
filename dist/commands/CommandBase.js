import path from 'node:path';
import { rimraf } from 'rimraf';
import { LocalDirectory } from './LocalDirectory.js';
import { RemoteConnection } from './RemoteConnection.js';
import { getChildProcesses, readJson } from './utils.js';
export const IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
export const IOBROKER_COMMAND = `node ${IOBROKER_CLI}`;
export const HIDDEN_ADMIN_PORT_OFFSET = 12345;
export const HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
export const STATES_DB_PORT_OFFSET = 16345;
export const OBJECTS_DB_PORT_OFFSET = 18345;
export class CommandBase {
    owner;
    rootDir;
    profileDir;
    constructor(owner) {
        this.owner = owner;
        this.rootDir = new LocalDirectory(this.rootPath, this.log);
        if (this.owner.config?.remote) {
            this.profileDir = new RemoteConnection(this.owner.config.remote, this.log);
        }
        else {
            this.profileDir = new LocalDirectory(this.profilePath, this.log);
        }
    }
    get log() {
        return this.owner.log;
    }
    get rootPath() {
        return this.owner.rootPath;
    }
    get profilePath() {
        return this.owner.profilePath;
    }
    get profileName() {
        return this.owner.profileName;
    }
    get adapterName() {
        return this.owner.adapterName;
    }
    get config() {
        if (!this.owner.config) {
            throw new Error('DevServer is not configured yet');
        }
        return this.owner.config;
    }
    async run() {
        await this.prepare();
        await this.doRun();
        await this.teardown();
    }
    async prepare() {
        if (this.profileDir instanceof RemoteConnection) {
            await this.profileDir.connect();
        }
    }
    teardown() {
        if (this.profileDir instanceof RemoteConnection) {
            this.profileDir.close();
        }
        return Promise.resolve();
    }
    getPort(offset) {
        return this.config.adminPort + offset;
    }
    isJSController() {
        return this.adapterName === 'js-controller';
    }
    readPackageJson() {
        return this.rootDir.readJson('package.json');
    }
    /**
     * Read and parse the io-package.json file from the adapter directory
     *
     * @returns Promise resolving to the parsed io-package.json content
     */
    readIoPackageJson() {
        return this.rootDir.readJson('io-package.json');
    }
    isTypeScriptMain(mainFile) {
        return !!(mainFile && mainFile.endsWith('.ts'));
    }
    async installLocalAdapter(doInstall = true) {
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
        }
        else {
            const { stdout } = await this.rootDir.getExecOutput('npm pack');
            const filename = stdout.trim();
            this.log.info(`Packed to ${filename}`);
            if (doInstall) {
                const fullPath = path.join(this.rootPath, filename);
                await this.profileDir.execWithFile(fullPath, f => `npm install "${f}"`);
                await rimraf(fullPath);
            }
        }
    }
    async buildLocalAdapter() {
        const pkg = await this.readPackageJson();
        if (pkg.scripts?.build) {
            this.log.notice(`Build iobroker.${this.adapterName}`);
            await this.rootDir.exec('npm run build');
        }
    }
    async uploadAdapter(name) {
        this.log.notice(`Upload iobroker.${name}`);
        await this.profileDir.exec(`${IOBROKER_COMMAND} upload ${name}`);
    }
    async exit(exitCode, signal = 'SIGINT') {
        await this.rootDir.exitChildProcesses(signal);
        await this.profileDir.exitChildProcesses(signal);
        process.exit(exitCode);
    }
    async waitForNodeChildProcess(parentPid) {
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
