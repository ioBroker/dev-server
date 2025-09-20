import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils, TEST_ADAPTERS } from '../utils';

describe('Adapter Creation Test', () => {
    
    beforeEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    test('should create JavaScript adapter using create-adapter', async () => {
        const testDir = path.join(TestUtils.TEST_DIR, 'test-js-adapter');
        await fs.ensureDir(testDir);
        
        const config = {
            adapterName: 'test-js-simple',
            description: 'Test JavaScript adapter',
            authorName: 'Test Author',
            authorEmail: 'test@example.com',
            authorGithub: 'test-user',
            keywords: ['test'],
            type: 'general',
            startMode: 'daemon',
            language: 'JavaScript',
            adminUi: 'json',
            connectionIndicator: false,
            connectionType: 'none',
            dataSource: 'poll',
            tools: 'ESLint + Prettier',
            releaseScript: 'yes',
            dependabot: 'yes',
            unitTests: true,
            integrationTests: false,
            gitCommit: false,
            npmInstall: false,
            gitInit: false
        };
        
        // Write config file for create-adapter
        const configFile = path.join(testDir, '.create-adapter.json');
        await fs.writeJson(configFile, config, { spaces: 2 });
        
        // Run create-adapter
        const createAdapterPath = path.join(__dirname, '../../node_modules/@iobroker/create-adapter/build/index.js');
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        try {
            const { stdout, stderr } = await execAsync(`node "${createAdapterPath}" --replay "${configFile}" --noInstall`, {
                cwd: testDir,
                timeout: 120000
            });
            
            console.log('Create adapter stdout:', stdout);
            if (stderr) console.log('Create adapter stderr:', stderr);
            
            // List all files created
            const allFiles = await fs.readdir(testDir);
            console.log('Files created:', allFiles);
            
            // Check that adapter files were created
            const ioPackageExists = fs.existsSync(path.join(testDir, 'io-package.json'));
            const packageJsonExists = fs.existsSync(path.join(testDir, 'package.json'));
            const mainJsExists = fs.existsSync(path.join(testDir, 'main.js'));
            
            console.log('io-package.json exists:', ioPackageExists);
            console.log('package.json exists:', packageJsonExists);
            console.log('main.js exists:', mainJsExists);
            
            expect(ioPackageExists).toBe(true);
            expect(packageJsonExists).toBe(true);
            expect(mainJsExists).toBe(true);
            
            // Check content of io-package.json
            const ioPackage = await fs.readJson(path.join(testDir, 'io-package.json'));
            expect(ioPackage.common.name).toBe('test-js-simple');
            
        } catch (error: any) {
            console.error('Create adapter failed:', error);
            throw error;
        }
    }, 300000); // 5 minute timeout

});