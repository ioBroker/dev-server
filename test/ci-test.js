#!/usr/bin/env node

/**
 * Simplified CI tests for dev-server
 * Tests only essential functionality to avoid CI timeouts
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEV_SERVER_ROOT = path.resolve(__dirname, '..');
const TEST_DIR = __dirname;
const ADAPTERS_DIR = path.join(TEST_DIR, 'adapters');
const JS_ADAPTER_DIR = path.join(ADAPTERS_DIR, 'ioBroker.test-js');

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
 * Test dev-server setup command only
 */
async function testSetup(adapterDir) {
    console.log('\n=== Testing dev-server setup ===');
    
    const devServerPath = path.join(DEV_SERVER_ROOT, 'dist', 'index.js');
    
    try {
        const result = await runCommand('node', [devServerPath, 'setup'], {
            cwd: adapterDir,
            timeout: 120000 // 2 minutes
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
        
        console.log('✅ Setup test passed - all required files and directories created');
        return true;
        
    } catch (error) {
        console.error('❌ Setup test failed:', error.message);
        return false;
    }
}

/**
 * Test that adapter configuration is valid
 */
async function testAdapterConfig(adapterDir) {
    console.log('\n=== Testing adapter configuration ===');
    
    try {
        // Check io-package.json exists and is valid
        const ioPackagePath = path.join(adapterDir, 'io-package.json');
        if (!fs.existsSync(ioPackagePath)) {
            throw new Error('io-package.json not found');
        }
        
        const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, 'utf8'));
        if (!ioPackage.common || !ioPackage.common.name) {
            throw new Error('Invalid io-package.json - missing common.name');
        }
        
        // Check package.json exists and is valid
        const packagePath = path.join(adapterDir, 'package.json');
        if (!fs.existsSync(packagePath)) {
            throw new Error('package.json not found');
        }
        
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (!packageJson.name || !packageJson.version) {
            throw new Error('Invalid package.json - missing name or version');
        }
        
        // Check main adapter file exists
        const mainFile = path.join(adapterDir, 'main.js');
        if (!fs.existsSync(mainFile)) {
            throw new Error('main.js adapter file not found');
        }
        
        console.log(`✅ Adapter configuration test passed - ${ioPackage.common.name} v${packageJson.version}`);
        return true;
        
    } catch (error) {
        console.error('❌ Adapter configuration test failed:', error.message);
        return false;
    }
}

/**
 * Main test runner
 */
async function runTests() {
    console.log('Starting dev-server CI tests...');
    console.log('Test directory:', TEST_DIR);
    console.log('Dev-server root:', DEV_SERVER_ROOT);
    console.log('Node.js version:', process.version);
    
    // Check if test adapter exists
    if (!fs.existsSync(JS_ADAPTER_DIR)) {
        console.error('❌ JavaScript test adapter not found at:', JS_ADAPTER_DIR);
        console.error('Please run adapter creation first');
        process.exit(1);
    }
    
    let passedTests = 0;
    let totalTests = 0;
    
    // Test JavaScript adapter
    console.log('\n🔧 Testing JavaScript adapter...');
    
    totalTests++;
    if (await testAdapterConfig(JS_ADAPTER_DIR)) {
        passedTests++;
    }
    
    totalTests++;
    if (await testSetup(JS_ADAPTER_DIR)) {
        passedTests++;
    }
    
    // Summary
    console.log('\n' + '='.repeat(50));
    console.log(`CI Test Results: ${passedTests}/${totalTests} passed`);
    
    if (passedTests === totalTests) {
        console.log('✅ All CI tests passed!');
        console.log('\nThis validates that:');
        console.log('- Test adapters are properly configured');
        console.log('- dev-server setup command works correctly'); 
        console.log('- All required files and directories are created');
        process.exit(0);
    } else {
        console.log('❌ Some CI tests failed');
        process.exit(1);
    }
}

// Run tests if called directly
if (require.main === module) {
    runTests().catch(error => {
        console.error('CI test runner failed:', error);
        process.exit(1);
    });
}

module.exports = {
    runTests,
    testSetup,
    testAdapterConfig
};