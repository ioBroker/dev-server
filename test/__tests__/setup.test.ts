import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils, TEST_ADAPTERS } from '../utils';

describe('Dev-Server Setup Command', () => {
    beforeAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterAll(async () => {
        await TestUtils.cleanupTestFiles();
    });

    describe('JavaScript Adapter Setup', () => {
        const jsAdapter = TEST_ADAPTERS.find(a => a.language === 'JavaScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            adapterDir = await TestUtils.createTestAdapter(jsAdapter);
            jsAdapter.path = adapterDir;
        });

        test('should create test JavaScript adapter successfully', async () => {
            expect(fs.existsSync(adapterDir)).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'io-package.json'))).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'package.json'))).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'main.js'))).toBe(true);
        });

        test('should run setup command successfully', async () => {
            const result = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8091'], // Use different port to avoid conflicts
                adapterDir,
                120000 // 2 minutes timeout
            );

            expect(result.success).toBe(true);
            expect(result.stderr).not.toContain('Error');
            
            // Check that dev-server files were created
            const devServerDir = path.join(adapterDir, '.dev-server');
            expect(fs.existsSync(devServerDir)).toBe(true);
            
            const profileDir = path.join(devServerDir, 'default');
            expect(fs.existsSync(profileDir)).toBe(true);
            
            // Check that package.json was created with dev-server config
            const profilePackageJson = path.join(profileDir, 'package.json');
            expect(fs.existsSync(profilePackageJson)).toBe(true);
            
            const packageJson = await fs.readJson(profilePackageJson);
            expect(packageJson['dev-server']).toBeDefined();
            expect(packageJson['dev-server'].adminPort).toBe(8091);
        });

        test('should have ioBroker structure setup', async () => {
            const profileDir = path.join(adapterDir, '.dev-server', 'default');
            
            // Check for iobroker-data directory
            expect(fs.existsSync(path.join(profileDir, 'iobroker-data'))).toBe(true);
            
            // Check for node_modules with required packages
            const nodeModulesDir = path.join(profileDir, 'node_modules');
            expect(fs.existsSync(nodeModulesDir)).toBe(true);
            expect(fs.existsSync(path.join(nodeModulesDir, 'iobroker.js-controller'))).toBe(true);
            expect(fs.existsSync(path.join(nodeModulesDir, 'iobroker.admin'))).toBe(true);
        });
    });

    describe('TypeScript Adapter Setup', () => {
        const tsAdapter = TEST_ADAPTERS.find(a => a.language === 'TypeScript')!;
        let adapterDir: string;

        beforeAll(async () => {
            adapterDir = await TestUtils.createTestAdapter(tsAdapter);
            tsAdapter.path = adapterDir;
        });

        test('should create test TypeScript adapter successfully', async () => {
            expect(fs.existsSync(adapterDir)).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'io-package.json'))).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'package.json'))).toBe(true);
            expect(fs.existsSync(path.join(adapterDir, 'src', 'main.ts'))).toBe(true);
        });

        test('should run setup command successfully', async () => {
            const result = await TestUtils.runDevServerCommand(
                'setup',
                ['--adminPort', '8092'], // Use different port to avoid conflicts  
                adapterDir,
                120000 // 2 minutes timeout
            );

            expect(result.success).toBe(true);
            expect(result.stderr).not.toContain('Error');
            
            // Check that dev-server files were created
            const devServerDir = path.join(adapterDir, '.dev-server');
            expect(fs.existsSync(devServerDir)).toBe(true);
            
            const profileDir = path.join(devServerDir, 'default');
            expect(fs.existsSync(profileDir)).toBe(true);
            
            // Check that package.json was created with dev-server config
            const profilePackageJson = path.join(profileDir, 'package.json');
            expect(fs.existsSync(profilePackageJson)).toBe(true);
            
            const packageJson = await fs.readJson(profilePackageJson);
            expect(packageJson['dev-server']).toBeDefined();
            expect(packageJson['dev-server'].adminPort).toBe(8092);
        });

        test('should have TypeScript build files after setup', async () => {
            const profileDir = path.join(adapterDir, '.dev-server', 'default');
            const adapterNodeModules = path.join(profileDir, 'node_modules', `iobroker.${tsAdapter.name}`);
            
            // For TypeScript adapters, setup should build the project
            expect(fs.existsSync(path.join(adapterNodeModules, 'build'))).toBe(true);
            expect(fs.existsSync(path.join(adapterNodeModules, 'build', 'main.js'))).toBe(true);
        });
    });
});