const { describe, it, before, after } = require('mocha');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCommand, runCommandWithSignal, createTestAdapter } = require('./test-utils');

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
        console.log('Setting up test adapters...');
        console.log('Test directory:', TEST_DIR);
        console.log('Dev-server root:', DEV_SERVER_ROOT);
        console.log('Node.js version:', process.version);

        // Create TypeScript test adapter
        if (fs.existsSync(TS_ADAPTER_CONFIG)) {
            console.log('Creating TypeScript test adapter...');
            await createTestAdapter(TS_ADAPTER_CONFIG, ADAPTERS_DIR);
        } else {
            throw new Error(`TypeScript adapter config not found: ${TS_ADAPTER_CONFIG}`);
        }

        console.log('Test adapters created successfully');

        // Patch the main.ts file because create-adapter generates non-ts-compliant files right now
        // Remove when new version of create-adapter is released
        const mainTsPath = path.join(TS_ADAPTER_DIR, 'src', 'main.ts');
        let mainTsContent = fs.readFileSync(mainTsPath, 'utf8');
        mainTsContent = mainTsContent.replace(
            'let result = await this.checkPasswordAsync("admin", "iobroker");',
            'const result = await this.checkPasswordAsync("admin", "iobroker");',
        );
        mainTsContent = mainTsContent.replace(
            'result = await this.checkGroupAsync("admin", "admin");',
            'const groupResult = await this.checkGroupAsync("admin", "admin");',
        );
        mainTsContent = mainTsContent.replace(
            'this.log.info("check group user admin group admin: " + result);',
            'this.log.info("check group user admin group admin: " + groupResult);',
        );
        fs.writeFileSync(mainTsPath, mainTsContent, 'utf8');
        console.log(`Patched ${mainTsPath} for TypeScript compliance`);

        // Run npm install for both test adapters to ensure dependencies are installed locally
        // Using --prefix parameter as requested to limit installation to exactly the test directory
        console.log('Installing dependencies for test adapters...');

        console.log('Installing dependencies for TypeScript test adapter...');
        try {
            await runCommand('npm', ['install', '--prefix', TS_ADAPTER_DIR], {
                cwd: TS_ADAPTER_DIR,
                timeout: 120000, // 2 minutes
                verbose: false,
            });
            console.log('TypeScript test adapter dependencies installed');
        } catch (error) {
            console.warn('Warning: Failed to install TS adapter dependencies:', error.message);
        }

        console.log('All test adapters prepared successfully');
    });

    after(() => {
        // Clean up test adapters
        console.log('Cleaning up test adapters...');
        try {
            fs.rmSync(TS_ADAPTER_DIR, { recursive: true, force: true });
        } catch (error) {
            console.warn('Error cleaning up test adapters:', error.message);
        }
    });

    describe('Adapter Configuration', () => {
        it('should have valid io-package.json with TypeScript metadata', () => {
            const ioPackagePath = path.join(TS_ADAPTER_DIR, 'io-package.json');
            assert.ok(fs.existsSync(ioPackagePath), 'io-package.json not found');

            const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
            assert.ok(ioPackage.common, 'io-package.json missing common section');
            assert.ok(ioPackage.common.name, 'io-package.json missing common.name');
            assert.strictEqual(ioPackage.common.name, 'test-ts', 'Adapter name should be test-ts');

            // Check TypeScript-specific keywords
            assert.ok(ioPackage.common.keywords.includes('typescript'), 'Should include typescript keyword');
        });

        it('should have TypeScript configuration files', () => {
            const tsconfigPath = path.join(TS_ADAPTER_DIR, 'tsconfig.json');
            assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json not found for TypeScript adapter');
        });
    });

    describe('dev-server setup', () => {
        it('should create .dev-server directory structure', async () => {
            this.timeout(SETUP_TIMEOUT);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            await runCommand('node', [devServerPath, 'setup'], {
                cwd: TS_ADAPTER_DIR,
                timeout: SETUP_TIMEOUT,
                verbose: true,
            });

            // Check that .dev-server directory was created
            const devServerDir = path.join(TS_ADAPTER_DIR, '.dev-server');
            assert.ok(fs.existsSync(devServerDir), '.dev-server directory not created');

            // Check that profile directory exists
            const defaultProfileDir = path.join(devServerDir, 'default');
            assert.ok(fs.existsSync(defaultProfileDir), 'default profile directory not created');

            // Check that package.json was created
            const packageJsonPath = path.join(defaultProfileDir, 'package.json');
            assert.ok(fs.existsSync(packageJsonPath), 'package.json not created in profile directory');

            // Check node_modules exists
            const nodeModulesPath = path.join(defaultProfileDir, 'node_modules');
            assert.ok(fs.existsSync(nodeModulesPath), 'node_modules directory not created');

            // Check that iobroker.json was created
            const iobrokerJsonPath = path.join(defaultProfileDir, 'iobroker-data', 'iobroker.json');
            assert.ok(fs.existsSync(iobrokerJsonPath), 'iobroker.json not created in profile directory');
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

            // Should see host logs
            assert.ok(output.includes('host.'), 'No host logs found in output');

            // Should see admin.0 logs
            assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

            // Should NOT see test-ts.0 logs (adapter should not start in run mode)
            assert.ok(!output.includes('startInstance test-ts.0'), 'test-ts.0 adapter should not start in run mode');

            // Check for minimal error logs
            const errorLines = output.split('\n').filter(
                line =>
                    line.toLowerCase().includes('error') &&
                    !line.includes('npm ERR!') && // Ignore npm-related errors
                    !line.includes('audit fix') && // Ignore npm audit messages
                    !line.includes('loglevel error') && // Ignore npm loglevel settings
                    !line.includes('--loglevel error'),
            );

            if (errorLines.length > 5) {
                // Allow some setup errors
                console.warn(`Warning: Found ${errorLines.length} error lines in output`);
                errorLines.slice(0, 3).forEach(line => console.warn('ERROR:', line));
            }
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
                finalMessage: /test-ts\\.0 \\([\\d]+\\) state test-ts\\.0\\.testVariable deleted/g,
            });

            const output = result.stdout + result.stderr;

            // Should see test adapter logs
            assert.ok(
                !output.includes('startInstance test-ts.0'),
                'test-ts.0 should not start in watch mode (no "startInstance test-ts.0" log expected)',
            );
            assert.ok(output.includes('adapter disabled'), 'No test-ts.0 disabled info found in output');

            assert.ok(output.includes('starting. Version 0.0.1'), 'No test-ts.0 adapter starting in output');
            assert.ok(
                output.includes('state test-ts.0.testVariable deleted'),
                'No test-ts.0 logic message subscription message in output',
            );

            // Should see host logs
            assert.ok(output.includes('host.'), 'No host logs found in output');

            // Should see admin.0 logs
            assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

            // Look for info logs from the adapter
            const infoLines = output.split('\n').filter(line => line.includes('test-ts.0') && line.includes('info'));

            // The adapter should produce some info logs
            assert.ok(infoLines.length > 0, 'No info logs found from test-ts.0 adapter');
        });
    });
});
