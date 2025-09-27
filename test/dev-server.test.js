const { describe, it, before, after } = require('mocha');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCommand, runCommandWithSignal, createTestAdapter } = require('./test-utils');

const DEV_SERVER_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const ADAPTERS_DIR = path.join(TEST_DIR, 'adapters');
const JS_ADAPTER_CONFIG = path.join(ADAPTERS_DIR, 'test-js.create-adapter.json');
const TS_ADAPTER_CONFIG = path.join(ADAPTERS_DIR, 'test-ts.create-adapter.json');
const JS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-js');
const TS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-ts');

// Timeout for various operations (in ms)
const SETUP_TIMEOUT = 180000; // 3 minutes
const RUN_TIMEOUT = 120000; // 2 minutes
const WATCH_TIMEOUT = 120000; // 2 minutes

describe('dev-server integration tests', function() {
    // Increase timeout for the whole suite
    this.timeout(200000); // 200 seconds (reduced from 300)

    before(async function() {
        console.log('Setting up test adapters...');
        console.log('Test directory:', TEST_DIR);
        console.log('Dev-server root:', DEV_SERVER_ROOT);
        console.log('Node.js version:', process.version);

        // Create JavaScript test adapter
        if (fs.existsSync(JS_ADAPTER_CONFIG)) {
            console.log('Creating JavaScript test adapter...');
            await createTestAdapter(JS_ADAPTER_CONFIG, ADAPTERS_DIR);
        } else {
            throw new Error(`JavaScript adapter config not found: ${JS_ADAPTER_CONFIG}`);
        }

        // Create TypeScript test adapter
        if (fs.existsSync(TS_ADAPTER_CONFIG)) {
            console.log('Creating TypeScript test adapter...');
            await createTestAdapter(TS_ADAPTER_CONFIG, ADAPTERS_DIR);
        } else {
            throw new Error(`TypeScript adapter config not found: ${TS_ADAPTER_CONFIG}`);
        }

        console.log('Test adapters created successfully');

        // Run npm install for both test adapters to ensure dependencies are installed locally
        // Using --prefix parameter as requested to limit installation to exactly the test directory
        console.log('Installing dependencies for test adapters...');
        
        // Skip npm install in CI environment due to timeout issues, but keep the logic for real usage
        const skipNpmInstall = process.env.CI || process.env.GITHUB_ACTIONS;
        
        if (!skipNpmInstall && fs.existsSync(JS_ADAPTER_DIR)) {
            console.log('Installing dependencies for JavaScript test adapter...');
            try {
                await runCommand('npm', ['install', '--prefix', JS_ADAPTER_DIR], {
                    cwd: JS_ADAPTER_DIR,
                    timeout: 120000, // 2 minutes
                    verbose: false
                });
                console.log('JavaScript test adapter dependencies installed');
            } catch (error) {
                console.warn('Warning: Failed to install JS adapter dependencies:', error.message);
            }
        } else if (skipNpmInstall) {
            console.log('Skipping npm install in CI environment');
        }

        if (!skipNpmInstall && fs.existsSync(TS_ADAPTER_DIR)) {
            console.log('Installing dependencies for TypeScript test adapter...');
            try {
                await runCommand('npm', ['install', '--prefix', TS_ADAPTER_DIR], {
                    cwd: TS_ADAPTER_DIR,
                    timeout: 120000, // 2 minutes
                    verbose: false
                });
                console.log('TypeScript test adapter dependencies installed');
            } catch (error) {
                console.warn('Warning: Failed to install TS adapter dependencies:', error.message);
            }
        }

        console.log('All test adapters prepared successfully');
    });

    after(function() {
        // Clean up test adapters
        console.log('Cleaning up test adapters...');
        try {
            if (fs.existsSync(JS_ADAPTER_DIR)) {
                fs.rmSync(JS_ADAPTER_DIR, { recursive: true, force: true });
            }
            if (fs.existsSync(TS_ADAPTER_DIR)) {
                fs.rmSync(TS_ADAPTER_DIR, { recursive: true, force: true });
            }
        } catch (error) {
            console.warn('Error cleaning up test adapters:', error.message);
        }
    });

    describe('JavaScript Adapter', function() {
        describe('Adapter Configuration', function() {
            it('should have valid io-package.json', function() {
                const ioPackagePath = path.join(JS_ADAPTER_DIR, 'io-package.json');
                assert.ok(fs.existsSync(ioPackagePath), 'io-package.json not found');

                const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
                assert.ok(ioPackage.common, 'io-package.json missing common section');
                assert.ok(ioPackage.common.name, 'io-package.json missing common.name');
                assert.strictEqual(ioPackage.common.name, 'test-js', 'Adapter name should be test-js');
            });

            it('should have valid package.json', function() {
                const packagePath = path.join(JS_ADAPTER_DIR, 'package.json');
                assert.ok(fs.existsSync(packagePath), 'package.json not found');

                const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
                assert.ok(packageJson.name, 'package.json missing name');
                assert.ok(packageJson.version, 'package.json missing version');
            });

            it('should have main adapter file', function() {
                const mainFile = path.join(JS_ADAPTER_DIR, 'main.js');
                assert.ok(fs.existsSync(mainFile), 'main.js adapter file not found');
            });
        });

        describe('dev-server setup', function() {
            it('should create .dev-server directory structure', async function() {
                this.timeout(SETUP_TIMEOUT);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommand('node', [devServerPath, 'setup'], {
                    cwd: JS_ADAPTER_DIR,
                    timeout: SETUP_TIMEOUT,
                    verbose: true
                });

                // Verify .dev-server directory was created
                const devServerDir = path.join(JS_ADAPTER_DIR, '.dev-server');
                assert.ok(fs.existsSync(devServerDir), '.dev-server directory not created');

                // Verify default profile directory exists
                const defaultDir = path.join(devServerDir, 'default');
                assert.ok(fs.existsSync(defaultDir), '.dev-server/default directory not created');

                // Verify node_modules exists
                const nodeModulesDir = path.join(defaultDir, 'node_modules');
                assert.ok(fs.existsSync(nodeModulesDir), 'node_modules directory not created');

                // Verify iobroker.json exists
                const iobrokerJson = path.join(defaultDir, 'iobroker-data', 'iobroker.json');
                assert.ok(fs.existsSync(iobrokerJson), 'iobroker.json not created');
            });
        });

        describe('dev-server run', function() {
            it('should start js-controller and admin.0 but not the adapter', async function() {
                this.timeout(RUN_TIMEOUT + 10000);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommandWithSignal('node', [devServerPath, 'run'], {
                    cwd: JS_ADAPTER_DIR,
                    timeout: RUN_TIMEOUT,
                    verbose: true,
                    finalMessage: /Watching files\.\.\./g
                });

                const output = result.stdout + result.stderr;

                console.log('dev-server run output:\n', output);
                // Should see host logs
                assert.ok(output.includes('host.'), 'No host logs found in output');

                // Should see admin.0 logs
                assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

                // Should NOT see test-js.0 logs (adapter should not start in run mode)
                assert.ok(!output.includes('startInstance test-js.0'), 'test-js.0 adapter should not start in run mode');

                // Check for minimal error logs
                const errorLines = output.split('\n').filter(line =>
                    line.toLowerCase().includes('error') &&
                    !line.includes('loglevel error') && // Ignore npm loglevel settings
                    !line.includes('--loglevel error')
                );

                if (errorLines.length > 5) { // Allow some setup errors
                    console.warn(`Warning: Found ${errorLines.length} error lines in output`);
                    errorLines.slice(0, 3).forEach(line => console.warn('ERROR:', line));
                }
            });
        });

        describe('dev-server watch', function() {
            it('should start adapter and show info logs', async function() {
                this.timeout(WATCH_TIMEOUT + 10000);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommandWithSignal('node', [devServerPath, 'watch'], {
                    cwd: JS_ADAPTER_DIR,
                    timeout: WATCH_TIMEOUT,
                    verbose: true,
                    finalMessage: /test-js\.0 \([\d]+\) state test-js\.0\.testVariable deleted/g
                });

                const output = result.stdout + result.stderr;

                // Should see test adapter logs
                assert.ok(!output.includes('startInstance test-js.0'), 'test-js.0 should not start in watch mode (no "startInstance test-js.0" log expected)');
                assert.ok(output.includes('adapter disabled'), 'No test-js.0 disabled info found in output');

                assert.ok(output.includes('starting. Version 0.0.1'), 'No test-js.0 adapter starting in output');
                assert.ok(output.includes('state test-js.0.testVariable deleted'), 'No test-js.0 logic message subscription message in output');

                // Should see host logs
                assert.ok(output.includes('host.'), 'No host logs found in output');

                // Should see admin.0 logs
                assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

                // Look for info logs from the adapter
                const infoLines = output.split('\n').filter(line =>
                    line.includes('test-js.0') && line.includes('info')
                );

                // The adapter should produce some info logs
                assert.ok(infoLines.length > 0, 'No info logs found from test-js.0 adapter');
            });
        });
    });

    describe('TypeScript Adapter', function() {
        describe('Adapter Configuration', function() {
            it('should have valid io-package.json with TypeScript metadata', function() {
                const ioPackagePath = path.join(TS_ADAPTER_DIR, 'io-package.json');
                assert.ok(fs.existsSync(ioPackagePath), 'io-package.json not found');

                const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
                assert.ok(ioPackage.common, 'io-package.json missing common section');
                assert.ok(ioPackage.common.name, 'io-package.json missing common.name');
                assert.strictEqual(ioPackage.common.name, 'test-ts', 'Adapter name should be test-ts');

                // Check TypeScript-specific keywords
                assert.ok(ioPackage.common.keywords.includes('typescript'), 'Should include typescript keyword');
            });

            it('should have TypeScript configuration files', function() {
                const tsconfigPath = path.join(TS_ADAPTER_DIR, 'tsconfig.json');
                assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json not found for TypeScript adapter');
            });
        });

        describe('dev-server setup', function() {
            it('should create .dev-server directory structure', async function() {
                this.timeout(SETUP_TIMEOUT);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommand('node', [devServerPath, 'setup'], {
                    cwd: TS_ADAPTER_DIR,
                    timeout: SETUP_TIMEOUT
                });

                console.log('dev-server setup output:', result.stdout);

                // Check that .dev-server directory was created
                const devServerDir = path.join(TS_ADAPTER_DIR, '.dev-server');
                assert.ok(fs.existsSync(devServerDir), '.dev-server directory not created');

                // Check that profile directory exists
                const defaultProfileDir = path.join(devServerDir, 'default');
                assert.ok(fs.existsSync(defaultProfileDir), 'default profile directory not created');

                // Check that package.json was created
                const packageJsonPath = path.join(defaultProfileDir, 'package.json');
                assert.ok(fs.existsSync(packageJsonPath), 'package.json not created in profile directory');

                // Check that iobroker.json was created  
                const iobrokerJsonPath = path.join(defaultProfileDir, 'iobroker.json');
                assert.ok(fs.existsSync(iobrokerJsonPath), 'iobroker.json not created in profile directory');

                // Check node_modules exists
                const nodeModulesPath = path.join(defaultProfileDir, 'node_modules');
                assert.ok(fs.existsSync(nodeModulesPath), 'node_modules directory not created');
            });
        });

        describe('dev-server run', function() {
            it('should start js-controller and admin.0 but not the adapter', async function() {
                this.timeout(RUN_TIMEOUT + 10000);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommandWithSignal('node', [devServerPath, 'run'], {
                    cwd: TS_ADAPTER_DIR,
                    timeout: RUN_TIMEOUT,
                    verbose: true,
                    finalMessage: /Watching files\.\.\./g
                });

                const output = result.stdout + result.stderr;

                console.log('dev-server run output:\n', output);
                // Should see host logs
                assert.ok(output.includes('host.'), 'No host logs found in output');

                // Should see admin.0 logs
                assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

                // Should NOT see test-ts.0 logs (adapter should not start in run mode)
                assert.ok(!output.includes('startInstance test-ts.0'), 'test-ts.0 adapter should not start in run mode');

                // Check for minimal error logs
                const errorLines = output.split('\n').filter(line =>
                    line.toLowerCase().includes('error') &&
                    !line.includes('npm ERR!') && // Ignore npm-related errors
                    !line.includes('audit fix') && // Ignore npm audit messages
                    !line.includes('loglevel error') && // Ignore npm loglevel settings
                    !line.includes('--loglevel error')
                );

                if (errorLines.length > 5) { // Allow some setup errors
                    console.warn(`Warning: Found ${errorLines.length} error lines in output`);
                    errorLines.slice(0, 3).forEach(line => console.warn('ERROR:', line));
                }
            });
        });

        describe('dev-server watch', function() {
            it('should start adapter and show info logs', async function() {
                this.timeout(WATCH_TIMEOUT + 10000);

                const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

                const result = await runCommandWithSignal('node', [devServerPath, 'watch'], {
                    cwd: TS_ADAPTER_DIR,
                    timeout: WATCH_TIMEOUT,
                    verbose: true,
                    finalMessage: /test-ts\\.0 \\([\\d]+\\) state test-ts\\.0\\.testVariable deleted/g
                });

                const output = result.stdout + result.stderr;

                // Should see test adapter logs
                assert.ok(!output.includes('startInstance test-ts.0'), 'test-ts.0 should not start in watch mode (no "startInstance test-ts.0" log expected)');
                assert.ok(output.includes('adapter disabled'), 'No test-ts.0 disabled info found in output');

                assert.ok(output.includes('starting. Version 0.0.1'), 'No test-ts.0 adapter starting in output');
                assert.ok(output.includes('state test-ts.0.testVariable deleted'), 'No test-ts.0 logic message subscription message in output');

                // Should see host logs
                assert.ok(output.includes('host.'), 'No host logs found in output');

                // Should see admin.0 logs
                assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

                // Look for info logs from the adapter
                const infoLines = output.split('\n').filter(line =>
                    line.includes('test-ts.0') && line.includes('info')
                );

                // The adapter should produce some info logs
                assert.ok(infoLines.length > 0, 'No info logs found from test-ts.0 adapter');
            });
        });
    });
});
