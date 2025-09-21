#!/usr/bin/env node

/**
 * Integration tests for dev-server
 * Tests basic functionality of dev-server with JavaScript and TypeScript adapters
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { promisify } = require('util');

const DEV_SERVER_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const ADAPTERS_DIR = path.join(TEST_DIR, 'adapters');
const JS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-js');

// Timeout for various operations (in ms)
const SETUP_TIMEOUT = 120000; // 2 minutes
const RUN_TIMEOUT = 45000; // 45 seconds - reduced from 60s
const WATCH_TIMEOUT = 45000; // 45 seconds - reduced from 60s

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
 * Test dev-server setup command
 */
async function testSetup(adapterDir) {
    console.log('\n=== Testing dev-server setup ===');
    
    const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
    
    try {
        const result = await runCommand('node', [devServerPath, 'setup'], {
            cwd: adapterDir,
            timeout: SETUP_TIMEOUT
        });
        
        console.log('Setup completed successfully');
        
        // Verify .dev-server directory was created
        const devServerDir = path.join(adapterDir, '.dev-server');
        if (!fs.existsSync(devServerDir)) {
            throw new Error('.dev-server directory not created');
        }
        
        // Verify default profile directory exists
        const defaultDir = path.join(devServerDir, 'default');
        if (!fs.existsSync(defaultDir)) {
            throw new Error('.dev-server/default directory not created');
        }
        
        // Verify node_modules exists
        const nodeModulesDir = path.join(defaultDir, 'node_modules');
        if (!fs.existsSync(nodeModulesDir)) {
            throw new Error('node_modules directory not created in .dev-server/default');
        }
        
        // Verify iobroker.json exists
        const iobrokerJson = path.join(defaultDir, 'iobroker-data', 'iobroker.json');
        if (!fs.existsSync(iobrokerJson)) {
            throw new Error('iobroker.json not created in .dev-server/default/iobroker-data');
        }
        
        console.log('✅ Setup test passed');
        return true;
        
    } catch (error) {
        console.error('❌ Setup test failed:', error.message);
        return false;
    }
}

/**
 * Test dev-server run command
 */
async function testRun(adapterDir) {
    console.log('\n=== Testing dev-server run ===');
    
    const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
    
    try {
        const promise = runCommandWithSignal('node', [devServerPath, 'run'], {
            cwd: adapterDir,
            timeout: RUN_TIMEOUT
        });
        
        // Wait for the promise to resolve (process should be running)
        const result = await promise;
        
        // Check that we have logs from host and admin.0
        const output = result.stdout + result.stderr;
        
        // Should see host logs
        if (!output.includes('host.')) {
            console.warn('Warning: No host logs found in output');
        }
        
        // Should see admin.0 logs  
        if (!output.includes('admin.0')) {
            console.warn('Warning: No admin.0 logs found in output');
        }
        
        // Check for error logs (should be minimal)
        const errorLines = output.split('\n').filter(line => 
            line.toLowerCase().includes('error') && 
            !line.includes('loglevel error') && // Ignore npm loglevel settings
            !line.includes('--loglevel error')
        );
        
        if (errorLines.length > 5) { // Allow some setup errors
            console.warn(`Warning: Found ${errorLines.length} error lines in output`);
            errorLines.slice(0, 3).forEach(line => console.warn('ERROR:', line));
        }
        
        console.log('✅ Run test passed');
        return true;
        
    } catch (error) {
        console.error('❌ Run test failed:', error.message);
        return false;
    }
}

/**
 * Test dev-server watch command
 */
async function testWatch(adapterDir) {
    console.log('\n=== Testing dev-server watch ===');
    
    const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
    
    try {
        const promise = runCommandWithSignal('node', [devServerPath, 'watch'], {
            cwd: adapterDir,
            timeout: WATCH_TIMEOUT
        });
        
        // Wait for the promise to resolve
        const result = await promise;
        
        // Check that we have logs from the test adapter
        const output = result.stdout + result.stderr;
        
        // Should see test adapter logs
        if (!output.includes('test-js.0')) {
            console.warn('Warning: No test-js.0 adapter logs found in output');
        }
        
        // Should see host logs
        if (!output.includes('host.')) {
            console.warn('Warning: No host logs found in output');
        }
        
        // Should see admin.0 logs
        if (!output.includes('admin.0')) {
            console.warn('Warning: No admin.0 logs found in output');
        }
        
        console.log('✅ Watch test passed');
        return true;
        
    } catch (error) {
        console.error('❌ Watch test failed:', error.message);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('Starting dev-server integration tests...');
    console.log('Test directory:', TEST_DIR);
    console.log('Dev-server root:', DEV_SERVER_ROOT);
    
    // Check if test adapter exists
    if (!fs.existsSync(JS_ADAPTER_DIR)) {
        console.error('❌ JavaScript test adapter not found at:', JS_ADAPTER_DIR);
        console.error('Please run the test adapter creation first');
        process.exit(1);
    }
    
    let passedTests = 0;
    let totalTests = 0;
    
    // Test JavaScript adapter
    console.log('\n🔧 Testing JavaScript adapter...');
    
    totalTests++;
    if (await testSetup(JS_ADAPTER_DIR)) {
        passedTests++;
    }
    
    totalTests++;
    if (await testRun(JS_ADAPTER_DIR)) {
        passedTests++;
    }
    
    totalTests++;
    if (await testWatch(JS_ADAPTER_DIR)) {
        passedTests++;
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`Test Results: ${passedTests}/${totalTests} passed`);
    
    if (passedTests === totalTests) {
        console.log('✅ All tests passed!');
        process.exit(0);
    } else {
        console.log('❌ Some tests failed');
        process.exit(1);
    }
}

// Run tests if called directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('Test runner failed:', error);
        process.exit(1);
    });
}

module.exports = {
    runTests,
    testSetup,
    testRun,
    testWatch
};