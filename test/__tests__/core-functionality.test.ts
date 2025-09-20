import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils } from '../utils';

describe('Dev-Server Core Tests', () => {
    
    beforeEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    async function createMinimalAdapter(name: string, isTypeScript: boolean = false): Promise<string> {
        const adapterDir = path.join(TestUtils.TEST_DIR, name);
        await fs.ensureDir(adapterDir);
        
        if (isTypeScript) {
            await fs.ensureDir(path.join(adapterDir, 'src'));
        }
        
        // Create minimal io-package.json
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
        
        // Create minimal package.json
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
        const mainCode = `
console.log("${name} adapter starting");
setTimeout(() => {
    console.log("${name} adapter ready");
    process.exit(0);
}, 2000);
`;
        
        if (isTypeScript) {
            await fs.writeFile(path.join(adapterDir, 'src', 'main.ts'), mainCode);
            // Create tsconfig.json
            const tsConfig = {
                compilerOptions: {
                    target: "es2018",
                    module: "commonjs",
                    outDir: "build",
                    rootDir: "src",
                    strict: true
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

    test('should successfully setup JavaScript adapter', async () => {
        const adapterDir = await createMinimalAdapter('test-js-minimal');
        
        const result = await TestUtils.runDevServerCommand(
            'setup',
            ['--adminPort', '8101'],
            adapterDir,
            120000 // 2 minutes
        );

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, '.dev-server'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, '.dev-server', 'default'))).toBe(true);
        
        const profilePackageJson = path.join(adapterDir, '.dev-server', 'default', 'package.json');
        expect(fs.existsSync(profilePackageJson)).toBe(true);
        
        const packageJson = await fs.readJson(profilePackageJson);
        expect(packageJson['dev-server']).toBeDefined();
        expect(packageJson['dev-server'].adminPort).toBe(8101);
    }, 180000);

    test('should successfully setup TypeScript adapter', async () => {
        const adapterDir = await createMinimalAdapter('test-ts-minimal', true);
        
        const result = await TestUtils.runDevServerCommand(
            'setup',
            ['--adminPort', '8102'],
            adapterDir,
            120000 // 2 minutes
        );

        expect(result.success).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, '.dev-server'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, '.dev-server', 'default'))).toBe(true);
        
        const profilePackageJson = path.join(adapterDir, '.dev-server', 'default', 'package.json');
        expect(fs.existsSync(profilePackageJson)).toBe(true);
        
        const packageJson = await fs.readJson(profilePackageJson);
        expect(packageJson['dev-server']).toBeDefined();
        expect(packageJson['dev-server'].adminPort).toBe(8102);
    }, 180000);

    test('should verify run command starts js-controller', async () => {
        const adapterDir = await createMinimalAdapter('test-run-minimal');
        
        // Setup first
        const setupResult = await TestUtils.runDevServerCommand(
            'setup',
            ['--adminPort', '8103'],
            adapterDir,
            120000
        );
        
        expect(setupResult.success).toBe(true);
        
        // Test run command briefly (just to verify it starts)
        const runResult = await TestUtils.runDevServerCommand(
            'run',
            ['--noBrowserSync'],
            adapterDir,
            15000 // 15 seconds timeout - just to verify it starts
        );
        
        // The run command will timeout after 15 seconds, which is expected
        // We just want to verify that it doesn't fail immediately
        expect(runResult.stderr).not.toContain('Error: Cannot find module');
        expect(runResult.stderr).not.toContain('SyntaxError');
        
    }, 180000);

});