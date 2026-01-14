#!/usr/bin/env node

import axios from 'axios';
import chalk from 'chalk';
import enquirer from 'enquirer';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gt } from 'semver';
import yargs from 'yargs/yargs';
import { Backup } from './commands/Backup.js';
import { Debug } from './commands/Debug.js';
import { Run } from './commands/Run.js';
import { Setup } from './commands/Setup.js';
import { SetupRemote } from './commands/SetupRemote.js';
import { Update } from './commands/Update.js';
import { Upload } from './commands/Upload.js';
import { readJson } from './commands/utils.js';
import { Watch } from './commands/Watch.js';
import { Logger } from './logger.js';

const DEFAULT_TEMP_DIR_NAME = '.dev-server';
const CORE_MODULE = 'iobroker.js-controller';

const DEFAULT_ADMIN_PORT = 8081;
const DEFAULT_PROFILE_NAME = 'default';

export interface RemoteConfig {
    id: string;
    host: string;
    port: number;
    user: string;
    privateKeyPath?: string;
}

export interface DevServerConfig {
    adminPort: number;
    useSymlinks: boolean;
    remote?: RemoteConfig;
}

export type CoreDependency = 'iobroker.js-controller' | 'iobroker.admin';
export type DependencyVersions = Partial<Record<CoreDependency, string>>;

export class DevServer {
    public log!: Logger;
    public rootPath!: string;
    public adapterName!: string;
    public tempPath!: string;
    public profileName!: string;
    public profilePath!: string;
    public config?: DevServerConfig;

