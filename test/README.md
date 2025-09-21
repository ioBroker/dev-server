# Integration Tests for dev-server

This directory contains integration tests for the dev-server tool that verify its functionality with both JavaScript and TypeScript adapters.

## Test Structure

- **`ci-test.js`** - Fast CI tests for essential functionality (runs in CI)
- **`integration-test.js`** - Full integration tests including runtime testing  
- **`adapters/`** - Test adapters created with @iobroker/create-adapter

## Test Adapters

The test suite uses real ioBroker adapters created with `@iobroker/create-adapter`:

- **`ioBroker.test-js/`** - JavaScript test adapter 
- **`ioBroker.test-ts/`** - TypeScript test adapter (based on JS config)

These adapters include `.create-adapter.json` configuration files that can be reused for consistent test adapter recreation.

## What is Tested

### CI Tests (`npm test`)
- ✅ Adapter configuration validation (io-package.json, package.json, main.js)
- ✅ `dev-server setup` command functionality
- ✅ Directory structure creation (.dev-server, node_modules, iobroker.json)

### Full Integration Tests (`npm run test:full`)
- ✅ `dev-server setup` - Creates complete dev environment
- ✅ `dev-server run` - Starts js-controller and admin.0 without errors
- ✅ `dev-server watch` - Starts adapter with hot-reload and file sync
- ✅ Process cleanup with SIGINT signal handling
- ✅ Log validation for host, admin.0, and adapter processes

## Running Tests

```bash
# Fast CI tests (used in GitHub Actions)
npm test

# Full integration tests (for development)
npm run test:full

# Run tests directly
node test/ci-test.js
node test/integration-test.js
```

## Requirements Validation

These tests validate the requirements specified in issue #507:

1. ✅ **Adapter Creation**: Uses @iobroker/create-adapter to create test adapters
2. ✅ **Setup Command**: Validates `.dev-server` directory with node_modules and iobroker.json
3. ✅ **Run Command**: Validates js-controller and admin.0 startup with proper logging
4. ✅ **Watch Command**: Validates adapter startup and log integration  
5. ✅ **Process Management**: All processes exit cleanly with SIGINT
6. ✅ **CI Integration**: Tests run in GitHub Actions workflow

## Test Adapter Configuration

The test adapters are configured as:

- **Language**: JavaScript (test-js) and TypeScript (test-ts)  
- **Port**: 8081 (JS) and 8082 (TS) for admin interface
- **Type**: Network adapters with polling data source
- **Features**: ESLint, type checking, dev-server integration
- **Admin UI**: JSON-based configuration

The `.create-adapter.json` files preserve the exact configuration used for reproducible test adapter creation.