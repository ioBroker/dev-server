import { tokenizer } from 'acorn';
import axios from 'axios';
import browserSync from 'browser-sync';
import chalk from 'chalk';
import express, { type Application } from 'express';
import fg from 'fast-glob';
import { legacyCreateProxyMiddleware as createProxyMiddleware } from 'http-proxy-middleware';
import EventEmitter from 'node:events';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type RawSourceMap, SourceMapGenerator } from 'source-map';
import WebSocket from 'ws';
import { injectCode } from '../jsonConfig.js';
import {
    CommandBase,
    HIDDEN_ADMIN_PORT_OFFSET,
    HIDDEN_BROWSER_SYNC_PORT_OFFSET,
    OBJECTS_DB_PORT_OFFSET,
    STATES_DB_PORT_OFFSET,
} from './CommandBase.js';
import { checkPort, delay, readJson, writeJson } from './utils.js';

export abstract class RunCommandBase extends CommandBase {
    private websocket?: WebSocket;

    protected readonly socketEvents = new EventEmitter();

    protected async startJsController(): Promise<void> {
        await this.profileDir.spawn(
            'node',
            [
                '--inspect=127.0.0.1:9228',
                '--preserve-symlinks',
                '--preserve-symlinks-main',
                'node_modules/iobroker.js-controller/controller.js',
            ],
            async code => {
                console.error(chalk.yellow(`ioBroker controller exited with code ${code}`));
                return this.exit(-1, 'SIGKILL');
            },
        );
        this.log.notice('Waiting for js-controller to start...');
        await this.waitForJsController();
    }

    protected async waitForJsController(): Promise<void> {
        if (!(await this.waitForPort(OBJECTS_DB_PORT_OFFSET)) || !(await this.waitForPort(STATES_DB_PORT_OFFSET))) {
            throw new Error(`Couldn't start js-controller`);
        }
    }

    private async waitForPort(offset: number): Promise<boolean> {
        const port = this.getPort(offset);
        this.log.debug(`Waiting for port ${port} to be available...`);
        let tries = 0;
        while (true) {
            try {
                await checkPort(port);
                this.log.debug(`Port ${port} is available...`);
                return true;
            } catch {
                if (tries++ > 30) {
                    this.log.error(`Port ${port} is not available after 30 seconds.`);
                    return false;
                }
                await delay(1000);
            }
        }
    }

