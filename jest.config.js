module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/test'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': 'ts-jest'
    },
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.d.ts'
    ],
    testTimeout: 300000, // 5 minutes for integration tests
    maxConcurrency: 1, // Run tests sequentially to avoid port conflicts
    globals: {
        'ts-jest': {
            tsconfig: 'test/tsconfig.json'
        }
    }
};