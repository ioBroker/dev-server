// Global test setup
import { rimraf } from 'rimraf';
import * as path from 'path';

// Global timeout for all tests
(global as any).jest.setTimeout(300000); // 5 minutes

// Cleanup any test artifacts
(global as any).beforeEach(async () => {
    // Clean up any leftover test adapters
    const testDir = path.join(__dirname, 'temp');
    try {
        await rimraf(testDir);
    } catch (e) {
        // Ignore errors if directory doesn't exist
    }
});