    constructor() {
        const parser = yargs(process.argv.slice(2));
        void parser
            .usage(
                'Usage: $0 <command> [options] [profile]\n   or: $0 <command> --help   to see available options for a command',
            )
            .command(
                ['setup [profile]', 's'],
                'Set up dev-server in the current directory. This should always be called in the directory where the io-package.json file of your adapter is located.',
                {
                    adminPort: {
                        type: 'number',
                        default: DEFAULT_ADMIN_PORT,
                        alias: 'p',
                        description: 'TCP port on which ioBroker.admin will be available',
                    },
                    jsController: {
                        type: 'string',
                        alias: 'j',
                        default: 'latest',
                        description: 'Define which version of js-controller to be used',
                    },
                    admin: {
                        type: 'string',
                        alias: 'a',
                        default: 'latest',
                        description: 'Define which version of admin to be used',
                    },
                    backupFile: {
                        type: 'string',
                        alias: 'b',
                        description: 'Provide an ioBroker backup file to restore in this dev-server',
                    },
                    remote: {
                        type: 'boolean',
                        description: 'Install dev-server on a remote host and connect via SSH',
                    },
                    force: { type: 'boolean', hidden: true },
                    symlinks: {
                        type: 'boolean',
                        alias: 'l',
                        default: false,
                        description:
                            'Use symlinks instead of packing and installing the current adapter for a smoother dev experience. Requires JS-Controller 5+.',
                    },
                },
                async args =>
                    await this.setup(
                        args.adminPort,
                        { ['iobroker.js-controller']: args.jsController, ['iobroker.admin']: args.admin },
                        args.backupFile,
                        !!args.remote,
                        !!args.force,
                        args.symlinks,
                    ),
            )
            .command(
                ['update [profile]', 'ud'],
                'Update ioBroker and its dependencies to the latest versions',
                {},
                async () => await this.update(),
            )
            .command(
                ['run [profile]', 'r'],
                'Run ioBroker dev-server, the adapter will not run, but you may test the Admin UI with hot-reload',
                {
                    noBrowserSync: {
                        type: 'boolean',
                        alias: 'b',
                        description: 'Do not use BrowserSync for hot-reload (serve static files instead)',
                    },
                },
                async args => await this.run(!args.noBrowserSync),
            )
            .command(
                ['watch [profile]', 'w'],
                'Run ioBroker dev-server and start the adapter in "watch" mode. The adapter will automatically restart when its source code changes. You may attach a debugger to the running adapter.',
                {
                    noStart: {
                        type: 'boolean',
                        alias: 'n',
                        description: 'Do not start the adapter itself, only watch for changes and sync them.',
                    },
                    noInstall: {
                        type: 'boolean',
                        alias: 'x',
                        description: 'Do not build and install the adapter before starting.',
                    },
                    doNotWatch: {
                        type: 'string',
                        alias: 'w',
                        description:
                            'Do not watch the given files or directories for changes (provide paths relative to the adapter base directory.',
                    },
                    noBrowserSync: {
                        type: 'boolean',
                        alias: 'b',
                        description: 'Do not use BrowserSync for hot-reload (serve static files instead)',
                    },
                },
                async args => await this.watch(!args.noStart, !!args.noInstall, args.doNotWatch, !args.noBrowserSync),
            )
            .command(
                ['debug [profile]', 'd'],
                'Run ioBroker dev-server and start the adapter from ioBroker in "debug" mode. You may attach a debugger to the running adapter.',
                {
                    wait: {
                        type: 'boolean',
                        alias: 'w',
                        description: 'Start the adapter only once the debugger is attached.',
                    },
                    noInstall: {
                        type: 'boolean',
                        alias: 'x',
                        description: 'Do not build and install the adapter before starting.',
                    },
                },
                async args => await this.debug(!!args.wait, !!args.noInstall),
            )
            .command(
                ['upload [profile]', 'ul'],
                'Upload the current version of your adapter to the ioBroker dev-server. This is only required if you changed something relevant in your io-package.json',
                {},
                async () => await this.upload(),
            )
            .command(
                ['backup <filename> [profile]', 'b'],
                'Create an ioBroker backup to the given file.',
                {},
                async args => await this.backup(args.filename as string),
            )
            .command(
                ['profile', 'p'],
                'List all dev-server profiles that exist in the current directory.',
                {},
                async () => await this.profile(),
            )
            .options({
                temp: {
                    type: 'string',
                    alias: 't',
                    default: DEFAULT_TEMP_DIR_NAME,
                    description: 'Temporary directory where the dev-server data will be located',
                },
                root: { type: 'string', alias: 'r', hidden: true, default: '.' },
                verbose: { type: 'boolean', hidden: true, default: false },
            })
            .middleware(async argv => await this.setLogger(argv))
            .middleware(async () => await this.checkVersion())
            .middleware(async argv => await this.setDirectories(argv))
            .middleware(async () => await this.parseConfig())
            .wrap(Math.min(100, parser.terminalWidth()))
            .showHelpOnFail(false)
            .help().argv;
    }

    private setLogger(argv: { verbose: boolean }): Promise<void> {
        this.log = new Logger(argv.verbose ? 'silly' : 'debug');
        return Promise.resolve();
    }

    private async checkVersion(): Promise<void> {
        try {
            const { name, version: localVersion } = await this.readMyPackageJson();
            const {
                data: { version: releaseVersion },
            } = await axios.get(`https://registry.npmjs.org/${name}/latest`, { timeout: 1000 });
            if (gt(releaseVersion, localVersion)) {
                this.log.debug(`Found update from ${localVersion} to ${releaseVersion}`);
                const response = await enquirer.prompt<{ update: boolean }>({
                    name: 'update',
                    type: 'confirm',
                    message: `Version ${releaseVersion} of ${name} is available.\nWould you like to exit and update?`,
                    initial: true,
                });
                if (response.update) {
                    this.log.box(
                        `Please update ${name} manually and restart your last command afterwards.\n` +
                            `If you installed ${name} globally, you can simply call:\n\nnpm install --global ${name}`,
                    );
                    return process.exit(0);
                }
                this.log.warn(`We strongly recommend to update ${name} as soon as possible.`);
            }
        } catch {
            // ignore
        }
    }

