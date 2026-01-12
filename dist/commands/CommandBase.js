"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandBase = exports.OBJECTS_DB_PORT_OFFSET = exports.STATES_DB_PORT_OFFSET = exports.HIDDEN_BROWSER_SYNC_PORT_OFFSET = exports.HIDDEN_ADMIN_PORT_OFFSET = exports.IOBROKER_COMMAND = exports.IOBROKER_CLI = void 0;
const dbConnection_1 = require("@iobroker/testing/build/tests/integration/lib/dbConnection");
const fs_extra_1 = require("fs-extra");
const cp = __importStar(require("node:child_process"));
const node_path_1 = __importDefault(require("node:path"));
const ps_tree_1 = __importDefault(require("ps-tree"));
const rimraf_1 = require("rimraf");
const utils_1 = require("./utils");
exports.IOBROKER_CLI = 'node_modules/iobroker.js-controller/iobroker.js';
exports.IOBROKER_COMMAND = `node ${exports.IOBROKER_CLI}`;
exports.HIDDEN_ADMIN_PORT_OFFSET = 12345;
exports.HIDDEN_BROWSER_SYNC_PORT_OFFSET = 14345;
exports.STATES_DB_PORT_OFFSET = 16345;
exports.OBJECTS_DB_PORT_OFFSET = 18345;
class CommandBase {
    constructor(owner) {
        this.owner = owner;
        this.childProcesses = [];
    }
    get log() {
        return this.owner.log;
    }
    get rootDir() {
        return this.owner.rootDir;
    }
    get profileDir() {
        return this.owner.profileDir;
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
    getPort(offset) {
        return this.config.adminPort + offset;
    }
    isJSController() {
        return this.adapterName === 'js-controller';
    }
    readPackageJson() {
        return (0, fs_extra_1.readJson)(node_path_1.default.join(this.rootDir, 'package.json'));
    }
    /**
     * Read and parse the io-package.json file from the adapter directory
     *
     * @returns Promise resolving to the parsed io-package.json content
     */
    async readIoPackageJson() {
        return (0, fs_extra_1.readJson)(node_path_1.default.join(this.rootDir, 'io-package.json'));
    }
    isTypeScriptMain(mainFile) {
        return !!(mainFile && mainFile.endsWith('.ts'));
    }
    async installLocalAdapter(doInstall = true) {
        var _a;
        this.log.notice(`Install local iobroker.${this.adapterName}`);
        if (this.config.useSymlinks) {
            // This is the expected relative path
            const relativePath = node_path_1.default.relative(this.profileDir, this.rootDir);
            // Check if it is already used in package.json
            const tempPkg = await (0, fs_extra_1.readJson)(node_path_1.default.join(this.profileDir, 'package.json'));
            const depPath = (_a = tempPkg.dependencies) === null || _a === void 0 ? void 0 : _a[`iobroker.${this.adapterName}`];
            // If not, install it
            if (depPath !== relativePath) {
                this.execSync(`npm install "${relativePath}"`, this.profileDir);
            }
        }
        else {
            const { stdout } = await this.getExecOutput('npm pack', this.rootDir);
            const filename = stdout.trim();
            this.log.info(`Packed to ${filename}`);
            if (doInstall) {
                const fullPath = node_path_1.default.join(this.rootDir, filename);
                this.execSync(`npm install "${fullPath}"`, this.profileDir);
                await (0, rimraf_1.rimraf)(fullPath);
            }
        }
    }
    async buildLocalAdapter() {
        var _a;
        const pkg = await this.readPackageJson();
        if ((_a = pkg.scripts) === null || _a === void 0 ? void 0 : _a.build) {
            this.log.notice(`Build iobroker.${this.adapterName}`);
            this.execSync('npm run build', this.rootDir);
        }
    }
    uploadAdapter(name) {
        this.log.notice(`Upload iobroker.${name}`);
        this.execSync(`${exports.IOBROKER_COMMAND} upload ${name}`, this.profileDir);
    }
    async withDb(method) {
        const db = new dbConnection_1.DBConnection('iobroker', this.profileDir, this.log);
        await db.start();
        try {
            return await method(db);
        }
        finally {
            await db.stop();
        }
    }
    async updateObject(id, method) {
        await this.withDb(async (db) => {
            const obj = await db.getObject(id);
            if (obj) {
                // @ts-expect-error fix later
                await db.setObject(id, method(obj));
            }
        });
    }
    execSync(command, cwd, options) {
        options = { cwd: cwd, stdio: 'inherit', ...options };
        this.log.debug(`${cwd}> ${command}`);
        return cp.execSync(command, options);
    }
    getExecOutput(command, cwd) {
        this.log.debug(`${cwd}> ${command}`);
        return new Promise((resolve, reject) => {
            this.childProcesses.push(cp.exec(command, { cwd, encoding: 'ascii' }, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({ stdout, stderr });
                }
            }));
        });
    }
    spawn(command, args, cwd, options) {
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
    async spawnAndAwaitOutput(command, args, cwd, awaitMsg, options) {
        const proc = await this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
        return new Promise((resolve, reject) => {
            var _a, _b;
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
            (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', handleStream(false));
            (_b = proc.stderr) === null || _b === void 0 ? void 0 : _b.on('data', handleStream(true));
            proc.on('exit', code => reject(new Error(`Exited with ${code}`)));
            process.on('SIGINT', () => {
                proc.kill('SIGINT');
                reject(new Error('SIGINT'));
            });
        });
    }
    async exit(exitCode, signal = 'SIGINT') {
        const childPids = this.childProcesses.map(p => p.pid).filter(p => !!p);
        const tryKill = (pid, signal) => {
            try {
                process.kill(pid, signal);
            }
            catch (_a) {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map(pid => this.getChildProcesses(pid)));
            children.forEach(ch => ch.forEach(c => tryKill(parseInt(c.PID), signal)));
        }
        catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error}`);
        }
        if (childPids.length) {
            childPids.forEach(pid => tryKill(pid, signal));
            if (signal !== 'SIGKILL') {
                // first try SIGINT and give it 5s to exit itself before killing the processes left
                await (0, utils_1.delay)(5000);
                return this.exit(exitCode, 'SIGKILL');
            }
        }
        process.exit(exitCode);
    }
    async waitForNodeChildProcess(parentPid) {
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
    getChildProcesses(parentPid) {
        return new Promise((resolve, reject) => (0, ps_tree_1.default)(parentPid, (err, children) => {
            if (err) {
                reject(err);
            }
            else {
                // fix for MacOS bug #11
                children.forEach((c) => {
                    if (c.COMM && !c.COMMAND) {
                        c.COMMAND = c.COMM;
                    }
                });
                resolve(children);
            }
        }));
    }
}
exports.CommandBase = CommandBase;
