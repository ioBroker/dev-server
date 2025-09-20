import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils } from '../utils';

describe('Dev-Server Setup Tests', () => {
    
    beforeEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    afterEach(async () => {
        await TestUtils.cleanupTestFiles();
    });

    async function createMockJSAdapter(name: string): Promise<string> {
        const adapterDir = path.join(TestUtils.TEST_DIR, name);
        await fs.ensureDir(adapterDir);
        
        // Create io-package.json
        const ioPackage = {
            common: {
                name: name,
                version: "1.0.0",
                news: {},
                title: `Test ${name} adapter`,
                titleLang: {},
                desc: {
                    en: `Test ${name} adapter for dev-server testing`
                },
                authors: ["Test Author <test@example.com>"],
                keywords: ["test"],
                license: "MIT",
                platform: "Javascript/Node.js",
                main: "main.js",
                icon: "test.png",
                enabled: true,
                extIcon: "",
                readme: "",
                loglevel: "info",
                mode: "daemon",
                type: "general",
                compact: true,
                connectionType: "none",
                dataSource: "poll",
                adminUI: {
                    config: "json"
                },
                dependencies: [],
                globalDependencies: []
            },
            native: {},
            objects: [],
            instanceObjects: []
        };
        
        await fs.writeJson(path.join(adapterDir, 'io-package.json'), ioPackage, { spaces: 2 });
        
        // Create package.json
        const packageJson = {
            name: `iobroker.${name}`,
            version: "1.0.0",
            description: `Test ${name} adapter`,
            author: "Test Author",
            license: "MIT",
            main: "main.js",
            scripts: {
                test: "echo \"Test passed\""
            },
            dependencies: {
                "@iobroker/adapter-core": "^3.0.0"
            },
            devDependencies: {}
        };
        
        await fs.writeJson(path.join(adapterDir, 'package.json'), packageJson, { spaces: 2 });
        
        // Create main.js
        const mainJs = `
"use strict";

const utils = require("@iobroker/adapter-core");

class TestAdapter extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: "${name}",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    async onReady() {
        this.log.info("${name} adapter started");
    }

    onUnload(callback) {
        try {
            this.log.info("${name} adapter stopped");
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options) => new TestAdapter(options);
} else {
    new TestAdapter();
}
`;
        
        await fs.writeFile(path.join(adapterDir, 'main.js'), mainJs);
        
        // Create .npmignore to avoid interactive prompt
        const npmIgnore = `
node_modules/
.dev-server/
*.log
.git/
.DS_Store
`;
        await fs.writeFile(path.join(adapterDir, '.npmignore'), npmIgnore);
        
        return adapterDir;
    }

    test('should run setup command successfully on JavaScript adapter', async () => {
        const adapterDir = await createMockJSAdapter('test-setup-js');
        
        const result = await TestUtils.runDevServerCommand(
            'setup',
            ['--adminPort', '8097'],
            adapterDir,
            180000 // 3 minutes timeout for setup
        );

        console.log('Setup stdout:', result.stdout);
        console.log('Setup stderr:', result.stderr);
        console.log('Setup success:', result.success);

        if (!result.success) {
            throw new Error(`Setup failed: ${result.stderr}`);
        }

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
        expect(packageJson['dev-server'].adminPort).toBe(8097);
        
        // Check for iobroker-data directory
        expect(fs.existsSync(path.join(profileDir, 'iobroker-data'))).toBe(true);
        
        // Check for node_modules with required packages
        const nodeModulesDir = path.join(profileDir, 'node_modules');
        expect(fs.existsSync(nodeModulesDir)).toBe(true);
        expect(fs.existsSync(path.join(nodeModulesDir, 'iobroker.js-controller'))).toBe(true);
        expect(fs.existsSync(path.join(nodeModulesDir, 'iobroker.admin'))).toBe(true);
        
        // Check that adapter was installed
        expect(fs.existsSync(path.join(nodeModulesDir, `iobroker.${packageJson['dev-server'].adapterName || 'test-setup-js'}`))).toBe(true);
    }, 300000); // 5 minute timeout

});