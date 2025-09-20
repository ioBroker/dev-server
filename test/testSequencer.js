// Custom test sequencer to run tests in a specific order
class TestSequencer {
    sort(tests) {
        // Sort tests so setup tests run first, then functional tests
        return tests.sort((testA, testB) => {
            const testNameA = testA.path;
            const testNameB = testB.path;
            
            // Setup tests should run first
            if (testNameA.includes('setup') && !testNameB.includes('setup')) {
                return -1;
            }
            if (!testNameA.includes('setup') && testNameB.includes('setup')) {
                return 1;
            }
            
            return testNameA.localeCompare(testNameB);
        });
    }
}

module.exports = TestSequencer;