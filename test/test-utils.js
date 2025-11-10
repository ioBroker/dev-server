const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert');

/**
 * Run a command and return promise
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: options.env || process.env,
            ...options
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            const str = data.toString();
            stdout += str;
            if (options.verbose) {
                console.log('STDOUT:', str.trim());
            }
        });

        proc.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            if (options.verbose) {
                console.log('STDERR:', str.trim());
            }
        });

        let timeoutId;
        let rejectedOrResolved = false;
        proc.on('close', (code) => {
            if (rejectedOrResolved) return;
            if (timeoutId) clearTimeout(timeoutId);
            console.log(`Process exited with code ${code}`);
            if (code === 0 || code === 255) {
                setTimeout(() => resolve({ stdout, stderr, code }), 5000);
            } else {
                setTimeout(() => reject(new Error(`Command failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`)), 5000);
            }
            rejectedOrResolved = true;
        });

        // Kill after timeout
        if (options.timeout) {
            timeoutId = setTimeout(() => {
                if (rejectedOrResolved) return;
                proc.kill('SIGKILL');
                reject(new Error(`Command timed out after ${options.timeout}ms`));
                rejectedOrResolved = true;
            }, options.timeout);
        }
    });
}

/**
 * Core function to run a command with timeout and signal handling
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Options including timeout, verbose, finalMessage, onStdout callback
 * @returns {Promise<{stdout: string, stderr: string, code: number, killed?: boolean}>}
 */
