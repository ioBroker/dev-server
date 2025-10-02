const { describe, it, before, after } = require('mocha');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { 
    runCommand, 
    runCommandWithSignal, 
    setupTestAdapter, 
    cleanupTestAdapter,
    validateIoPackageJson,
    validatePackageJson,
    validateTypeScriptConfig,
    runDevServerSetupTest,
    validateRunTestOutput,
    validateWatchTestOutput
} = require('./test-utils');

const DEV_SERVER_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const ADAPTERS_DIR = path.join(TEST_DIR, 'adapters');
const TS_ADAPTER_CONFIG = path.join(ADAPTERS_DIR, 'test-ts.create-adapter.json');
const TS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-ts');

// Timeout for various operations (in ms)
const SETUP_TIMEOUT = 180000; // 3 minutes
const RUN_TIMEOUT = 120000; // 2 minutes
const WATCH_TIMEOUT = 120000; // 2 minutes

describe('dev-server integration tests', function () {
    // Increase timeout for the whole suite
    this.timeout(200000); // 200 seconds (reduced from 300)

    before(async () => {
        await setupTestAdapter({
            adapterName: 'TypeScript',
            configFile: TS_ADAPTER_CONFIG,
            adapterDir: TS_ADAPTER_DIR,
            adaptersDir: ADAPTERS_DIR,
            needsTypeScriptPatching: true
        });
    });

    after(() => {
        cleanupTestAdapter('TypeScript', TS_ADAPTER_DIR);
    });

    describe('Adapter Configuration', () => {
        it('should have valid io-package.json with TypeScript metadata', () => {
            validateIoPackageJson(TS_ADAPTER_DIR, 'test-ts', true);
        });

        it('should have TypeScript configuration files', () => {
            validateTypeScriptConfig(TS_ADAPTER_DIR);
        });
    });

    describe('dev-server setup', () => {
        it('should create .dev-server directory structure', async () => {
            this.timeout(SETUP_TIMEOUT);
            await runDevServerSetupTest(DEV_SERVER_ROOT, TS_ADAPTER_DIR, SETUP_TIMEOUT);
        });
    });

    describe('dev-server run', () => {
        it('should start js-controller and admin.0 but not the adapter', async () => {
            this.timeout(RUN_TIMEOUT + 10000);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            const result = await runCommandWithSignal('node', [devServerPath, 'run'], {
                cwd: TS_ADAPTER_DIR,
                timeout: RUN_TIMEOUT,
                verbose: true,
                finalMessage: /Watching files\.\.\./g,
            });

            const output = result.stdout + result.stderr;
            validateRunTestOutput(output, 'test-ts');
        });
    });

    describe('dev-server watch', () => {
        it('should start adapter and show info logs', async () => {
            this.timeout(WATCH_TIMEOUT + 10000);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            const result = await runCommandWithSignal('node', [devServerPath, 'watch'], {
                cwd: TS_ADAPTER_DIR,
                timeout: WATCH_TIMEOUT,
                verbose: true,
                finalMessage: /test-ts\.0 \([\d]+\) state test-ts\.0\.testVariable deleted/g,
            });

            const output = result.stdout + result.stderr;
            validateWatchTestOutput(output, 'test-ts');
        });
    });
});
