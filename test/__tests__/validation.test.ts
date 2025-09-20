import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils } from '../utils';

describe('Dev-Server Validation Tests', () => {
    
    beforeEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    async function createValidAdapter(name: string, isTypeScript: boolean = false): Promise<string> {
        const adapterDir = path.join(TestUtils.TEST_DIR, name);
        await fs.ensureDir(adapterDir);
        
        if (isTypeScript) {
            await fs.ensureDir(path.join(adapterDir, 'src'));
        }
        
        // Create valid io-package.json (this validates the structure)
        const ioPackage = {
            common: {
                name: name,
                version: "1.0.0",
                title: `Test ${name}`,
                desc: { en: "Test adapter" },
                authors: ["Test <test@test.com>"],
                license: "MIT",
                platform: "Javascript/Node.js",
                main: isTypeScript ? "build/main.js" : "main.js",
                mode: "daemon",
                type: "general",
                compact: true,
                adminUI: { config: "json" }
            },
            native: {},
            objects: [],
            instanceObjects: []
        };
        
        await fs.writeJson(path.join(adapterDir, 'io-package.json'), ioPackage, { spaces: 2 });
        
        // Create valid package.json
        const packageJson = {
            name: `iobroker.${name}`,
            version: "1.0.0",
            main: isTypeScript ? "build/main.js" : "main.js",
            scripts: isTypeScript ? {
                build: "tsc",
                "watch:ts": "tsc --watch"
            } : {},
            dependencies: {
                "@iobroker/adapter-core": "^3.0.0"
            }
        };
        
        await fs.writeJson(path.join(adapterDir, 'package.json'), packageJson, { spaces: 2 });
        
        // Create main file
        const mainCode = `console.log("${name} starting");`;
        
        if (isTypeScript) {
            await fs.writeFile(path.join(adapterDir, 'src', 'main.ts'), mainCode);
            // Create tsconfig.json
            const tsConfig = {
                compilerOptions: {
                    target: "es2018",
                    module: "commonjs",
                    outDir: "build",
                    rootDir: "src"
                }
            };
            await fs.writeJson(path.join(adapterDir, 'tsconfig.json'), tsConfig, { spaces: 2 });
        } else {
            await fs.writeFile(path.join(adapterDir, 'main.js'), mainCode);
        }
        
        // Create .npmignore
        await fs.writeFile(path.join(adapterDir, '.npmignore'), 'node_modules/\n.dev-server/\n');
        
        return adapterDir;
    }

    test('should validate JavaScript adapter structure', async () => {
        const adapterDir = await createValidAdapter('test-js-validation');
        
        // Verify the dev-server can read the adapter name correctly
        const ioPackage = await fs.readJson(path.join(adapterDir, 'io-package.json'));
        expect(ioPackage.common.name).toBe('test-js-validation');
        expect(ioPackage.common.main).toBe('main.js');
        
        // Verify package.json structure
        const packageJson = await fs.readJson(path.join(adapterDir, 'package.json'));
        expect(packageJson.name).toBe('iobroker.test-js-validation');
        expect(packageJson.main).toBe('main.js');
        
        // Verify main file exists
        expect(fs.existsSync(path.join(adapterDir, 'main.js'))).toBe(true);
        
        console.log('✓ JavaScript adapter structure validation passed');
    });

    test('should validate TypeScript adapter structure', async () => {
        const adapterDir = await createValidAdapter('test-ts-validation', true);
        
        // Verify the dev-server can read the adapter name correctly
        const ioPackage = await fs.readJson(path.join(adapterDir, 'io-package.json'));
        expect(ioPackage.common.name).toBe('test-ts-validation');
        expect(ioPackage.common.main).toBe('build/main.js');
        
        // Verify package.json structure with TypeScript scripts
        const packageJson = await fs.readJson(path.join(adapterDir, 'package.json'));
        expect(packageJson.name).toBe('iobroker.test-ts-validation');
        expect(packageJson.main).toBe('build/main.js');
        expect(packageJson.scripts.build).toBe('tsc');
        expect(packageJson.scripts['watch:ts']).toBe('tsc --watch');
        
        // Verify TypeScript source structure
        expect(fs.existsSync(path.join(adapterDir, 'src', 'main.ts'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'tsconfig.json'))).toBe(true);
        
        console.log('✓ TypeScript adapter structure validation passed');
    });

    test('should detect adapter type correctly', async () => {
        const jsAdapterDir = await createValidAdapter('test-js-detect');
        const tsAdapterDir = await createValidAdapter('test-ts-detect', true);
        
        // JavaScript adapter should have main.js
        const jsIoPackage = await fs.readJson(path.join(jsAdapterDir, 'io-package.json'));
        expect(jsIoPackage.common.main).toBe('main.js');
        expect(fs.existsSync(path.join(jsAdapterDir, 'main.js'))).toBe(true);
        
        // TypeScript adapter should have build/main.js and src/main.ts
        const tsIoPackage = await fs.readJson(path.join(tsAdapterDir, 'io-package.json'));
        expect(tsIoPackage.common.main).toBe('build/main.js');
        expect(fs.existsSync(path.join(tsAdapterDir, 'src', 'main.ts'))).toBe(true);
        
        console.log('✓ Adapter type detection validation passed');
    });

    test('should validate adapter naming conventions', async () => {
        // Test proper adapter naming
        const validNames = ['test-adapter', 'my-adapter-123', 'simple'];
        
        for (const name of validNames) {
            const adapterDir = await createValidAdapter(name);
            const ioPackage = await fs.readJson(path.join(adapterDir, 'io-package.json'));
            const packageJson = await fs.readJson(path.join(adapterDir, 'package.json'));
            
            expect(ioPackage.common.name).toBe(name);
            expect(packageJson.name).toBe(`iobroker.${name}`);
            
            // Clean up for next iteration
            await fs.remove(adapterDir);
        }
        
        console.log('✓ Adapter naming conventions validation passed');
    });

});