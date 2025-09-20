import * as path from 'path';
import * as fs from 'fs-extra';
import { TestUtils } from '../utils';

describe('Dev-Server Core Functionality Tests', () => {
    
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
        this.setObjectNotExists("info", {
            type: "channel",
            common: {
                name: "Information"
            },
            native: {}
        });
        this.setObjectNotExists("info.connection", {
            type: "state",
            common: {
                name: "Connected",
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        this.setState("info.connection", true, true);
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
        
        return adapterDir;
    }

    async function createMockTSAdapter(name: string): Promise<string> {
        const adapterDir = path.join(TestUtils.TEST_DIR, name);
        await fs.ensureDir(adapterDir);
        await fs.ensureDir(path.join(adapterDir, 'src'));
        await fs.ensureDir(path.join(adapterDir, 'admin'));
        
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
                main: "build/main.js",
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
            main: "build/main.js",
            scripts: {
                build: "tsc",
                "watch:ts": "tsc --watch",
                test: "echo \"Test passed\""
            },
            dependencies: {
                "@iobroker/adapter-core": "^3.0.0"
            },
            devDependencies: {
                "@types/node": "^16.0.0",
                "typescript": "^4.0.0"
            }
        };
        
        await fs.writeJson(path.join(adapterDir, 'package.json'), packageJson, { spaces: 2 });
        
        // Create main.ts
        const mainTs = `
import * as utils from "@iobroker/adapter-core";

class TestAdapter extends utils.Adapter {
    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: "${name}",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("unload", this.onUnload.bind(this));
    }

    private async onReady(): Promise<void> {
        this.log.info("${name} adapter started");
        await this.setObjectNotExistsAsync("info", {
            type: "channel",
            common: {
                name: "Information"
            },
            native: {}
        });
        await this.setObjectNotExistsAsync("info.connection", {
            type: "state",
            common: {
                name: "Connected",
                type: "boolean",
                role: "indicator.connected",
                read: true,
                write: false,
                def: false
            },
            native: {}
        });
        await this.setStateAsync("info.connection", true, true);
    }

    private onUnload(callback: () => void): void {
        try {
            this.log.info("${name} adapter stopped");
            callback();
        } catch (e) {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new TestAdapter(options);
} else {
    new TestAdapter();
}
`;
        
        await fs.writeFile(path.join(adapterDir, 'src', 'main.ts'), mainTs);
        
        // Create tsconfig.json
        const tsConfig = {
            compilerOptions: {
                module: "commonjs",
                target: "es2018",
                strict: true,
                esModuleInterop: true,
                skipLibCheck: true,
                forceConsistentCasingInFileNames: true,
                outDir: "build",
                rootDir: "src",
                declaration: true,
                declarationMap: true,
                sourceMap: true
            },
            include: ["src/**/*"],
            exclude: ["node_modules", "build"]
        };
        
        await fs.writeJson(path.join(adapterDir, 'tsconfig.json'), tsConfig, { spaces: 2 });
        
        return adapterDir;
    }

    test('should create mock JavaScript adapter', async () => {
        const adapterDir = await createMockJSAdapter('test-js-mock');
        
        expect(fs.existsSync(path.join(adapterDir, 'io-package.json'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'main.js'))).toBe(true);
        
        const ioPackage = await fs.readJson(path.join(adapterDir, 'io-package.json'));
        expect(ioPackage.common.name).toBe('test-js-mock');
    });

    test('should create mock TypeScript adapter', async () => {
        const adapterDir = await createMockTSAdapter('test-ts-mock');
        
        expect(fs.existsSync(path.join(adapterDir, 'io-package.json'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'src', 'main.ts'))).toBe(true);
        expect(fs.existsSync(path.join(adapterDir, 'tsconfig.json'))).toBe(true);
        
        const ioPackage = await fs.readJson(path.join(adapterDir, 'io-package.json'));
        expect(ioPackage.common.name).toBe('test-ts-mock');
    });

});