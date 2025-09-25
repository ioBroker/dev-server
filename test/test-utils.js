const { spawn } = require('node:child_process');
const path = require('node:path');

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
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                reject(new Error(`Command failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
            }
        });

        // Kill after timeout
        if (options.timeout) {
            setTimeout(() => {
                proc.kill('SIGKILL');
                reject(new Error(`Command timed out after ${options.timeout}ms`));
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
            ...options
        });

        let stdout = '';
        let stderr = '';
        let killed = false;
        let resolved = false;

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

        proc.on('close', (code) => {
            if (resolved) return;
            resolved = true;
            
            if (killed) {
                resolve({ stdout, stderr, code, killed: true });
            } else if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                reject(new Error(`Command failed with exit code ${code}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`));
            }
        });

        proc.on('error', (error) => {
            if (resolved) return;
            resolved = true;
            reject(error);
        });

        // Auto-kill after timeout
        const timeoutId = setTimeout(() => {
            if (resolved) return;
            
            console.log('Timeout reached, sending SIGINT...');
            killed = true;
            proc.kill('SIGINT');
            
            // Give it 3 seconds to gracefully exit, then force kill
            setTimeout(() => {
                if (!resolved && !proc.killed) {
                    console.log('Force killing with SIGKILL...');
                    proc.kill('SIGKILL');
                }
                
                // Final fallback - resolve after another 2 seconds
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve({ stdout, stderr, code: -1, killed: true, timeout: true });
                    }
                }, 2000);
            }, 3000);
        }, options.timeout || 30000);

        // Cleanup function
        const cleanup = () => {
            clearTimeout(timeoutId);
            if (!resolved && !killed && !proc.killed) {
                proc.kill('SIGINT');
            }
        };

        // Attach cleanup to the returned promise
        resolve.cleanup = cleanup;
    });
}

/**
 * Create test adapter using @iobroker/create-adapter
 */
async function createTestAdapter(configFile, targetDir) {
    const configPath = path.resolve(configFile);
    const configData = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'));
    const adapterName = configData.adapterName;
    const expectedDir = path.join(targetDir, `ioBroker.${adapterName}`);
    
    console.log(`Creating test adapter "${adapterName}" from config: ${configPath}`);
    
    // Skip if adapter already exists
    if (require('node:fs').existsSync(expectedDir)) {
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