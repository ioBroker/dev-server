import { after, before, describe, it } from 'mocha';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cleanupTestAdapter,
    runCommandWithFileChange,
    runCommandWithJsonConfigChange,
    runCommandWithSignal,
    runDevServerSetupTest,
    setupTestAdapter,
    validateIoPackageJson,
    validateJsonConfigChangeDetection,
    validateRunTestOutput,
    validateTypeScriptConfig,
    validateWatchRestartOutput,
    validateWatchTestOutput,
} from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
            needsTypeScriptPatching: true,
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

        it('should restart adapter when main file changes', async () => {
            this.timeout(WATCH_TIMEOUT + 60000); // Extra time for file change and restart

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
            const mainFile = path.join(TS_ADAPTER_DIR, 'build', 'main.js');

            const result = await runCommandWithFileChange('node', [devServerPath, 'watch'], {
                cwd: TS_ADAPTER_DIR,
                timeout: WATCH_TIMEOUT + 30000,
                verbose: true,
                initialMessage: /test-ts\.0 \([\d]+\) state test-ts\.0\.testVariable deleted/g,
                finalMessage: /test-ts\.0 \([\d]+\) state test-ts\.0\.testVariable deleted/g,
                fileToChange: mainFile,
            });

            const output = result.stdout + result.stderr;
            validateWatchTestOutput(output, 'test-ts');
            validateWatchRestartOutput(output, 'test-ts');
        });

        it('should detect jsonConfig.json file changes and hot-reload', async () => {
            this.timeout(WATCH_TIMEOUT + 60000); // Extra time for file change detection

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
            const jsonConfigFile = path.join(TS_ADAPTER_DIR, 'admin', 'jsonConfig.json');

            // Fail test if jsonConfig file doesn't exist (test setup issue)
            assert.ok(
                fs.existsSync(jsonConfigFile),
                'jsonConfig.json file must exist for this test (test setup issue)',
            );

            // Backup original jsonConfig
            const jsonConfigBackup = fs.readFileSync(jsonConfigFile, 'utf8');

            try {
                const result = await runCommandWithJsonConfigChange('node', [devServerPath, 'watch'], {
                    cwd: TS_ADAPTER_DIR,
                    timeout: WATCH_TIMEOUT + 30000,
                    verbose: true,
                    initialMessage: /test-ts\.0 \([\d]+\) state test-ts\.0\.testVariable deleted/g,
                    changeDetectionMessage: /Detected change in jsonConfig\.json/,
                    fileToChange: jsonConfigFile,
                });

                const output = result.stdout + result.stderr;
                validateWatchTestOutput(output, 'test-ts');
                validateJsonConfigChangeDetection(output);
            } finally {
                // Restore original jsonConfig
                fs.writeFileSync(jsonConfigFile, jsonConfigBackup);
            }
        });
    });
});
