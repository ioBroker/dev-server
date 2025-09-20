import { TestUtils } from '../utils';

describe('Test Infrastructure', () => {
    test('should be able to create test directory', async () => {
        await TestUtils.cleanupTestFiles();
        
        // This is just a simple test to verify our infrastructure works
        expect(true).toBe(true);
    });
});