const { describe, it, before, after } = require('mocha');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
    runCommand,
    runCommandWithSignal,
    runCommandWithFileChange,
    setupTestAdapter,
    cleanupTestAdapter,
    validateIoPackageJson,
    validatePackageJson,
    validateTypeScriptConfig,
    runDevServerSetupTest,
    validateRunTestOutput,
    validateWatchTestOutput,
    validateWatchRestartOutput
} = require('./test-utils');

const DEV_SERVER_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const ADAPTERS_DIR = path.join(TEST_DIR, 'adapters');
const PURE_TS_ADAPTER_CONFIG = path.join(ADAPTERS_DIR, 'test-pure-ts.create-adapter.json');
const PURE_TS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-pure-ts');

// Timeout for various operations (in ms)
const SETUP_TIMEOUT = 180000; // 3 minutes
const RUN_TIMEOUT = 120000; // 2 minutes
const WATCH_TIMEOUT = 120000; // 2 minutes

describe('dev-server integration tests - Pure TypeScript', function () {
    // Increase timeout for the whole suite
    this.timeout(200000); // 200 seconds

    before(async () => {
        await setupTestAdapter({
            adapterName: 'Pure TypeScript',
            configFile: PURE_TS_ADAPTER_CONFIG,
            adapterDir: PURE_TS_ADAPTER_DIR,
            adaptersDir: ADAPTERS_DIR
        });
    });

    after(() => {
        // Clean up test adapters
        console.log('Cleaning up pure TypeScript test adapter...');
        try {
            //fs.rmSync(PURE_TS_ADAPTER_DIR, { recursive: true, force: true });
        } catch (error) {
            console.warn('Error cleaning up pure TypeScript test adapter:', error.message);
        }
    });

    describe('Adapter Configuration', () => {
        it('should have valid io-package.json with TypeScript metadata', () => {
            validateIoPackageJson(PURE_TS_ADAPTER_DIR, 'test-pure-ts', true);
        });

        it('should have package.json pointing main to TypeScript file', () => {
            const packageJson = validatePackageJson(PURE_TS_ADAPTER_DIR);
            console.log(packageJson);
            assert.strictEqual(packageJson.main, 'src/main.ts', 'main field should point to src/main.ts');

            // Verify the build scripts have been removed
            assert.ok(packageJson.scripts.check?.includes("--noEmit"), 'check script should use --noEmit for type checking only');
            assert.ok(!packageJson.scripts?.prebuild, 'prebuild script should not exist');
        });

        it('should have TypeScript source file but no dist directory', () => {
            const mainTsPath = path.join(PURE_TS_ADAPTER_DIR, 'src', 'main.ts');
            assert.ok(fs.existsSync(mainTsPath), 'src/main.ts should exist');

            const distPath = path.join(PURE_TS_ADAPTER_DIR, 'dist');
            assert.ok(!fs.existsSync(distPath), 'dist directory should not exist for pure TypeScript adapter');
        });

        it('should have TypeScript configuration files', () => {
            validateTypeScriptConfig(PURE_TS_ADAPTER_DIR);
        });
    });

    describe('dev-server setup', () => {
        it('should create .dev-server directory structure and install @alcalzone/esbuild-register', async () => {
            this.timeout(SETUP_TIMEOUT);

            const { defaultDir } = await runDevServerSetupTest(DEV_SERVER_ROOT, PURE_TS_ADAPTER_DIR, SETUP_TIMEOUT);

            // Verify @alcalzone/esbuild-register was added for TypeScript support
            const packageJsonPath = path.join(defaultDir, 'package.json');
            const profilePackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            assert.ok(
                profilePackageJson.dependencies?.['@alcalzone/esbuild-register'],
                '@alcalzone/esbuild-register dependency should be added for TypeScript adapters'
            );

            // Verify that @alcalzone/esbuild-register is installed
            const nodeModulesPath = path.join(defaultDir, 'node_modules');
            const esbuildRegisterPath = path.join(nodeModulesPath, '@alcalzone', 'esbuild-register');
            assert.ok(fs.existsSync(esbuildRegisterPath), '@alcalzone/esbuild-register should be installed');
        });
    });

    describe('dev-server run', () => {
        it('should start js-controller and admin.0 but not the adapter', async () => {
            this.timeout(RUN_TIMEOUT + 10000);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            const result = await runCommandWithSignal('node', [devServerPath, 'run'], {
                cwd: PURE_TS_ADAPTER_DIR,
                timeout: RUN_TIMEOUT,
                verbose: true,
                finalMessage: /Watching files\.\.\./g,
            });

            const output = result.stdout + result.stderr;
            validateRunTestOutput(output, 'test-pure-ts');
        });
    });

    describe('dev-server watch', () => {
        it('should start pure TypeScript adapter with esbuild-register and show info logs', async () => {
            this.timeout(WATCH_TIMEOUT + 10000);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            const result = await runCommandWithSignal('node', [devServerPath, 'watch'], {
                cwd: PURE_TS_ADAPTER_DIR,
                timeout: WATCH_TIMEOUT,
                verbose: true,
                finalMessage: /test-pure-ts\.0 \([\d]+\) state test-pure-ts\.0\.testVariable deleted/g,
            });

            const output = result.stdout + result.stderr;
            validateWatchTestOutput(output, 'test-pure-ts');

            // Verify that esbuild-register is working by checking that TypeScript files are being executed
            // The presence of successful adapter execution indicates esbuild-register is transpiling the .ts files
            assert.ok(
                output.includes('starting. Version 0.0.1'),
                'esbuild-register should successfully transpile and execute TypeScript files'
            );
        });

        it('should restart adapter when TypeScript source file changes', async () => {
            this.timeout(WATCH_TIMEOUT + 60000); // Extra time for file change and restart

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
            const mainFile = path.join(PURE_TS_ADAPTER_DIR, 'src', 'main.ts');

            const result = await runCommandWithFileChange('node', [devServerPath, 'watch'], {
                cwd: PURE_TS_ADAPTER_DIR,
                timeout: WATCH_TIMEOUT + 30000,
                verbose: true,
                initialMessage: /test-pure-ts\.0 \([\d]+\) state test-pure-ts\.0\.testVariable deleted/g,
                finalMessage: /test-pure-ts\.0 \([\d]+\) state test-pure-ts\.0\.testVariable deleted/g,
                fileToChange: mainFile,
            });

            const output = result.stdout + result.stderr;
            validateWatchTestOutput(output, 'test-pure-ts');
            validateWatchRestartOutput(output, 'test-pure-ts');

            // Verify that esbuild-register is working by checking that TypeScript files are being executed
            assert.ok(
                output.includes('starting. Version 0.0.1'),
                'esbuild-register should successfully transpile and execute TypeScript files after restart'
            );
        });
    });
});
