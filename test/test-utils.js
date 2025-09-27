const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

/**
 * Run a command and return promise
 */
function runCommand(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`Running: ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
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
            if (code === 0 || code === 255) {
                setTimeout(() => resolve({ stdout, stderr, code }), 5000);
            } else {
                setTimeout(reject(new Error(`Command failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`)), 5000);
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
 * Run a command with timeout and signal handling
 */
function runCommandWithSignal(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`Running with signal handling: ${command} ${args.join(' ')}`);
        const proc = spawn(command, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: options.timeout || 30000,
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
            if (options.finalMessage && str.match(options.finalMessage) && !closed && !resolvedOrRejected) {
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
            '--noInstall'  // Skip npm install to speed up creation
        ], {
            cwd: targetDir,
            timeout: 180000 // 3 minutes
        });
        console.log(`Test adapter "${adapterName}" created successfully`);
    } catch (error) {
        console.error(`Failed to create test adapter "${adapterName}":`, error.message);
        throw new Error(`Test adapter creation failed. This might be due to network issues accessing the @iobroker/create-adapter tool. Error: ${error.message}`);
    }
}

module.exports = {
    runCommand,
    runCommandWithSignal,
    createTestAdapter
};