    protected async startServer(useBrowserSync = true): Promise<void> {
        this.log.notice(`Running inside ${this.profilePath}`);

        if (!this.config) {
            throw new Error(`Couldn't find dev-server configuration in package.json`);
        }

        await this.waitForPort(HIDDEN_ADMIN_PORT_OFFSET);

        const app = express();
        const hiddenAdminPort = this.getPort(HIDDEN_ADMIN_PORT_OFFSET);
        if (this.isJSController()) {
            // simply forward admin as-is
            app.use(
                createProxyMiddleware({
                    target: `http://127.0.0.1:${hiddenAdminPort}`,
                    ws: true,
                }),
            );
        } else {
            // Determine what UI capabilities this adapter needs
            const uiCapabilities = await this.getAdapterUiCapabilities();

            if (uiCapabilities.configType === 'json' && uiCapabilities.tabType !== 'none') {
                // Adapter uses jsonConfig AND has tabs - support both simultaneously
                await this.createCombinedConfigProxy(app, uiCapabilities, useBrowserSync);
            } else if (uiCapabilities.configType === 'json') {
                // JSON config only
                await this.createJsonConfigProxy(app, useBrowserSync);
            } else {
                // HTML config or tabs only (or no config)
                await this.createHtmlConfigProxy(app, useBrowserSync);
            }
        }

        // start express
        this.log.notice(`Starting web server on port ${this.config.adminPort}`);
        const server = app.listen(this.config.adminPort);

        let exiting = false;
        process.on('SIGINT', (): void => {
            this.log.notice('dev-server is exiting...');
            exiting = true;
            server.close();
            // do not kill this process when receiving SIGINT, but let all child processes exit first
            // but send the signal to all child processes when not in a tty environment
            if (!process.stdin.isTTY) {
                this.log.silly('Sending SIGINT to all child processes...');
                this.rootDir.sendSigIntToChildProcesses();
                this.profileDir.sendSigIntToChildProcesses();
            }
        });

        await new Promise<void>((resolve, reject) => {
            server.on('listening', resolve);
            server.on('error', reject);
            server.on('close', reject);
        });

        if (!this.isJSController()) {
            const connectWebSocketClient = (): void => {
                if (exiting) {
                    return;
                }
                // TODO: replace this with @iobroker/socket-client
                this.websocket = new WebSocket(`ws://127.0.0.1:${hiddenAdminPort}/?sid=${Date.now()}&name=admin`);
                this.websocket.on('open', () => this.log.silly('WebSocket open'));
                this.websocket.on('close', () => {
                    this.log.silly('WebSocket closed');
                    this.websocket = undefined;
                    setTimeout(connectWebSocketClient, 1000);
                });
                this.websocket.on('error', error => this.log.silly(`WebSocket error: ${error}`));
                this.websocket.on('message', msg => {
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    const msgString = msg?.toString();
                    if (typeof msgString === 'string') {
                        try {
                            const data = JSON.parse(msgString);
                            if (!Array.isArray(data) || data.length === 0) {
                                return;
                            }
                            switch (data[0]) {
                                case 0:
                                    if (data.length > 3) {
                                        this.socketEvents.emit(data[2], data[3]);
                                    }
                                    break;
                                case 1:
                                    // ping received, send pong (keep-alive)
                                    this.websocket?.send('[2]');
                                    break;
                            }
                        } catch (error) {
                            this.log.error(`Couldn't handle WebSocket message: ${error as Error}`);
                        }
                    }
                });
            };

            connectWebSocketClient();
        }

        this.log.box(`Admin is now reachable under http://127.0.0.1:${this.config.adminPort}/`);
    }

    /**
     * Detect adapter UI capabilities by reading io-package.json adminUi configuration
     *
     * This method determines how the adapter's configuration and tab UI should be handled
     * by checking the adminUi field in io-package.json, which is the official ioBroker schema.
     * It also checks for the presence of jsonConfig files to support legacy adapters.
     *
     * The detection logic replicates what the admin interface does to ensure dev-server
     * behavior matches what users will see in production.
     *
     * @returns Promise resolving to an object containing:
     *   - configType: 'json' (jsonConfig), 'html' (HTML/React config), or 'none'
     *   - tabType: 'json' (jsonTab), 'html' (HTML/React tab), or 'none'
     */
    private async getAdapterUiCapabilities(): Promise<{
        configType: 'json' | 'html' | 'none';
        tabType: 'json' | 'html' | 'none';
    }> {
        let configType: 'json' | 'html' | 'none' = 'none';
        let tabType: 'json' | 'html' | 'none' = 'none';

        // Check for jsonConfig files first
        if (this.getJsonConfigPath()) {
            configType = 'json';
        }

        if (!this.isJSController()) {
            // Check io-package.json adminUi field (replicate what admin does)
            try {
                const ioPackage = await this.readIoPackageJson();
                if (ioPackage?.common?.adminUi) {
                    const adminUi = ioPackage.common.adminUi;
                    this.log.debug(`Found adminUi configuration in io-package.json: ${JSON.stringify(adminUi)}`);

                    // Set config type based on adminUi.config
                    if (adminUi.config === 'json') {
                        configType = 'json';
                    } else if (adminUi.config === 'html' || adminUi.config === 'materialize') {
                        configType = 'html';
                    }

                    // Set tab type based on adminUi.tab
                    if (adminUi.tab === 'json') {
                        tabType = 'json';
                    } else if (adminUi.tab === 'html' || adminUi.tab === 'materialize') {
                        tabType = 'html';
                    }
                }
            } catch (error) {
                this.log.debug(`Failed to read io-package.json adminUi: ${error as Error}`);
            }
        }

        this.log.debug(`UI capabilities: configType=${configType}, tabType=${tabType}`);

        return {
            configType,
            tabType,
        };
    }