function runCommandWithTimeout(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const logPrefix = options.logPrefix || 'Running with signal handling';
        console.log(`${logPrefix}: ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: options.timeout || 30000,
            env: options.env || process.env,
            ...options
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let closed = false;
        let resolvedOrRejected = false;

        const shutDown = () => {
            if (resolvedOrRejected) return;

            console.log('Timeout reached, sending SIGINT...');
            killed = true;
            proc.kill('SIGINT');

            // Give it 3 seconds to gracefully exit, then force kill
            timeoutId = setTimeout(() => {
                console.log('Checking if process has exited after SIGINT...');
                if (!resolvedOrRejected && !closed) {
                    console.log('Force killing with SIGKILL...');
                    proc.kill('SIGKILL');
                }

                // Final fallback - resolve after another 2 seconds
                timeoutId = setTimeout(() => {
                    if (!resolvedOrRejected) {
                        resolvedOrRejected = true;
                        if (!closed) {
                            reject(new Error('Process did not exit after SIGKILL'));
                        }
                    }
                }, 5000);
            }, 10000);
        }

        proc.stdout.on('data', (data) => {
            const str = data.toString();
            stdout += str;
            if (options.verbose) {
                console.log('STDOUT:', str.trim());
            }

            // Call custom stdout handler if provided
            if (options.onStdout) {
                options.onStdout(str, shutDown);
            }

            // Default behavior: shutdown on final message
            if (!options.onStdout && options.finalMessage && str.match(options.finalMessage) && !closed && !resolvedOrRejected) {
                console.log('Final message detected, shutting down...');
                setTimeout(shutDown, 10000);
            }
        });

        proc.stderr.on('data', (data) => {
            const str = data.toString();
            stderr += str;
            if (options.verbose) {
                console.log('STDERR:', str.trim());
            }
        });

        proc.on('close', (code) => {
            closed = true;
            console.log(`Process exited with code ${code}`);
            clearTimeout(timeoutId);
            if (resolvedOrRejected) return;
            resolvedOrRejected = true;

            if (killed) {
                setTimeout( () => resolve({ stdout, stderr, code, killed: true }), 5000);
            } else if (code === 0 || code === 255) {
                setTimeout( () => resolve({ stdout, stderr, code }), 5000);
            } else {
                setTimeout( () => reject(new Error(`Command failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`)), 5000);
            }
        });

        proc.on('error', (error) => {
            console.log(`Process errored with error`, error);
            clearTimeout(timeoutId);
            if (resolvedOrRejected) return;
            resolvedOrRejected = true;
            reject(error);
        });

        // Auto-kill after timeout
        let timeoutId = setTimeout(shutDown, (options.timeout || 30000) + 2000);
    });
}

/**
 * Run a command with timeout and signal handling
 */
function runCommandWithSignal(command, args, options = {}) {
    return runCommandWithTimeout(command, args, options);
}

/**
 * Create test adapter using @iobroker/create-adapter
 */
async function createTestAdapter(configFile, targetDir) {
    const configPath = path.resolve(configFile);
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const adapterName = configData.adapterName;
    const expectedDir = path.join(targetDir, `ioBroker.${adapterName}`);

    console.log(`Creating test adapter "${adapterName}" from config: ${configPath}`);

    // Skip if adapter already exists
    if (fs.existsSync(expectedDir)) {
        fs.rmSync(path.join(expectedDir, ".dev-server"), { recursive: true, force: true });
        console.log(`Test adapter "${adapterName}" already exists, skipping creation`);
        return;
    }

    try {
        await runCommand('npx', [
            '@iobroker/create-adapter@latest',
            `--replay=${configPath}`,
            `--target=${targetDir}`,
            '--noInstall',  // Skip npm install to speed up creation
            '--nonInteractive' // Run in non-interactive mode to fill in missing config details
        ], {
            verbose:true,
            cwd: targetDir,
            timeout: 180000, // 3 minutes
            env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } // Handle certificate issues in test environment
        });
        console.log(`Test adapter "${adapterName}" created successfully`);
    } catch (error) {
        console.error(`Failed to create test adapter "${adapterName}":`, error.message);
        throw new Error(`Test adapter creation failed. This might be due to network issues accessing the @iobroker/create-adapter tool. Error: ${error.message}`);
    }
}

/**
 * Common setup logging for test adapters
 */
function logSetupInfo(testType, testDir, devServerRoot) {
    console.log(`Setting up ${testType} test adapter...`);
    console.log('Test directory:', testDir);
    console.log('Dev-server root:', devServerRoot);
    console.log('Node.js version:', process.version);
}

/**
 * Create and setup a test adapter with optional TypeScript patching
 */
async function setupTestAdapter(config) {
    const {
        adapterName,
        configFile,
        adapterDir,
        adaptersDir,
        needsTypeScriptPatching = false
    } = config;

    logSetupInfo(adapterName, path.dirname(adaptersDir), path.dirname(path.dirname(adaptersDir)));

    // Create adapter
    if (fs.existsSync(configFile)) {
        console.log(`Creating ${adapterName} test adapter...`);
        await createTestAdapter(configFile, adaptersDir);
    } else {
        throw new Error(`${adapterName} adapter config not found: ${configFile}`);
    }

    console.log(`${adapterName} test adapter created`);

    // Apply TypeScript patches if needed
    if (needsTypeScriptPatching) {
        await applyTypeScriptPatches(adapterDir);
    }

    // Install dependencies
    await installAdapterDependencies(adapterName, adapterDir);

    console.log(`${adapterName} test adapter prepared successfully`);
}

/**
 * Apply TypeScript compliance patches to main.ts file
 */
async function applyTypeScriptPatches(adapterDir) {
    const mainTsPath = path.join(adapterDir, 'src', 'main.ts');
    let mainTsContent = fs.readFileSync(mainTsPath, 'utf8');

    // Patch variable declarations for TypeScript compliance
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
}

/**
 * Install dependencies for a test adapter
 */
async function installAdapterDependencies(adapterName, adapterDir) {
    console.log(`Installing dependencies for ${adapterName} test adapter...`);
    try {
        await runCommand('npm', ['install', '--prefix', adapterDir], {
            cwd: adapterDir,
            timeout: 120000, // 2 minutes
            verbose: false,
        });
        console.log(`${adapterName} test adapter dependencies installed`);
    } catch (error) {
        console.warn(`Warning: Failed to install ${adapterName} adapter dependencies:`, error.message);
    }
}

/**
 * Common cleanup for test adapters
 */
function cleanupTestAdapter(adapterName, adapterDir) {
    console.log(`Cleaning up ${adapterName} test adapter...`);
    try {
        fs.rmSync(adapterDir, { recursive: true, force: true });
    } catch (error) {
        console.warn(`Error cleaning up ${adapterName} test adapter:`, error.message);
    }
}

/**
 * Common assertions for io-package.json validation
 */
function validateIoPackageJson(adapterDir, expectedName, shouldHaveTypescript = false) {
    const ioPackagePath = path.join(adapterDir, 'io-package.json');
    const assert = require('node:assert');

    assert.ok(fs.existsSync(ioPackagePath), 'io-package.json not found');

    const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
    assert.ok(ioPackage.common, 'io-package.json missing common section');
    assert.ok(ioPackage.common.name, 'io-package.json missing common.name');
    assert.strictEqual(ioPackage.common.name, expectedName, `Adapter name should be ${expectedName}`);

    if (shouldHaveTypescript) {
        assert.ok(ioPackage.common.keywords.includes('typescript'), 'Should include typescript keyword');
    }
}

/**
 * Common assertions for package.json validation
 */
function validatePackageJson(adapterDir) {
    const packagePath = path.join(adapterDir, 'package.json');
    const assert = require('node:assert');

    assert.ok(fs.existsSync(packagePath), 'package.json not found');

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    assert.ok(packageJson.name, 'package.json missing name');
    assert.ok(packageJson.version, 'package.json missing version');

    return packageJson;
}

/**
 * Validate TypeScript configuration files exist
 */
function validateTypeScriptConfig(adapterDir) {
    const tsconfigPath = path.join(adapterDir, 'tsconfig.json');
    const assert = require('node:assert');

    assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json not found for TypeScript adapter');
}

/**
 * Common dev-server setup test
 */
async function runDevServerSetupTest(devServerRoot, adapterDir, setupTimeout) {
    const assert = require('node:assert');
    const devServerPath = path.join(devServerRoot, 'dist', 'index.js');

    await runCommand('node', [devServerPath, 'setup'], {
        cwd: adapterDir,
        timeout: setupTimeout,
        verbose: true,
    });

    // Verify .dev-server directory was created
    const devServerDir = path.join(adapterDir, '.dev-server');
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

    return { devServerDir, defaultDir, nodeModulesDir };
}

/**
 * Common dev-server run test assertions
 */
function validateRunTestOutput(output, adapterPrefix) {
    const assert = require('node:assert');

    // Should see host logs
    assert.ok(output.includes('host.'), 'No host logs found in output');

    // Should see admin.0 logs
    assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

    // Should NOT see adapter logs (adapter should not start in run mode)
    assert.ok(!output.includes(`startInstance ${adapterPrefix}.0`), `${adapterPrefix}.0 adapter should not start in run mode`);

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
}

/**
 * Common dev-server watch test assertions
 */
function validateWatchTestOutput(output, adapterPrefix) {
    const assert = require('node:assert');

    // Should see test adapter logs
    assert.ok(
        !output.includes(`startInstance ${adapterPrefix}.0`),
        `${adapterPrefix}.0 should not start in watch mode (no "startInstance ${adapterPrefix}.0" log expected)`,
    );
    assert.ok(output.includes('adapter disabled'), `No ${adapterPrefix}.0 disabled info found in output`);

    assert.ok(output.includes('starting. Version 0.0.1'), `No ${adapterPrefix}.0 adapter starting in output`);
    assert.ok(
        output.includes(`state ${adapterPrefix}.0.testVariable deleted`),
        `No ${adapterPrefix}.0 logic message subscription message in output`,
    );

    // Should see host logs
    assert.ok(output.includes('host.'), 'No host logs found in output');

    // Should see admin.0 logs
    assert.ok(output.includes('admin.0'), 'No admin.0 logs found in output');

    // Look for info logs from the adapter
    const infoLines = output.split('\n').filter(line => line.includes(`${adapterPrefix}.0`) && line.includes('info'));

    // The adapter should produce some info logs
    assert.ok(infoLines.length > 0, `No info logs found from ${adapterPrefix}.0 adapter`);
}

/**
 * Run watch command with file change trigger to test adapter restart
 */
function runCommandWithFileChange(command, args, options = {}) {
    let fileChanged = false;
    let restartDetected = false;

    const onStdout = (str, shutDown) => {
        // Trigger file change after initial startup
        if (!fileChanged && options.initialMessage && str.match(options.initialMessage)) {
            console.log('Initial message detected, triggering file change...');
            fileChanged = true;

            // Wait a bit then trigger file change
            setTimeout(() => {
                if (options.fileToChange) {
                    console.log(`Touching file: ${options.fileToChange}`);
                    try {
                        // Touch the file to trigger nodemon restart
                        const now = new Date();
                        fs.utimesSync(options.fileToChange, now, now);
                    } catch (error) {
                        console.error('Error touching file:', error);
                    }
                }
            }, 5000);
        }

        // Detect restart and wait for it to complete
        if (fileChanged && !restartDetected && str.match(/restarting|restart/i)) {
            console.log('Restart detected...');
            restartDetected = true;
        }

        // After restart, wait for final message
        if (restartDetected && options.finalMessage && str.match(options.finalMessage)) {
            console.log('Final message after restart detected, shutting down...');
            setTimeout(shutDown, 10000);
        }
    };

    return runCommandWithTimeout(command, args, {
        ...options,
        logPrefix: 'Running with file change trigger',
        onStdout
    });
}

/**
 * Validate that adapter restart occurred in watch mode
 */
function validateWatchRestartOutput(output, adapterPrefix) {
    // Should see nodemon restart messages
    assert.ok(
        output.includes('restarting'),
        'No nodemon restart message found in output'
    );

    // Should see adapter starting exactly twice (initial + after restart)
    const startingMatches = output.match(/starting\. Version 0\.0\.1/g);
    assert.ok(
        startingMatches && startingMatches.length === 2,
        `Adapter should start exactly twice (initial + restart), but found ${startingMatches ? startingMatches.length : 0} instances`
    );

    // Should see the test variable deletion message exactly twice
    const testVarMatches = output.match(new RegExp(`state ${adapterPrefix}\\.0\\.testVariable deleted`, 'g'));
    assert.ok(
        testVarMatches && testVarMatches.length === 2,
        `Should see testVariable deletion exactly twice (initial + restart), but found ${testVarMatches ? testVarMatches.length : 0} instances`
    );
}

module.exports = {
    runCommand,
    runCommandWithSignal,
    runCommandWithFileChange,
    createTestAdapter,
    logSetupInfo,
    setupTestAdapter,
    applyTypeScriptPatches,
    installAdapterDependencies,
    cleanupTestAdapter,
    validateIoPackageJson,
    validatePackageJson,
    validateTypeScriptConfig,
    runDevServerSetupTest,
    validateRunTestOutput,
    validateWatchTestOutput,
    validateWatchRestartOutput
};
