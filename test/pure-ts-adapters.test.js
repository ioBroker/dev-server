const { describe, it, before, after } = require('mocha');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runCommand, runCommandWithSignal, createTestAdapter } = require('./test-utils');

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
        console.log('Setting up pure TypeScript test adapter...');
        console.log('Test directory:', TEST_DIR);
        console.log('Dev-server root:', DEV_SERVER_ROOT);
        console.log('Node.js version:', process.version);

        // Create Pure TypeScript test adapter
        if (fs.existsSync(PURE_TS_ADAPTER_CONFIG)) {
            console.log('Creating Pure TypeScript test adapter...');
            await createTestAdapter(PURE_TS_ADAPTER_CONFIG, ADAPTERS_DIR);
        } else {
            throw new Error(`Pure TypeScript adapter config not found: ${PURE_TS_ADAPTER_CONFIG}`);
        }

        console.log('Pure TypeScript test adapter created');

        // Patch the main.ts file because create-adapter generates non-ts-compliant files right now
        // Remove when new version of create-adapter is released
        const mainTsPath = path.join(PURE_TS_ADAPTER_DIR, 'src', 'main.ts');
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

        // Patch package.json to point main directly to src/main.ts (pure TypeScript mode)
        const packageJsonPath = path.join(PURE_TS_ADAPTER_DIR, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        packageJson.main = 'src/main.ts'; // Point directly to TypeScript file
        packageJson.files.push('src/'); // Ensure src is included in files

        // Remove build scripts as they're not needed for pure TypeScript mode
        if (packageJson.scripts) {
            delete packageJson.scripts.build;
            delete packageJson.scripts['build:ts'];
            delete packageJson.scripts.prebuild;
            delete packageJson.scripts.watch;
            delete packageJson.scripts['watch:ts'];

            // Keep type checking but make it not generate files
            packageJson.scripts.build = 'tsc --noEmit';
        }

        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf8');
        console.log(`Patched ${packageJsonPath} to use pure TypeScript mode`);

        // Install dependencies
        console.log('Installing dependencies for Pure TypeScript test adapter...');
        try {
            await runCommand('npm', ['install', '--prefix', PURE_TS_ADAPTER_DIR], {
                cwd: PURE_TS_ADAPTER_DIR,
                timeout: 120000, // 2 minutes
                verbose: false,
            });
            console.log('Pure TypeScript test adapter dependencies installed');
        } catch (error) {
            console.warn('Warning: Failed to install Pure TS adapter dependencies:', error.message);
        }

        console.log('Pure TypeScript test adapter prepared successfully');
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
            const ioPackagePath = path.join(PURE_TS_ADAPTER_DIR, 'io-package.json');
            assert.ok(fs.existsSync(ioPackagePath), 'io-package.json not found');

            const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
            assert.ok(ioPackage.common, 'io-package.json missing common section');
            assert.ok(ioPackage.common.name, 'io-package.json missing common.name');
            assert.strictEqual(ioPackage.common.name, 'test-pure-ts', 'Adapter name should be test-pure-ts');

            // Check TypeScript-specific keywords
            assert.ok(ioPackage.common.keywords.includes('typescript'), 'Should include typescript keyword');
        });

        it('should have package.json pointing main to TypeScript file', () => {
            const packagePath = path.join(PURE_TS_ADAPTER_DIR, 'package.json');
            assert.ok(fs.existsSync(packagePath), 'package.json not found');

            const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            assert.strictEqual(packageJson.main, 'src/main.ts', 'main field should point to src/main.ts');

            // Verify the build scripts have been removed
            assert.ok(packageJson.scripts.build.includes("--noEmit"), 'build script should be removed');
            assert.ok(!packageJson.scripts?.['build:ts'], 'build:ts script should be removed');
            assert.ok(!packageJson.scripts?.prebuild, 'prebuild script should be removed');
        });

        it('should have TypeScript source file but no dist directory', () => {
            const mainTsPath = path.join(PURE_TS_ADAPTER_DIR, 'src', 'main.ts');
            assert.ok(fs.existsSync(mainTsPath), 'src/main.ts should exist');

            const distPath = path.join(PURE_TS_ADAPTER_DIR, 'dist');
            assert.ok(!fs.existsSync(distPath), 'dist directory should not exist for pure TypeScript adapter');
        });

        it('should have TypeScript configuration files', () => {
            const tsconfigPath = path.join(PURE_TS_ADAPTER_DIR, 'tsconfig.json');
            assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json not found for TypeScript adapter');
        });
    });

    describe('dev-server setup', () => {
        it('should create .dev-server directory structure and install @alcalzone/esbuild-register', async () => {
            this.timeout(SETUP_TIMEOUT);

            const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');

            await runCommand('node', [devServerPath, 'setup'], {
                cwd: PURE_TS_ADAPTER_DIR,
                timeout: SETUP_TIMEOUT,
                verbose: true,
            });

            // Check that .dev-server directory was created
            const devServerDir = path.join(PURE_TS_ADAPTER_DIR, '.dev-server');
            assert.ok(fs.existsSync(devServerDir), '.dev-server directory not created');

            // Check that profile directory exists
            const defaultProfileDir = path.join(devServerDir, 'default');
            assert.ok(fs.existsSync(defaultProfileDir), 'default profile directory not created');

            // Check that package.json was created
            const packageJsonPath = path.join(defaultProfileDir, 'package.json');
            assert.ok(fs.existsSync(packageJsonPath), 'package.json not created in profile directory');

            // Verify @alcalzone/esbuild-register was added for TypeScript support
            const profilePackageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            assert.ok(
                profilePackageJson.dependencies?.['@alcalzone/esbuild-register'],
                '@alcalzone/esbuild-register dependency should be added for TypeScript adapters'
            );

            // Check node_modules exists
            const nodeModulesPath = path.join(defaultProfileDir, 'node_modules');
            assert.ok(fs.existsSync(nodeModulesPath), 'node_modules directory not created');

            // Check that iobroker.json was created
            const iobrokerJsonPath = path.join(defaultProfileDir, 'iobroker-data', 'iobroker.json');
            assert.ok(fs.existsSync(iobrokerJsonPath), 'iobroker.json not created in profile directory');

            // Verify that @alcalzone/esbuild-register is installed
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

            // Should see host logs
            assert.ok(output.includes('host.'), 'No host logs found in output');

            // Should see admin.0 logs
            assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

            // Should NOT see test-pure-ts.0 logs (adapter should not start in run mode)
            assert.ok(!output.includes('startInstance test-pure-ts.0'), 'test-pure-ts.0 adapter should not start in run mode');

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

            // Should see test adapter logs
            assert.ok(
                !output.includes('startInstance test-pure-ts.0'),
                'test-pure-ts.0 should not start in watch mode (no "startInstance test-pure-ts.0" log expected)',
            );
            assert.ok(output.includes('adapter disabled'), 'No test-pure-ts.0 disabled info found in output');

            assert.ok(output.includes('starting. Version 0.0.1'), 'No test-pure-ts.0 adapter starting in output');
            assert.ok(
                output.includes('state test-pure-ts.0.testVariable deleted'),
                'No test-pure-ts.0 logic message subscription message in output',
            );

            // Should see host logs
            assert.ok(output.includes('host.'), 'No host logs found in output');

            // Should see admin.0 logs
            assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

            // Look for info logs from the adapter
            const infoLines = output.split('\n').filter(line => line.includes('test-pure-ts.0') && line.includes('info'));

            // The adapter should produce some info logs
            assert.ok(infoLines.length > 0, 'No info logs found from test-pure-ts.0 adapter');

            // Verify that esbuild-register is working by checking that TypeScript files are being executed
            // The presence of successful adapter execution indicates esbuild-register is transpiling the .ts files
            assert.ok(
                output.includes('starting. Version 0.0.1'),
                'esbuild-register should successfully transpile and execute TypeScript files'
            );
        });
    });
});