    private getJsonConfigPath(): string {
        const jsonConfigPath = path.resolve(this.rootPath, 'admin/jsonConfig.json');
        if (existsSync(jsonConfigPath)) {
            return jsonConfigPath;
        }
        if (existsSync(`${jsonConfigPath}5`)) {
            return `${jsonConfigPath}5`;
        }
        return '';
    }

    /**
     * Create a combined config proxy that supports adapters using both jsonConfig and tabs
     *
     * This method merges the functionality of createJsonConfigProxy and createHtmlConfigProxy
     * to support adapters that need both configuration UI types simultaneously. It handles:
     * - React build watching for HTML-based config or tabs
     * - JSON config file watching with WebSocket hot-reload
     * - JSON tab file watching with WebSocket hot-reload
     * - HTML tab file watching with BrowserSync automatic reload
     * - Appropriate proxy routing based on the UI types present
     *
     * Used when an adapter has jsonConfig AND also has custom tabs (either HTML or JSON-based).
     * For adapters with only one UI type, use createJsonConfigProxy or createHtmlConfigProxy instead.
     *
     * @param app Express application instance
     * @param uiCapabilities Object containing configType and tabType detected from io-package.json
     * @param useBrowserSync Whether to use BrowserSync for hot-reload (default: true)
     */
    private async createCombinedConfigProxy(
        app: Application,
        uiCapabilities: {
            configType: 'json' | 'html' | 'none';
            tabType: 'json' | 'html' | 'none';
        },
        useBrowserSync = true,
    ): Promise<void> {
        // This method combines the functionality of createJsonConfigProxy and createHtmlConfigProxy
        // to support adapters that use jsonConfig and tabs simultaneously

        const pathRewrite: Record<string, string> = {};
        const browserSyncPort = this.getPort(HIDDEN_BROWSER_SYNC_PORT_OFFSET);
        const adminUrl = `http://127.0.0.1:${this.getPort(HIDDEN_ADMIN_PORT_OFFSET)}`;

        let hasReact = false;
        let bs: any = null;

        if (useBrowserSync) {
            // Setup React build watching if needed (for HTML config or HTML tabs)
            if (uiCapabilities.configType === 'html' || uiCapabilities.tabType === 'html') {
                hasReact = await this.setupReactWatch(pathRewrite);
            }

            // Start browser-sync
            bs = this.startBrowserSync(browserSyncPort, hasReact);
        }

        // Handle jsonConfig file watching if present
        if (uiCapabilities.configType === 'json' && useBrowserSync && bs) {
            const jsonConfigFile = this.getJsonConfigPath();
            this.setupJsonFileWatch(bs, jsonConfigFile, path.basename(jsonConfigFile));

            // "proxy" for the main page which injects our script
            app.get('/', async (_req, res) => {
                const { data } = await axios.get<string>(adminUrl);
                res.send(injectCode(data, this.adapterName, path.basename(jsonConfigFile)));
            });
        }

        // Handle tab file watching if present
        if (uiCapabilities.tabType !== 'none' && useBrowserSync && bs) {
            if (uiCapabilities.tabType === 'json') {
                // Watch JSON tab files
                const jsonTabPath = path.resolve(this.rootPath, 'admin/jsonTab.json');
                const jsonTab5Path = path.resolve(this.rootPath, 'admin/jsonTab.json5');

                this.setupJsonFileWatch(bs, jsonTabPath, 'jsonTab.json');
                this.setupJsonFileWatch(bs, jsonTab5Path, 'jsonTab.json5');
            }

            if (uiCapabilities.tabType === 'html') {
                // Watch HTML tab files
                const tabHtmlPath = path.resolve(this.rootPath, 'admin/tab.html');
                if (existsSync(tabHtmlPath)) {
                    bs.watch(tabHtmlPath, undefined, (e: any) => {
                        if (e === 'change') {
                            this.log.info('Detected change in tab.html, reloading browser...');
                            // For HTML tabs, we rely on BrowserSync's automatic reload
                        }
                    });
                }
            }
        }

        // Setup proxies
        if (useBrowserSync) {
            if (uiCapabilities.configType === 'html' || uiCapabilities.tabType === 'html') {
                // browser-sync proxy for adapter files (for HTML config or HTML tabs)
                const adminPattern = `/adapter/${this.adapterName}/**`;
                pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
                app.use(
                    createProxyMiddleware([adminPattern, '/browser-sync/**'], {
                        target: `http://127.0.0.1:${browserSyncPort}`,
                        //ws: true, // can't have two web-socket connections proxying to different locations
                        pathRewrite,
                    }),
                );

                // admin proxy
                app.use(
                    createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
                        target: adminUrl,
                        ws: true,
                    }),
                );
            } else {
                // browser-sync proxy (for JSON config only)
                app.use(
                    createProxyMiddleware(['/browser-sync/**'], {
                        target: `http://127.0.0.1:${browserSyncPort}`,
                        // ws: true, // can't have two web-socket connections proxying to different locations
                    }),
                );

                // admin proxy
                app.use(
                    createProxyMiddleware({
                        target: adminUrl,
                        ws: true,
                    }),
                );
            }
        } else {
            // Direct admin proxy without browser-sync
            app.use(
                createProxyMiddleware({
                    target: adminUrl,
                    ws: true,
                }),
            );
        }
    }

    private createJsonConfigProxy(app: Application, useBrowserSync = true): Promise<void> {
        const jsonConfigFile = this.getJsonConfigPath();
        const adminUrl = `http://127.0.0.1:${this.getPort(HIDDEN_ADMIN_PORT_OFFSET)}`;

        if (useBrowserSync) {
            // Use BrowserSync for hot-reload functionality
            const browserSyncPort = this.getPort(HIDDEN_BROWSER_SYNC_PORT_OFFSET);
            const bs = this.startBrowserSync(browserSyncPort, false);

            // Setup file watching for jsonConfig changes
            this.setupJsonFileWatch(bs, jsonConfigFile, path.basename(jsonConfigFile));

            // "proxy" for the main page which injects our script
            app.get('/', async (_req, res) => {
                const { data } = await axios.get<string>(adminUrl);
                res.send(injectCode(data, this.adapterName, path.basename(jsonConfigFile)));
            });

            // browser-sync proxy
            app.use(
                createProxyMiddleware(['/browser-sync/**'], {
                    target: `http://127.0.0.1:${browserSyncPort}`,
                    // ws: true, // can't have two web-socket connections proxying to different locations
                }),
            );

            // admin proxy
            app.use(
                createProxyMiddleware({
                    target: adminUrl,
                    ws: true,
                }),
            );
        } else {
            // Serve without BrowserSync - just proxy admin directly
            app.use(
                createProxyMiddleware({
                    target: adminUrl,
                    ws: true,
                }),
            );
        }

        return Promise.resolve();
    }

    private async createHtmlConfigProxy(app: Application, useBrowserSync = true): Promise<void> {
        const pathRewrite: Record<string, string> = {};
        const adminPattern = `/adapter/${this.adapterName}/**`;

        // Setup React build watching if needed
        const hasReact = await this.setupReactWatch(pathRewrite);

        if (useBrowserSync) {
            // Use BrowserSync for hot-reload functionality
            const browserSyncPort = this.getPort(HIDDEN_BROWSER_SYNC_PORT_OFFSET);
            this.startBrowserSync(browserSyncPort, hasReact);

            // browser-sync proxy
            pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
            app.use(
                createProxyMiddleware([adminPattern, '/browser-sync/**'], {
                    target: `http://127.0.0.1:${browserSyncPort}`,
                    //ws: true, // can't have two web-socket connections proxying to different locations
                    pathRewrite,
                }),
            );

            // admin proxy
            app.use(
                createProxyMiddleware([`!${adminPattern}`, '!/browser-sync/**'], {
                    target: `http://127.0.0.1:${this.getPort(HIDDEN_ADMIN_PORT_OFFSET)}`,
                    ws: true,
                }),
            );
        } else {
            // Serve without BrowserSync - serve admin files directly and proxy the rest
            const adminPath = path.resolve(this.rootPath, 'admin/');

            // serve static admin files
            app.use(`/adapter/${this.adapterName}`, express.static(adminPath));

            // admin proxy for everything else
            app.use(
                createProxyMiddleware([`!${adminPattern}`], {
                    target: `http://127.0.0.1:${this.getPort(HIDDEN_ADMIN_PORT_OFFSET)}`,
                    ws: true,
                }),
            );
        }
    }

    /**
     * Helper method to setup React build watching
     * Returns true if React watching was started, false otherwise
     */
    private async setupReactWatch(pathRewrite: Record<string, string>): Promise<boolean> {
        if (this.isJSController()) {
            return false;
        }

        const pkg = await this.readPackageJson();
        const scripts = pkg.scripts;
        if (!scripts) {
            return false;
        }

        let hasReact = false;
        if (scripts['watch:react']) {
            await this.startReact('watch:react');
            hasReact = true;

            if (existsSync(path.resolve(this.rootPath, 'admin/.watch'))) {
                // rewrite the build directory to the .watch directory,
                // because "watch:react" no longer updates the build directory automatically
                pathRewrite[`^/adapter/${this.adapterName}/build/`] = '/.watch/';
            }
        } else if (scripts['watch:parcel']) {
            // use React with legacy script name
            await this.startReact('watch:parcel');
            hasReact = true;
        }

        return hasReact;
    }

    private startBrowserSync(port: number, hasReact: boolean): browserSync.BrowserSyncInstance {
        this.log.notice('Starting browser-sync');
        const bs = browserSync.create();

        const adminPath = path.resolve(this.rootPath, 'admin/');
        const config: browserSync.Options = {
            server: { baseDir: adminPath, directory: true },
            port: port,
            open: false,
            ui: false,
            logLevel: 'info',
            reloadDelay: hasReact ? 500 : 0,
            reloadDebounce: hasReact ? 500 : 0,
            files: [path.join(adminPath, '**')],
            plugins: [
                {
                    module: 'bs-html-injector',
                    options: {
                        files: [path.join(adminPath, '*.html')],
                    },
                },
            ],
        };
        // console.log(config);
        bs.init(config);
        return bs;
    }

    /**
     * Helper method to setup file watching for a JSON config file (jsonConfig, jsonTab, etc.)
     * Uploads the file to ioBroker via WebSocket when changes are detected
     */
    private setupJsonFileWatch(bs: any, filePath: string, fileName: string): void {
        if (!existsSync(filePath)) {
            return;
        }

        bs.watch(filePath, undefined, async (e: any) => {
            if (e === 'change') {
                this.log.info(`Detected change in ${fileName}, uploading to ioBroker...`);
                const content = await readFile(filePath);
                this.websocket?.send(
                    JSON.stringify([
                        3,
                        46,
                        'writeFile',
                        [`${this.adapterName}.admin`, fileName, Buffer.from(content).toString('base64')],
                    ]),
                );
            }
        });
    }

    private async startReact(scriptName: string): Promise<void> {
        this.log.notice('Starting React build');
        this.log.debug('Waiting for first successful React build...');
        await this.rootDir.spawnAndAwaitOutput(
            'npm',
            ['run', scriptName],
            /(built in|done in|watching (files )?for)/i,
            {
                shell: true,
            },
        );
    }

    protected async copySourcemaps(): Promise<void> {
        const outDir = path.join(this.profilePath, 'node_modules', `iobroker.${this.adapterName}`);
        this.log.notice(`Creating or patching sourcemaps in ${outDir}`);
        const sourcemaps = await this.findFiles('map', true);
        if (sourcemaps.length === 0) {
            this.log.debug(`Couldn't find any sourcemaps in ${this.rootPath},\nwill try to reverse map .js files`);

            // search all .js files that exist in the node module in the temp directory as well as in the root directory and
            // create sourcemap files for each of them
            const jsFiles = await this.findFiles('js', true);
            await Promise.all(
                jsFiles.map(async js => {
                    const src = path.join(this.rootPath, js);
                    const dest = path.join(outDir, js);
                    await this.addSourcemap(src, dest, false);
                }),
            );
            return;
        }

        // copy all *.map files to the node module in the temp directory and
        // change their sourceRoot so they can be found in the development directory
        await Promise.all(
            sourcemaps.map(async sourcemap => {
                const src = path.join(this.rootPath, sourcemap);
                const dest = path.join(outDir, sourcemap);
                await this.patchSourcemap(src, dest);
            }),
        );
    }

    /**
     * Patch an existing sourcemap file.
     *
     * @param src The path to the original sourcemap file to patch and copy.
     * @param dest The path to the sourcemap file that is created.
     */
    protected async patchSourcemap(src: string, dest: string): Promise<void> {
        try {
            const data = await readJson(src);
            if (data.version !== 3) {
                throw new Error(`Unsupported sourcemap version: ${data.version}`);
            }
            data.sourceRoot = path.dirname(src).replace(/\\/g, '/');
            await writeJson(dest, data);
            this.log.debug(`Patched ${dest} from ${src}`);
        } catch (error) {
            this.log.warn(`Couldn't patch ${dest}: ${error as Error}`);
        }
    }

    /**
     * Create an identity sourcemap to point to a different source file.
     *
     * @param src The path to the original JavaScript file.
     * @param dest The path to the JavaScript file which will get a sourcemap attached.
     * @param copyFromSrc Set to true to copy the JavaScript file from src to dest (not just modify dest).
     */
    protected async addSourcemap(src: string, dest: string, copyFromSrc: boolean): Promise<void> {
        try {
            const mapFile = `${dest}.map`;
            const data = await this.createIdentitySourcemap(src.replace(/\\/g, '/'));
            await writeJson(mapFile, data);

            // append the sourcemap reference comment to the bottom of the file
            const fileContent = await readFile(copyFromSrc ? src : dest, { encoding: 'utf-8' });
            const filename = path.basename(mapFile);
            let updatedContent = fileContent.replace(/(\/\/# sourceMappingURL=).+/, `$1${filename}`);
            if (updatedContent === fileContent) {
                // no existing source mapping URL was found in the file
                if (!fileContent.endsWith('\n')) {
                    if (fileContent.match(/\r\n/)) {
                        // windows eol
                        updatedContent += '\r';
                    }
                    updatedContent += '\n';
                }
                updatedContent += `//# sourceMappingURL=${filename}`;
            }

            await writeFile(dest, updatedContent);
            this.log.debug(`Created ${mapFile} from ${src}`);
        } catch (error) {
            this.log.warn(`Couldn't reverse map for ${src}: ${error as Error}`);
        }
    }

    private async createIdentitySourcemap(filename: string): Promise<RawSourceMap> {
        // thanks to https://github.com/gulp-sourcemaps/identity-map/blob/251b51598d02e5aedaea8f1a475dfc42103a2727/lib/generate.js [MIT]
        const generator = new SourceMapGenerator({ file: filename });
        const fileContent = await readFile(filename, { encoding: 'utf-8' });
        const tok = tokenizer(fileContent, {
            ecmaVersion: 'latest',
            allowHashBang: true,
            locations: true,
        });

        while (true) {
            const token = tok.getToken();

            if (token.type.label === 'eof' || !token.loc) {
                break;
            }
            const mapping = {
                original: token.loc.start,
                generated: token.loc.start,
                source: filename,
            };
            generator.addMapping(mapping);
        }

        return generator.toJSON();
    }

    protected getFilePatterns(extensions: string | string[], excludeAdmin: boolean): string[] {
        const exts = typeof extensions === 'string' ? [extensions] : extensions;
        const patterns = exts.map(e => `./**/*.${e}`);
        patterns.push('!./.*/**');
        patterns.push('!./**/node_modules/**');
        patterns.push('!./test/**');
        if (excludeAdmin) {
            patterns.push('!./admin/**');
        }
        return patterns;
    }

    private async findFiles(extension: string, excludeAdmin: boolean): Promise<string[]> {
        return await fg(this.getFilePatterns(extension, excludeAdmin), { cwd: this.rootPath });
    }
}
