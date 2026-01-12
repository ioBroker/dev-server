"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunCommandBase = void 0;
const acorn_1 = __importDefault(require("acorn"));
const axios_1 = __importDefault(require("axios"));
const browser_sync_1 = __importDefault(require("browser-sync"));
const chalk_1 = __importDefault(require("chalk"));
const express_1 = __importDefault(require("express"));
const fast_glob_1 = __importDefault(require("fast-glob"));
const fs_extra_1 = require("fs-extra");
const http_proxy_middleware_1 = require("http-proxy-middleware");
const node_events_1 = __importDefault(require("node:events"));
const node_path_1 = __importDefault(require("node:path"));
const source_map_1 = require("source-map");
const ws_1 = __importDefault(require("ws"));
const jsonConfig_1 = require("../jsonConfig");
const CommandBase_1 = require("./CommandBase");
const utils_1 = require("./utils");
class RunCommandBase extends CommandBase_1.CommandBase {
    constructor() {
        super(...arguments);
        this.socketEvents = new node_events_1.default();
    }
    async startJsController() {
        const proc = await this.spawn('node', [
            '--inspect=127.0.0.1:9228',
            '--preserve-symlinks',
            '--preserve-symlinks-main',
            'node_modules/iobroker.js-controller/controller.js',
        ], this.profileDir);
        proc.on('exit', async (code) => {
            console.error(chalk_1.default.yellow(`ioBroker controller exited with code ${code}`));
            return this.exit(-1, 'SIGKILL');
        });
        this.log.notice('Waiting for js-controller to start...');
        await this.waitForJsController();
    }
    async waitForJsController() {
        if (!(await this.waitForPort(CommandBase_1.OBJECTS_DB_PORT_OFFSET)) || !(await this.waitForPort(CommandBase_1.STATES_DB_PORT_OFFSET))) {
            throw new Error(`Couldn't start js-controller`);
        }
    }
    async waitForPort(offset) {
        const port = this.getPort(offset);
        this.log.debug(`Waiting for port ${port} to be available...`);
        let tries = 0;
        while (true) {
            try {
                await (0, utils_1.checkPort)(port);
                this.log.debug(`Port ${port} is available...`);
                return true;
            }
            catch (_a) {
                if (tries++ > 30) {
                    this.log.error(`Port ${port} is not available after 30 seconds.`);
                    return false;
                }
                await (0, utils_1.delay)(1000);
            }
        }
    }
    async startServer(useBrowserSync = true) {
        this.log.notice(`Running inside ${this.profileDir}`);
        if (!this.config) {
            throw new Error(`Couldn't find dev-server configuration in package.json`);
        }
        await this.waitForPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET);
        const app = (0, express_1.default)();
        const hiddenAdminPort = this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET);
        if (this.isJSController()) {
            // simply forward admin as-is
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)({
                target: `http://127.0.0.1:${hiddenAdminPort}`,
                ws: true,
            }));
        }
        else {
            // Determine what UI capabilities this adapter needs
            const uiCapabilities = await this.getAdapterUiCapabilities();
            if (uiCapabilities.configType === 'json' && uiCapabilities.tabType !== 'none') {
                // Adapter uses jsonConfig AND has tabs - support both simultaneously
                await this.createCombinedConfigProxy(app, this.config, uiCapabilities, useBrowserSync);
            }
            else if (uiCapabilities.configType === 'json') {
                // JSON config only
                await this.createJsonConfigProxy(app, this.config, useBrowserSync);
            }
            else {
                // HTML config or tabs only (or no config)
                await this.createHtmlConfigProxy(app, this.config, useBrowserSync);
            }
        }
        // start express
        this.log.notice(`Starting web server on port ${this.config.adminPort}`);
        const server = app.listen(this.config.adminPort);
        let exiting = false;
        process.on('SIGINT', () => {
            this.log.notice('dev-server is exiting...');
            exiting = true;
            server.close();
            // do not kill this process when receiving SIGINT, but let all child processes exit first
            // but send the signal to all child processes when not in a tty environment
            if (!process.stdin.isTTY) {
                this.log.silly('Sending SIGINT to all child processes...');
                this.childProcesses.forEach(p => p.kill('SIGINT'));
            }
        });
        await new Promise((resolve, reject) => {
            server.on('listening', resolve);
            server.on('error', reject);
            server.on('close', reject);
        });
        if (!this.isJSController()) {
            const connectWebSocketClient = () => {
                if (exiting) {
                    return;
                }
                // TODO: replace this with @iobroker/socket-client
                this.websocket = new ws_1.default(`ws://127.0.0.1:${hiddenAdminPort}/?sid=${Date.now()}&name=admin`);
                this.websocket.on('open', () => this.log.silly('WebSocket open'));
                this.websocket.on('close', () => {
                    this.log.silly('WebSocket closed');
                    this.websocket = undefined;
                    setTimeout(connectWebSocketClient, 1000);
                });
                this.websocket.on('error', error => this.log.silly(`WebSocket error: ${error}`));
                this.websocket.on('message', msg => {
                    var _a;
                    // eslint-disable-next-line @typescript-eslint/no-base-to-string
                    const msgString = msg === null || msg === void 0 ? void 0 : msg.toString();
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
                                    (_a = this.websocket) === null || _a === void 0 ? void 0 : _a.send('[2]');
                                    break;
                            }
                        }
                        catch (error) {
                            this.log.error(`Couldn't handle WebSocket message: ${error}`);
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
    async getAdapterUiCapabilities() {
        var _a;
        let configType = 'none';
        let tabType = 'none';
        // Check for jsonConfig files first
        if (this.getJsonConfigPath()) {
            configType = 'json';
        }
        if (!this.isJSController()) {
            // Check io-package.json adminUi field (replicate what admin does)
            try {
                const ioPackage = await this.readIoPackageJson();
                if ((_a = ioPackage === null || ioPackage === void 0 ? void 0 : ioPackage.common) === null || _a === void 0 ? void 0 : _a.adminUi) {
                    const adminUi = ioPackage.common.adminUi;
                    this.log.debug(`Found adminUi configuration in io-package.json: ${JSON.stringify(adminUi)}`);
                    // Set config type based on adminUi.config
                    if (adminUi.config === 'json') {
                        configType = 'json';
                    }
                    else if (adminUi.config === 'html' || adminUi.config === 'materialize') {
                        configType = 'html';
                    }
                    // Set tab type based on adminUi.tab
                    if (adminUi.tab === 'json') {
                        tabType = 'json';
                    }
                    else if (adminUi.tab === 'html' || adminUi.tab === 'materialize') {
                        tabType = 'html';
                    }
                }
            }
            catch (error) {
                this.log.debug(`Failed to read io-package.json adminUi: ${error}`);
            }
        }
        this.log.debug(`UI capabilities: configType=${configType}, tabType=${tabType}`);
        return {
            configType,
            tabType,
        };
    }
    getJsonConfigPath() {
        const jsonConfigPath = node_path_1.default.resolve(this.rootDir, 'admin/jsonConfig.json');
        if ((0, fs_extra_1.existsSync)(jsonConfigPath)) {
            return jsonConfigPath;
        }
        if ((0, fs_extra_1.existsSync)(`${jsonConfigPath}5`)) {
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
     * @param config Dev server configuration
     * @param uiCapabilities Object containing configType and tabType detected from io-package.json
     * @param useBrowserSync Whether to use BrowserSync for hot-reload (default: true)
     */
    async createCombinedConfigProxy(app, config, uiCapabilities, useBrowserSync = true) {
        // This method combines the functionality of createJsonConfigProxy and createHtmlConfigProxy
        // to support adapters that use jsonConfig and tabs simultaneously
        const pathRewrite = {};
        const browserSyncPort = this.getPort(CommandBase_1.HIDDEN_BROWSER_SYNC_PORT_OFFSET);
        const adminUrl = `http://127.0.0.1:${this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET)}`;
        let hasReact = false;
        let bs = null;
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
            this.setupJsonFileWatch(bs, jsonConfigFile, node_path_1.default.basename(jsonConfigFile));
            // "proxy" for the main page which injects our script
            app.get('/', async (_req, res) => {
                const { data } = await axios_1.default.get(adminUrl);
                res.send((0, jsonConfig_1.injectCode)(data, this.adapterName, node_path_1.default.basename(jsonConfigFile)));
            });
        }
        // Handle tab file watching if present
        if (uiCapabilities.tabType !== 'none' && useBrowserSync && bs) {
            if (uiCapabilities.tabType === 'json') {
                // Watch JSON tab files
                const jsonTabPath = node_path_1.default.resolve(this.rootDir, 'admin/jsonTab.json');
                const jsonTab5Path = node_path_1.default.resolve(this.rootDir, 'admin/jsonTab.json5');
                this.setupJsonFileWatch(bs, jsonTabPath, 'jsonTab.json');
                this.setupJsonFileWatch(bs, jsonTab5Path, 'jsonTab.json5');
            }
            if (uiCapabilities.tabType === 'html') {
                // Watch HTML tab files
                const tabHtmlPath = node_path_1.default.resolve(this.rootDir, 'admin/tab.html');
                if ((0, fs_extra_1.existsSync)(tabHtmlPath)) {
                    bs.watch(tabHtmlPath, undefined, (e) => {
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
                app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)([adminPattern, '/browser-sync/**'], {
                    target: `http://127.0.0.1:${browserSyncPort}`,
                    //ws: true, // can't have two web-socket connections proxying to different locations
                    pathRewrite,
                }));
                // admin proxy
                app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)([`!${adminPattern}`, '!/browser-sync/**'], {
                    target: adminUrl,
                    ws: true,
                }));
            }
            else {
                // browser-sync proxy (for JSON config only)
                app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)(['/browser-sync/**'], {
                    target: `http://127.0.0.1:${browserSyncPort}`,
                    // ws: true, // can't have two web-socket connections proxying to different locations
                }));
                // admin proxy
                app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)({
                    target: adminUrl,
                    ws: true,
                }));
            }
        }
        else {
            // Direct admin proxy without browser-sync
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)({
                target: adminUrl,
                ws: true,
            }));
        }
    }
    createJsonConfigProxy(app, config, useBrowserSync = true) {
        const jsonConfigFile = this.getJsonConfigPath();
        const adminUrl = `http://127.0.0.1:${this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET)}`;
        if (useBrowserSync) {
            // Use BrowserSync for hot-reload functionality
            const browserSyncPort = this.getPort(CommandBase_1.HIDDEN_BROWSER_SYNC_PORT_OFFSET);
            const bs = this.startBrowserSync(browserSyncPort, false);
            // Setup file watching for jsonConfig changes
            this.setupJsonFileWatch(bs, jsonConfigFile, node_path_1.default.basename(jsonConfigFile));
            // "proxy" for the main page which injects our script
            app.get('/', async (_req, res) => {
                const { data } = await axios_1.default.get(adminUrl);
                res.send((0, jsonConfig_1.injectCode)(data, this.adapterName, node_path_1.default.basename(jsonConfigFile)));
            });
            // browser-sync proxy
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)(['/browser-sync/**'], {
                target: `http://127.0.0.1:${browserSyncPort}`,
                // ws: true, // can't have two web-socket connections proxying to different locations
            }));
            // admin proxy
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)({
                target: adminUrl,
                ws: true,
            }));
        }
        else {
            // Serve without BrowserSync - just proxy admin directly
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)({
                target: adminUrl,
                ws: true,
            }));
        }
        return Promise.resolve();
    }
    async createHtmlConfigProxy(app, config, useBrowserSync = true) {
        const pathRewrite = {};
        const adminPattern = `/adapter/${this.adapterName}/**`;
        // Setup React build watching if needed
        const hasReact = await this.setupReactWatch(pathRewrite);
        if (useBrowserSync) {
            // Use BrowserSync for hot-reload functionality
            const browserSyncPort = this.getPort(CommandBase_1.HIDDEN_BROWSER_SYNC_PORT_OFFSET);
            this.startBrowserSync(browserSyncPort, hasReact);
            // browser-sync proxy
            pathRewrite[`^/adapter/${this.adapterName}/`] = '/';
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)([adminPattern, '/browser-sync/**'], {
                target: `http://127.0.0.1:${browserSyncPort}`,
                //ws: true, // can't have two web-socket connections proxying to different locations
                pathRewrite,
            }));
            // admin proxy
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)([`!${adminPattern}`, '!/browser-sync/**'], {
                target: `http://127.0.0.1:${this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET)}`,
                ws: true,
            }));
        }
        else {
            // Serve without BrowserSync - serve admin files directly and proxy the rest
            const adminPath = node_path_1.default.resolve(this.rootDir, 'admin/');
            // serve static admin files
            app.use(`/adapter/${this.adapterName}`, express_1.default.static(adminPath));
            // admin proxy for everything else
            app.use((0, http_proxy_middleware_1.legacyCreateProxyMiddleware)([`!${adminPattern}`], {
                target: `http://127.0.0.1:${this.getPort(CommandBase_1.HIDDEN_ADMIN_PORT_OFFSET)}`,
                ws: true,
            }));
        }
    }
    /**
     * Helper method to setup React build watching
     * Returns true if React watching was started, false otherwise
     */
    async setupReactWatch(pathRewrite) {
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
            if ((0, fs_extra_1.existsSync)(node_path_1.default.resolve(this.rootDir, 'admin/.watch'))) {
                // rewrite the build directory to the .watch directory,
                // because "watch:react" no longer updates the build directory automatically
                pathRewrite[`^/adapter/${this.adapterName}/build/`] = '/.watch/';
            }
        }
        else if (scripts['watch:parcel']) {
            // use React with legacy script name
            await this.startReact('watch:parcel');
            hasReact = true;
        }
        return hasReact;
    }
    startBrowserSync(port, hasReact) {
        this.log.notice('Starting browser-sync');
        const bs = browser_sync_1.default.create();
        const adminPath = node_path_1.default.resolve(this.rootDir, 'admin/');
        const config = {
            server: { baseDir: adminPath, directory: true },
            port: port,
            open: false,
            ui: false,
            logLevel: 'info',
            reloadDelay: hasReact ? 500 : 0,
            reloadDebounce: hasReact ? 500 : 0,
            files: [node_path_1.default.join(adminPath, '**')],
            plugins: [
                {
                    module: 'bs-html-injector',
                    options: {
                        files: [node_path_1.default.join(adminPath, '*.html')],
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
    setupJsonFileWatch(bs, filePath, fileName) {
        if (!(0, fs_extra_1.existsSync)(filePath)) {
            return;
        }
        bs.watch(filePath, undefined, async (e) => {
            var _a;
            if (e === 'change') {
                this.log.info(`Detected change in ${fileName}, uploading to ioBroker...`);
                const content = await (0, fs_extra_1.readFile)(filePath);
                (_a = this.websocket) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify([
                    3,
                    46,
                    'writeFile',
                    [`${this.adapterName}.admin`, fileName, Buffer.from(content).toString('base64')],
                ]));
            }
        });
    }
    async startReact(scriptName) {
        this.log.notice('Starting React build');
        this.log.debug('Waiting for first successful React build...');
        await this.spawnAndAwaitOutput('npm', ['run', scriptName], this.rootDir, /(built in|done in|watching (files )?for)/i, {
            shell: true,
        });
    }
    async copySourcemaps() {
        const outDir = node_path_1.default.join(this.profileDir, 'node_modules', `iobroker.${this.adapterName}`);
        this.log.notice(`Creating or patching sourcemaps in ${outDir}`);
        const sourcemaps = await this.findFiles('map', true);
        if (sourcemaps.length === 0) {
            this.log.debug(`Couldn't find any sourcemaps in ${this.rootDir},\nwill try to reverse map .js files`);
            // search all .js files that exist in the node module in the temp directory as well as in the root directory and
            // create sourcemap files for each of them
            const jsFiles = await this.findFiles('js', true);
            await Promise.all(jsFiles.map(async (js) => {
                const src = node_path_1.default.join(this.rootDir, js);
                const dest = node_path_1.default.join(outDir, js);
                await this.addSourcemap(src, dest, false);
            }));
            return;
        }
        // copy all *.map files to the node module in the temp directory and
        // change their sourceRoot so they can be found in the development directory
        await Promise.all(sourcemaps.map(async (sourcemap) => {
            const src = node_path_1.default.join(this.rootDir, sourcemap);
            const dest = node_path_1.default.join(outDir, sourcemap);
            await this.patchSourcemap(src, dest);
        }));
    }
    /**
     * Patch an existing sourcemap file.
     *
     * @param src The path to the original sourcemap file to patch and copy.
     * @param dest The path to the sourcemap file that is created.
     */
    async patchSourcemap(src, dest) {
        try {
            const data = await (0, fs_extra_1.readJson)(src);
            if (data.version !== 3) {
                throw new Error(`Unsupported sourcemap version: ${data.version}`);
            }
            data.sourceRoot = node_path_1.default.dirname(src).replace(/\\/g, '/');
            await (0, fs_extra_1.writeJson)(dest, data);
            this.log.debug(`Patched ${dest} from ${src}`);
        }
        catch (error) {
            this.log.warn(`Couldn't patch ${dest}: ${error}`);
        }
    }
    /**
     * Create an identity sourcemap to point to a different source file.
     *
     * @param src The path to the original JavaScript file.
     * @param dest The path to the JavaScript file which will get a sourcemap attached.
     * @param copyFromSrc Set to true to copy the JavaScript file from src to dest (not just modify dest).
     */
    async addSourcemap(src, dest, copyFromSrc) {
        try {
            const mapFile = `${dest}.map`;
            const data = await this.createIdentitySourcemap(src.replace(/\\/g, '/'));
            await (0, fs_extra_1.writeFile)(mapFile, JSON.stringify(data));
            // append the sourcemap reference comment to the bottom of the file
            const fileContent = await (0, fs_extra_1.readFile)(copyFromSrc ? src : dest, { encoding: 'utf-8' });
            const filename = node_path_1.default.basename(mapFile);
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
            await (0, fs_extra_1.writeFile)(dest, updatedContent);
            this.log.debug(`Created ${mapFile} from ${src}`);
        }
        catch (error) {
            this.log.warn(`Couldn't reverse map for ${src}: ${error}`);
        }
    }
    async createIdentitySourcemap(filename) {
        // thanks to https://github.com/gulp-sourcemaps/identity-map/blob/251b51598d02e5aedaea8f1a475dfc42103a2727/lib/generate.js [MIT]
        const generator = new source_map_1.SourceMapGenerator({ file: filename });
        const fileContent = await (0, fs_extra_1.readFile)(filename, { encoding: 'utf-8' });
        const tokenizer = acorn_1.default.tokenizer(fileContent, {
            ecmaVersion: 'latest',
            allowHashBang: true,
            locations: true,
        });
        while (true) {
            const token = tokenizer.getToken();
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
    getFilePatterns(extensions, excludeAdmin) {
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
    async findFiles(extension, excludeAdmin) {
        return await (0, fast_glob_1.default)(this.getFilePatterns(extension, excludeAdmin), { cwd: this.rootDir });
    }
}
exports.RunCommandBase = RunCommandBase;
