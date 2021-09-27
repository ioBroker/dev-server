"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessExecutor = exports.RemoteTarget = exports.LocalTarget = void 0;
const cp = __importStar(require("child_process"));
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const ps_tree_1 = __importDefault(require("ps-tree"));
const utils_1 = require("./utils");
class LocalTarget {
    constructor(profileDir, log) {
        this.profileDir = profileDir;
        this.log = log;
        this.executor = new ProcessExecutor(this.log);
    }
    deleteAll() {
        this.log.notice(`Deleting ${this.profileDir}`);
        return (0, utils_1.rimraf)(this.profileDir);
    }
    existsSync(pathname) {
        return (0, fs_extra_1.existsSync)(path_1.default.join(this.profileDir, pathname));
    }
    unlink(pathname) {
        return (0, fs_extra_1.unlink)(path_1.default.join(this.profileDir, pathname));
    }
    readText(file) {
        return (0, fs_extra_1.readFile)(path_1.default.join(this.profileDir, file), { encoding: 'utf-8' });
    }
    writeText(file, content) {
        return (0, fs_extra_1.writeFile)(path_1.default.join(this.profileDir, file), content);
    }
    uploadFile(localFile, remoteFile) {
        return (0, fs_extra_1.copy)(localFile, path_1.default.join(this.profileDir, remoteFile));
    }
    async writeJson(file, object, options) {
        const fullPath = path_1.default.join(this.profileDir, file);
        await (0, fs_extra_1.mkdirp)(path_1.default.dirname(fullPath));
        return (0, fs_extra_1.writeJson)(fullPath, object, options);
    }
    async execBlocking(command) {
        return this.executor.execSync(command, this.profileDir);
    }
    async spawn(command, args) {
        const proc = this.executor.spawn(command, args, this.profileDir);
        return proc;
    }
    async getExecOutput(command) {
        const { stdout } = await this.executor.getExecOutput(command, this.profileDir);
        return stdout;
    }
    killAllChildren() {
        return this.executor.killAllChildren();
    }
}
exports.LocalTarget = LocalTarget;
class RemoteTarget {
    constructor(remote, profileDir, adapterName, log) {
        this.remote = remote;
        this.profileDir = profileDir;
        this.adapterName = adapterName;
        this.log = log;
    }
    deleteAll() {
        throw new Error('Method not implemented.');
    }
    existsSync(path) {
        throw new Error('Method not implemented.');
    }
    unlink(path) {
        throw new Error('Method not implemented.');
    }
    readText(_file) {
        throw new Error('Method not implemented.');
    }
    writeText(file, content) {
        throw new Error('Method not implemented.');
    }
    uploadFile(localFile, remoteFile) {
        throw new Error('Method not implemented.');
    }
    async writeJson(file, object, options) {
        if (file === 'package.json') {
            // special case: the package file in the root of the profile directory must also exist locally
            const fullPath = path_1.default.join(this.profileDir, file);
            await (0, fs_extra_1.mkdirp)(path_1.default.dirname(fullPath));
            await (0, fs_extra_1.writeJson)(fullPath, object, options);
        }
        throw new Error('Method not implemented.');
    }
    execBlocking(_command) {
        throw new Error('Method not implemented.');
    }
    spawn(_command, _args) {
        throw new Error('Method not implemented.');
    }
    getExecOutput(_command) {
        throw new Error('Method not implemented.');
    }
    killAllChildren() {
        throw new Error('Method not implemented.');
    }
}
exports.RemoteTarget = RemoteTarget;
class ProcessExecutor {
    constructor(log) {
        this.log = log;
        this.childProcesses = [];
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
    spawnAndAwaitOutput(command, args, cwd, awaitMsg, options) {
        return new Promise((resolve, reject) => {
            var _a;
            const proc = this.spawn(command, args, cwd, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
            (_a = proc.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
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
                }
                else {
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
    async killAllChildren() {
        const childPids = this.childProcesses.map((p) => p.pid).filter((p) => !!p);
        const tryKill = (pid) => {
            try {
                process.kill(pid, 'SIGKILL');
            }
            catch (_a) {
                // ignore
            }
        };
        try {
            const children = await Promise.all(childPids.map((pid) => this.getChildProcesses(pid)));
            children.forEach((ch) => ch.forEach((c) => tryKill(parseInt(c.PID))));
        }
        catch (error) {
            this.log.error(`Couldn't kill grand-child processes: ${error}`);
        }
        childPids.forEach((pid) => tryKill(pid));
    }
}
exports.ProcessExecutor = ProcessExecutor;
