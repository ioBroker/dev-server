# Integration Tests for dev-server

This directory contains integration tests for the dev-server tool that verify its functionality with both JavaScript and TypeScript adapters.

## Test Structure

- **`dev-server.test.js`** - Mocha-based integration tests for dev-server functionality
- **`test-utils.js`** - Shared utilities for running commands and creating test adapters
- **`adapters/`** - Configuration files for test adapters

## Test Adapter Configuration

The test suite uses configuration files to create real ioBroker adapters on-the-fly:

- **`adapters/test-js.create-adapter.json`** - JavaScript test adapter configuration
- **`adapters/test-ts.create-adapter.json`** - TypeScript test adapter configuration

These configuration files are used with `@iobroker/create-adapter --replay` to dynamically create test adapters before running the tests.

## What is Tested

### Adapter Configuration Tests
- ✅ Validates io-package.json, package.json, and main.js files exist and are valid
- ✅ Ensures TypeScript adapters have proper tsconfig.json configuration
- ✅ Verifies adapter metadata and keywords are correctly set

### Dev-server Command Tests  
- ✅ `dev-server setup` - Creates complete dev environment (.dev-server, node_modules, iobroker.json)
- ✅ `dev-server run` - Starts js-controller and admin.0 without starting the adapter under test
- ✅ `dev-server watch` - Starts adapter with hot-reload and validates info logs are produced

### Process Management Tests
- ✅ Validates proper SIGINT signal handling and graceful shutdown
- ✅ Ensures no test-js.0 logs appear in "run" mode (adapter should not start)
- ✅ Validates test-js.0 info logs appear in "watch" mode (adapter should start)

## Running Tests

```bash
# Run all integration tests
npm test

# Run with verbose mocha output
npx mocha test/dev-server.test.js --reporter spec
```

## Test Workflow

1. **Setup Phase**: Creates test adapters using @iobroker/create-adapter
2. **Configuration Tests**: Validates adapter files and structure
3. **Setup Tests**: Tests dev-server setup command functionality
4. **Runtime Tests**: Tests run and watch commands with proper log validation
5. **Cleanup Phase**: Removes created test adapters

## Requirements Validation

These tests validate the requirements specified in issue #507:

1. ✅ **Dynamic Adapter Creation**: Uses @iobroker/create-adapter with replay configs
2. ✅ **Setup Command**: Validates `.dev-server` directory with node_modules and iobroker.json
3. ✅ **Run Command**: Validates js-controller and admin.0 startup, ensures adapter doesn't start
4. ✅ **Watch Command**: Validates adapter startup and info log production
5. ✅ **Process Management**: All processes exit cleanly with SIGINT
6. ✅ **CI Integration**: Tests run in GitHub Actions workflow with proper timeouts

## Implementation Notes

- Test adapters are created dynamically and cleaned up after tests
- Uses mocha testing framework with proper describe/it structure
- Shared utilities prevent code duplication between tests
- Proper timeout handling for long-running operations
- Validates specific log patterns to ensure correct behavior

If adapter creation fails due to network issues, the tests will fail with clear error messages indicating the problem with the @iobroker/create-adapter tool.