    public async readMyPackageJson(): Promise<any> {
        const dirname = path.dirname(fileURLToPath(import.meta.url));
        return readJson(path.join(dirname, '..', 'package.json'));
    }

    private async setDirectories(argv: {
        _: (string | number)[];
        root: string;
        temp: string;
        profile?: string;
    }): Promise<void> {
        this.rootPath = path.resolve(argv.root);
        this.tempPath = path.resolve(this.rootPath, argv.temp);
        if (existsSync(path.join(this.tempPath, 'package.json'))) {
            // we are still in the old directory structure (no profiles), let's move it
            const intermediateDir = path.join(this.rootPath, `${DEFAULT_TEMP_DIR_NAME}-temp`);
            const defaultProfileDir = path.join(this.tempPath, DEFAULT_PROFILE_NAME);
            this.log.debug(`Moving temporary data from ${this.tempPath} to ${defaultProfileDir}`);
            await rename(this.tempPath, intermediateDir);
            await mkdir(this.tempPath);
            await rename(intermediateDir, defaultProfileDir);
        }

        let profileName = argv.profile;
        const profiles = await this.getProfiles();
        const profileNames = Object.keys(profiles);
        if (profileName) {
            if (!argv._.includes('setup') && !argv._.includes('s')) {
                // ensure the profile exists
                if (!profileNames.includes(profileName)) {
                    throw new Error(`Profile ${profileName} doesn't exist`);
                }
            }
        } else {
            if (argv._.includes('profile') || argv._.includes('p')) {
                // we don't care about the profile name
                profileName = DEFAULT_PROFILE_NAME;
            } else {
                if (profileNames.length === 0) {
                    profileName = DEFAULT_PROFILE_NAME;
                    this.log.debug(`Using default profile ${profileName}`);
                } else if (profileNames.length === 1) {
                    profileName = profileNames[0];
                    this.log.debug(`Using profile ${profileName}`);
                } else {
                    this.log.box(
                        chalk.yellow(
                            `You didn't specify the profile name in the command line. ` +
                                `You may do so the next time by appending the profile name to your command.\nExample:\n` +
                                `> dev-server ${process.argv.slice(2).join(' ')} ${profileNames[profileNames.length - 1]} `,
                        ),
                    );
                    const response = await enquirer.prompt<{ profile: string }>({
                        name: 'profile',
                        type: 'select',
                        message: 'Please choose a profile',
                        choices: profileNames.map(p => ({
                            name: p,
                            hint: chalk.gray(`(Admin Port: ${profiles[p]['dev-server'].adminPort})`),
                        })),
                    });
                    profileName = response.profile;
                }
            }
        }

        if (!profileName.match(/^[a-z0-9_-]+$/i)) {
            throw new Error(`Invalid profile name: "${profileName}", it may only contain a-z, 0-9, _ and -.`);
        }

        this.profileName = profileName;
        this.log.debug(`Using profile name "${this.profileName}"`);
        this.profilePath = path.join(this.tempPath, profileName);
        this.adapterName = await this.findAdapterName();
    }

    private async parseConfig(): Promise<void> {
        let pkg: Record<string, any>;
        try {
            pkg = await readJson(path.join(this.profilePath, 'package.json'));
        } catch {
            // not all commands need the config
            return;
        }

        this.config = pkg['dev-server'];
    }

    private async findAdapterName(): Promise<string> {
        try {
            const ioPackage = await readJson(path.join(this.rootPath, 'io-package.json'));
            const adapterName = ioPackage.common.name;
            this.log.debug(`Using adapter name "${adapterName}"`);
            return adapterName;
        } catch (error: any) {
            this.log.warn(error);
            this.log.error('You must run dev-server in the adapter root directory (where io-package.json resides).');
            return process.exit(-1);
        }
    }

    ////////////////// Command Handlers //////////////////

