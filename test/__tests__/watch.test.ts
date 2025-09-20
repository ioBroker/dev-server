import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils, TEST_ADAPTERS } from '../utils';

describe('Dev-Server Watch Command', () => {
    beforeAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    describe('JavaScript Adapter Watch', () => {
        const jsAdapter = TEST_ADAPTERS.find(a => a.language === 'JavaScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            // Create and setup the adapter first
            adapterDir = await TestUtils.createTestAdapter(jsAdapter);
            jsAdapter.path = adapterDir;
            
            const setupResult = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8095'],
                adapterDir,
                120000
            );
            
            if (!setupResult.success) {
                throw new Error(`Setup failed: ${setupResult.stderr}`);
            }
        });

        test('should start js-controller AND adapter using watch command', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in watch mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'watch',
                    ['--noBrowserSync'], // Disable browser sync for testing
                    adapterDir
                );

                // Wait for js-controller to start
                const logDir = path.join(adapterDir, '.dev-server', 'default', 'log');
                
                // Wait for controller start message in logs
                const controllerStarted = await TestUtils.waitForLogMessage(
                    logDir,
                    /host\..*\sstarted/i,
                    60000 // 1 minute timeout
                );
                
                expect(controllerStarted).toBe(true);
                
                // Check that js-controller process is running
                const processes = await TestUtils.getRunningProcesses('controller.js');
                expect(processes.length).toBeGreaterThan(0);
                
                // Wait for adapter to start (this is the key difference from run command)
                const adapterStarted = await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${jsAdapter.name}.*started`, 'i'),
                    60000 // 1 minute timeout
                );
                
                expect(adapterStarted).toBe(true);
                
                // Check that our adapter process is running
                const adapterProcesses = await TestUtils.getRunningProcesses(jsAdapter.name);
                expect(adapterProcesses.length).toBeGreaterThan(0);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });

        test('should restart adapter when main file changes', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in watch mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'watch',
                    ['--noBrowserSync'],
                    adapterDir
                );

                // Wait for initial startup
                const logDir = path.join(adapterDir, '.dev-server', 'default', 'log');
                await TestUtils.waitForLogMessage(logDir, /host\..*\sstarted/i, 60000);
                
                // Wait for adapter to start initially
                await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${jsAdapter.name}.*started`, 'i'),
                    60000
                );
                
                // Modify the main.js file to trigger a restart
                const mainFile = path.join(adapterDir, 'main.js');
                let mainContent = await fs.readFile(mainFile, 'utf8');
                
                // Add a comment to trigger change detection
                mainContent += '\n// Test change for watch mode\n';
                await fs.writeFile(mainFile, mainContent);
                
                // Wait for file sync and adapter restart
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Check that adapter restarted (look for restart message or new start message)
                const adapterRestarted = await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${jsAdapter.name}.*(restart|started)`, 'i'),
                    30000 // 30 seconds timeout for restart
                );
                
                expect(adapterRestarted).toBe(true);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });
    });

    describe('TypeScript Adapter Watch', () => {
        const tsAdapter = TEST_ADAPTERS.find(a => a.language === 'TypeScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            // Create and setup the adapter first
            adapterDir = await TestUtils.createTestAdapter(tsAdapter);
            tsAdapter.path = adapterDir;
            
            const setupResult = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8096'],
                adapterDir,
                120000
            );
            
            if (!setupResult.success) {
                throw new Error(`Setup failed: ${setupResult.stderr}`);
            }
        });

        test('should start js-controller AND adapter using watch command', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in watch mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'watch',
                    ['--noBrowserSync'], // Disable browser sync for testing
                    adapterDir
                );

                // Wait for js-controller to start
                const logDir = path.join(adapterDir, '.dev-server', 'default', 'log');
                
                // Wait for controller start message in logs
                const controllerStarted = await TestUtils.waitForLogMessage(
                    logDir,
                    /host\..*\sstarted/i,
                    60000 // 1 minute timeout
                );
                
                expect(controllerStarted).toBe(true);
                
                // Check that js-controller process is running
                const processes = await TestUtils.getRunningProcesses('controller.js');
                expect(processes.length).toBeGreaterThan(0);
                
                // Wait for TypeScript compilation to complete
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Wait for adapter to start (this is the key difference from run command)
                const adapterStarted = await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${tsAdapter.name}.*started`, 'i'),
                    60000 // 1 minute timeout
                );
                
                expect(adapterStarted).toBe(true);
                
                // Check that our adapter process is running
                const adapterProcesses = await TestUtils.getRunningProcesses(tsAdapter.name);
                expect(adapterProcesses.length).toBeGreaterThan(0);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });

        test('should restart adapter when TypeScript source changes', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in watch mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'watch',
                    ['--noBrowserSync'],
                    adapterDir
                );

                // Wait for initial startup
                const logDir = path.join(adapterDir, '.dev-server', 'default', 'log');
                await TestUtils.waitForLogMessage(logDir, /host\..*\sstarted/i, 60000);
                
                // Wait for adapter to start initially
                await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${tsAdapter.name}.*started`, 'i'),
                    60000
                );
                
                // Modify the main.ts file to trigger a restart
                const mainFile = path.join(adapterDir, 'src', 'main.ts');
                let mainContent = await fs.readFile(mainFile, 'utf8');
                
                // Add a comment to trigger change detection
                mainContent += '\n// Test change for watch mode\n';
                await fs.writeFile(mainFile, mainContent);
                
                // Wait longer for TypeScript compilation and file sync
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Check that adapter restarted (look for restart message or new start message)
                const adapterRestarted = await TestUtils.waitForLogMessage(
                    logDir,
                    new RegExp(`${tsAdapter.name}.*(restart|started)`, 'i'),
                    45000 // 45 seconds timeout for TS compile + restart
                );
                
                expect(adapterRestarted).toBe(true);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });

        test('should have TypeScript watch compilation running', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in watch mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'watch',
                    ['--noBrowserSync'],
                    adapterDir
                );

                // Wait for startup
                await new Promise(resolve => setTimeout(resolve, 15000));
                
                // Check that tsc watch process is running
                const tscProcesses = await TestUtils.getRunningProcesses('tsc');
                expect(tscProcesses.length).toBeGreaterThan(0);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });
    });
});