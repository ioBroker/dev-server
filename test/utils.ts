import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs-extra';
import { promisify } from 'util';
import psTree from 'ps-tree';

const exec = promisify(cp.exec);
const psTreeAsync = promisify(psTree);

export interface TestAdapter {
    name: string;
    path: string;
    language: 'JavaScript' | 'TypeScript';
    configFile: string;
}

export interface TestResult {
    success: boolean;
    stdout: string;
    stderr: string;
    processes?: any[];
    logFiles?: string[];
}

export class TestUtils {
    static readonly TEST_DIR = path.join(__dirname, 'temp');
    static readonly DEV_SERVER_CLI = path.join(__dirname, '../dist/index.js');
    
    static async createTestAdapter(adapter: TestAdapter): Promise<string> {
        const adapterDir = path.join(this.TEST_DIR, adapter.name);
        await fs.ensureDir(adapterDir);
        
        const configPath = path.join(__dirname, 'configs', adapter.configFile);
        const config = await fs.readJson(configPath);
        
        // Update the config with the actual adapter name
        config.adapterName = adapter.name;
        
        // Create the adapter using create-adapter CLI
        const createAdapterPath = path.join(__dirname, '../node_modules/@iobroker/create-adapter/build/index.js');
        
        try {
            await exec(`node "${createAdapterPath}" --config '${JSON.stringify(config)}'`, {
                cwd: adapterDir,
                timeout: 120000 // 2 minutes
            });
            
            // Save the config file for future optimizations
            await fs.writeJson(path.join(adapterDir, '.create-adapter.json'), config, { spaces: 2 });
            
            return adapterDir;
        } catch (error) {
            throw new Error(`Failed to create adapter ${adapter.name}: ${error}`);
        }
    }
    
    static async runDevServerCommand(
        command: string, 
        args: string[], 
        cwd: string,
        timeout: number = 60000
    ): Promise<TestResult> {
        const fullCommand = `node "${this.DEV_SERVER_CLI}" ${command} ${args.join(' ')}`;
        
        try {
            const { stdout, stderr } = await exec(fullCommand, { 
                cwd,
                timeout,
                env: { ...process.env, NODE_ENV: 'test' }
            });
            
            return {
                success: true,
                stdout,
                stderr
            };
        } catch (error: any) {
            return {
                success: false,
                stdout: error.stdout || '',
                stderr: error.stderr || error.message
            };
        }
    }
    
    static async runDevServerCommandDetached(
        command: string,
        args: string[],
        cwd: string
    ): Promise<cp.ChildProcess> {
        const fullArgs = [this.DEV_SERVER_CLI, command, ...args];
        
        return cp.spawn('node', fullArgs, {
            cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'test' }
        });
    }
    
    static async getRunningProcesses(pattern?: string): Promise<any[]> {
        try {
            const allProcesses = await psTreeAsync(process.pid);
            
            if (!pattern) {
                return [...allProcesses]; // Create mutable copy
            }
            
            return allProcesses.filter((proc: any) => 
                (proc.COMMAND && proc.COMMAND.includes(pattern)) || 
                (proc.COMM && proc.COMM.includes(pattern))
            );
        } catch (error) {
            console.warn('Failed to get process list:', error);
            return [];
        }
    }
    
    static async waitForLogMessage(
        logDir: string, 
        pattern: string | RegExp, 
        timeout: number = 30000
    ): Promise<boolean> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            try {
                const logFiles = await fs.readdir(logDir);
                
                for (const logFile of logFiles) {
                    if (logFile.endsWith('.log')) {
                        const logPath = path.join(logDir, logFile);
                        const logContent = await fs.readFile(logPath, 'utf8');
                        
                        if (typeof pattern === 'string') {
                            if (logContent.includes(pattern)) {
                                return true;
                            }
                        } else {
                            if (pattern.test(logContent)) {
                                return true;
                            }
                        }
                    }
                }
            } catch (error) {
                // Log directory might not exist yet
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        return false;
    }
    
    static async killProcessTree(pid: number): Promise<void> {
        try {
            const children = await psTreeAsync(pid);
            
            // Kill child processes first
            for (const child of children) {
                try {
                    process.kill(parseInt((child as any).PID), 'SIGTERM');
                } catch (e) {
                    // Process might already be dead
                }
            }
            
            // Wait a bit then force kill if necessary
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            for (const child of children) {
                try {
                    process.kill(parseInt((child as any).PID), 'SIGKILL');
                } catch (e) {
                    // Process might already be dead
                }
            }
            
            // Finally kill the main process
            try {
                process.kill(pid, 'SIGTERM');
                await new Promise(resolve => setTimeout(resolve, 1000));
                process.kill(pid, 'SIGKILL');
            } catch (e) {
                // Process might already be dead
            }
        } catch (error) {
            console.warn('Failed to kill process tree:', error);
        }
    }
    
    static async cleanupTestFiles(): Promise<void> {
        try {
            await fs.remove(this.TEST_DIR);
        } catch (error) {
            console.warn('Failed to cleanup test files:', error);
        }
    }
}

export const TEST_ADAPTERS: TestAdapter[] = [
    {
        name: 'test-js-adapter',
        path: '',
        language: 'JavaScript',
        configFile: 'js-adapter.create-adapter.json'
    },
    {
        name: 'test-ts-adapter', 
        path: '',
        language: 'TypeScript',
        configFile: 'ts-adapter.create-adapter.json'
    }
];