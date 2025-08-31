# GitHub Copilot Instructions for ioBroker dev-server

## Project Overview

This is `@iobroker/dev-server`, a command-line development tool for ioBroker adapter developers. It provides a local development environment that simulates the ioBroker runtime, allowing developers to test and debug their adapters efficiently.

## Key Concepts

### Purpose
- **Primary function**: Local development server for ioBroker adapters
- **Target users**: ioBroker adapter developers
- **Environment**: Cross-platform CLI tool (Windows, Linux, macOS)
- **Runtime**: Node.js 16+ required

### Core Functionality
- Sets up isolated ioBroker instances for development
- Provides hot-reload capabilities for adapter code
- Integrates with admin interfaces for configuration testing
- Supports debugging with IDE integration
- Manages temporary development profiles

## Architecture

### Entry Point
- **Main file**: `src/index.ts` - CLI application using yargs for command parsing
- **Built output**: `dist/index.js` - Compiled TypeScript
- **Binaries**: `dev-server` and `iobroker-dev-server` commands

### Key Components
- **DevServer class**: Main orchestrator in `src/index.ts`
- **Logger**: Centralized logging utility in `src/logger.ts`
- **JSON Config**: Hot-reload support for admin configs in `src/jsonConfig.ts`

### CLI Commands
- `setup`: Initialize dev-server in adapter directory
- `watch`: Start development server with hot-reload
- `run`: Start adapter without file watching
- `debug`: Start with debugging capabilities
- `upload`: Upload adapter to running ioBroker
- `backup`: Create ioBroker backup
- `profile`: List available development profiles

## Development Workflow

### File Structure
- **Source**: `src/` directory with TypeScript files
- **Build**: `dist/` directory with compiled JavaScript
- **Temp data**: `.dev-server/` directory (excluded from git/npm)
- **Profiles**: Support for multiple development environments

### Build Process
```bash
npm run build      # Compile TypeScript
npm run watch      # Watch mode for development
npm run lint       # ESLint validation
npm run check      # TypeScript type checking
```

### Key Dependencies
- **CLI**: yargs for command parsing
- **File operations**: fs-extra, chokidar for watching
- **HTTP**: express, browser-sync for admin interface
- **Process management**: nodemon, ps-tree for adapter lifecycle
- **ioBroker**: @iobroker/testing for integration

## Code Conventions

### TypeScript
- Strict TypeScript configuration
- Interface definitions for configuration objects
- Type-safe command handlers
- Source maps for debugging

### Error Handling
- Comprehensive logging with different levels
- Graceful process cleanup (SIGINT → SIGKILL)
- User-friendly error messages with actionable suggestions

### Configuration
- JSON-based configuration files
- Profile-based development environments
- Port management with automatic offsets

## Important Files

### Core Implementation
- `src/index.ts`: Main DevServer class and CLI commands
- `src/logger.ts`: Logging utilities with colored output
- `src/jsonConfig.ts`: Admin interface hot-reload injection

### Configuration
- `tsconfig.json`: TypeScript compiler settings
- `tsconfig.build.json`: Production build configuration
- `eslint.config.mjs`: ESLint rules and settings
- `package.json`: Dependencies and CLI binaries

### Documentation
- `README.md`: User documentation with setup instructions
- `CHANGELOG.md`: Version history and changes
- `.vscode/`: VS Code debugging configurations

## Development Practices

### Port Management
- Base admin port (default 8081) with automatic offsets
- Hidden ports for browser-sync, databases
- Collision detection and resolution

### File Watching
- Intelligent file change detection
- Configurable ignore patterns
- Source map support for debugging

### Integration Points
- ioBroker js-controller integration
- Admin interface proxy and injection
- WebSocket communication for real-time updates

### Testing Approach
- Integration testing with @iobroker/testing
- Manual testing with real adapter projects
- Cross-platform compatibility validation

## Common Development Tasks

### Adding New Commands
1. Add command definition in `src/index.ts` constructor
2. Implement handler method in DevServer class
3. Update help text and documentation
4. Test with various adapter projects

### Modifying File Watching
1. Update chokidar configuration in watch methods
2. Consider performance impact of glob patterns
3. Test with large adapter projects
4. Ensure source map preservation

### Admin Interface Changes
1. Modify injection code in `src/jsonConfig.ts`
2. Test with different admin UI versions
3. Verify WebSocket communication
4. Check browser compatibility

## Security Considerations
- Temporary files in `.dev-server/` must be excluded from version control
- Port binding only to localhost (127.0.0.1)
- Proper process cleanup to prevent resource leaks
- Validation of file paths to prevent directory traversal

## Performance Notes
- Symlink support for faster file operations
- Debounced file watching to prevent excessive rebuilds
- Efficient port allocation algorithm
- Memory management for long-running processes