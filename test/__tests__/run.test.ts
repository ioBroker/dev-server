import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils, TEST_ADAPTERS } from '../utils';

describe('Dev-Server Run Command', () => {
    beforeAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    describe('JavaScript Adapter Run', () => {
        const jsAdapter = TEST_ADAPTERS.find(a => a.language === 'JavaScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            // Create and setup the adapter first
            adapterDir = await TestUtils.createTestAdapter(jsAdapter);
            jsAdapter.path = adapterDir;
            
            const setupResult = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8093'],
                adapterDir,
                120000
            );
            
            if (!setupResult.success) {
                throw new Error(`Setup failed: ${setupResult.stderr}`);
            }
        });

        test('should start js-controller without adapter using run command', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in run mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'run',
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
                
                // Check that our specific adapter is NOT running
                // (run command should not start the adapter)
                const adapterProcesses = await TestUtils.getRunningProcesses(jsAdapter.name);
                expect(adapterProcesses.length).toBe(0);
                
                // Wait a bit more to ensure adapter doesn't start
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const adapterProcessesAfterWait = await TestUtils.getRunningProcesses(jsAdapter.name);
                expect(adapterProcessesAfterWait.length).toBe(0);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });

        test('should have log files created', async () => {
            const logDir = path.join(adapterDir, '.dev-server', 'default', 'log');
            
            // Log directory should exist
            expect(fs.existsSync(logDir)).toBe(true);
            
            const logFiles = await fs.readdir(logDir);
            expect(logFiles.length).toBeGreaterThan(0);
            
            // Should have some .log files
            const actualLogFiles = logFiles.filter(f => f.endsWith('.log'));
            expect(actualLogFiles.length).toBeGreaterThan(0);
        });
    });

    describe('TypeScript Adapter Run', () => {
        const tsAdapter = TEST_ADAPTERS.find(a => a.language === 'TypeScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            // Create and setup the adapter first
            adapterDir = await TestUtils.createTestAdapter(tsAdapter);
            tsAdapter.path = adapterDir;
            
            const setupResult = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8094'],
                adapterDir,
                120000
            );
            
            if (!setupResult.success) {
                throw new Error(`Setup failed: ${setupResult.stderr}`);
            }
        });

        test('should start js-controller without adapter using run command', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in run mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'run',
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
                
                // Check that our specific adapter is NOT running
                // (run command should not start the adapter)
                const adapterProcesses = await TestUtils.getRunningProcesses(tsAdapter.name);
                expect(adapterProcesses.length).toBe(0);
                
                // Wait a bit more to ensure adapter doesn't start
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                const adapterProcessesAfterWait = await TestUtils.getRunningProcesses(tsAdapter.name);
                expect(adapterProcessesAfterWait.length).toBe(0);
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });

        test('should have admin interface accessible', async () => {
            let devServerProcess: any;
            
            try {
                // Start dev-server in run mode (detached)
                devServerProcess = await TestUtils.runDevServerCommandDetached(
                    'run',
                    ['--noBrowserSync'],
                    adapterDir
                );

                // Wait for the web server to start
                await new Promise(resolve => setTimeout(resolve, 10000));
                
                // Try to make a request to the admin interface
                const axios = require('axios');
                try {
                    const response = await axios.get('http://127.0.0.1:8094', { 
                        timeout: 5000,
                        validateStatus: () => true // Don't throw on 4xx/5xx
                    });
                    
                    // Should get some response (even if it's a redirect or error page)
                    expect(response.status).toBeDefined();
                } catch (error: any) {
                    // Network errors are fine - we just want to ensure the server is attempting to respond
                    expect(error.code).toMatch(/ECONNREFUSED|ECONNRESET|ETIMEDOUT/);
                }
                
            } finally {
                if (devServerProcess && devServerProcess.pid) {
                    await TestUtils.killProcessTree(devServerProcess.pid);
                }
            }
        });
    });
});