    async setup(
        adminPort: number,
        dependencies: DependencyVersions,
        backupFile: string | undefined,
        remote: boolean,
        force: boolean,
        useSymlinks: boolean,
    ): Promise<void> {
        let setup: Setup;
        if (remote) {
            setup = new SetupRemote(this, adminPort, dependencies, backupFile, force);
        } else {
            setup = new Setup(this, adminPort, dependencies, backupFile, force, useSymlinks);
        }
        await setup.run();
    }

    private async update(): Promise<void> {
        this.checkSetup();

        const update = new Update(this);
        await update.run();
    }

    async run(useBrowserSync = true): Promise<void> {
        this.checkSetup();

        const run = new Run(this, useBrowserSync);
        await run.run();
    }

    async watch(
        startAdapter: boolean,
        noInstall: boolean,
        doNotWatch: string | string[] | undefined,
        useBrowserSync = true,
    ): Promise<void> {
        let doNotWatchArr: string[] = [];
        if (typeof doNotWatch === 'string') {
            doNotWatchArr.push(doNotWatch);
        } else if (Array.isArray(doNotWatch)) {
            doNotWatchArr = doNotWatch;
        }

        this.checkSetup();

        const watch = new Watch(this, noInstall, startAdapter, doNotWatchArr, useBrowserSync);
        await watch.run();
    }

    async debug(wait: boolean, noInstall: boolean): Promise<void> {
        this.checkSetup();

        const debug = new Debug(this, wait, noInstall);
        await debug.run();
    }

    async upload(): Promise<void> {
        this.checkSetup();

        const upload = new Upload(this);
        await upload.run();
    }

    async backup(filename: string): Promise<void> {
        this.checkSetup();

        const backup = new Backup(this, filename);
        await backup.run();
    }

    async profile(): Promise<void> {
        const profiles = await this.getProfiles();
        const table = Object.keys(profiles).map(name => {
            const pkg = profiles[name];
            const infos = pkg['dev-server'] as DevServerConfig;
            const dependencies = pkg.dependencies;
            return [
                name,
                `http://127.0.0.1:${infos.adminPort}`,
                infos.remote ? `${infos.remote.user}@${infos.remote.host}:${infos.remote.port}` : '(local)',
                dependencies['iobroker.js-controller'],
                dependencies['iobroker.admin'],
            ];
        });
        table.unshift(['Profile Name', 'Admin URL', 'Remote Host', 'js-controller', 'admin'].map(h => chalk.bold(h)));
        this.log.info(`The following profiles exist in ${this.tempPath}`);
        this.log.table(table.filter(r => !!r) as any);
    }

    ////////////////// Command Helper Methods //////////////////

    async getProfiles(): Promise<Record<string, any>> {
        if (!existsSync(this.tempPath)) {
            return {};
        }

        const entries = await readdir(this.tempPath);
        const pkgs = await Promise.all(
            entries.map(async e => {
                try {
                    const pkg = await readJson(path.join(this.tempPath, e, 'package.json'));
                    const infos = pkg['dev-server'];
                    const dependencies = pkg.dependencies;
                    if (infos?.adminPort && dependencies) {
                        return [e, pkg];
                    }
                } catch {
                    return undefined;
                }
            }, {}),
        );
        return (pkgs.filter(p => !!p) as any[]).reduce<Record<string, any>>(
            (old, [e, pkg]) => ({ ...old, [e]: pkg }),
            {},
        );
    }

    private checkSetup(): void {
        if (!this.isSetUp()) {
            this.log.error(
                `dev-server is not set up in ${this.profilePath}.\nPlease use the command "setup" first to set up dev-server.`,
            );
            return process.exit(-1);
        }
    }

    public isSetUp(): boolean {
        const jsControllerDir = path.join(this.profilePath, 'node_modules', CORE_MODULE);
        if (existsSync(jsControllerDir)) {
            return true;
        }

        if (this.config?.remote) {
            // remote case (we didn't install js-controller locally)
            return true;
        }

        return false;
    }
}
