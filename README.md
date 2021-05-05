# ioBroker dev-server

[![NPM version](https://img.shields.io/npm/v/@iobroker/dev-server.svg)](https://www.npmjs.com/package/@iobroker/dev-server)
[![Downloads](https://img.shields.io/npm/dm/@iobroker/dev-server.svg)](https://www.npmjs.com/package/@iobroker/dev-server)

ioBroker dev-server is a simple command line tool running on Windows, Linux and MacOS that allows you to quickly develop and test ioBroker adapters and their admin interface.

## TL;DR

```bash
npm install --global @iobroker/dev-server
dev-server setup
dev-server watch
```

## Features

- Runs on all operating systems supported by NodeJS and ioBroker
- Support for HTML and React UI
- Support for JavaScript and TypeScript adapters
- Hot reload of Admin UI upon any changes to HTML and JavaScript files.
- Hot reload of adapter upon code changes
- Live log in the console
- Debug adapter during start-up
- Multiple "profiles" allow for different datasets
- Multiple instances of dev-server can run in parallel (using different ports)
- All ports are only available locally (127.0.0.1)

## Setup

You need to install the `dev-server` package as well as set it up it in the adapter directory.

### Install package

You can either install this tool as a global tool or install it as a dev-dependency of your adapter. We suggest to install it globally:

```bash
npm install --global @iobroker/dev-server
```

### Setup local dev-server

To set up and configure a local dev-server in your adapter directory, change to the **base directory of your adapter** and execute the following command:

```bash
dev-server setup
```

For additional command line arguments, see blow.

_Note:_ the executable can either be called with the short name `dev-server` or its full name `iobroker-dev-server`. We will use the first way in this document.

### Exclude temporary folder

By default dev-server creates a temporary directory called `.dev-server` in your adapter directory where all data is stored. This directory must be excluded from NPM and Git.

Your `.gitignore` file must be extended with a single additional line:

```text
.dev-server/
```

If you created your adaper using a recent version of [Adapter Creator](https://github.com/ioBroker/create-adapter), the `.nmpignore` file will already contain a pattern matching this folder, otherwise add the above line or simply ignore all "dot"-files and folders:

```text
.*
```

## Command line

Usage: `dev-server <command> [options] [profile]`

All long-running commands can be stopped using `Ctrl-C`.

The following global options are available for all commands:

`--temp <path>` Change the temporary directory where the dev-server data will be located (default: ".dev-server").

### Profiles

All commands (except of course `dev-server profile`) support the `[profile]` command line argument. It allows the user to use choose between different profiles.

Each profile is a completely independent instance of ioBroker and can run in parallel with other profiles of the same adapter (if different ports are configured).

If no profile is specified on the command line, dev-server will do the following:

- if only one profile exists, it will be used
- if no profile exists, a profile called `default` will be created (only valid for `dev-server setup`)
- if multiple profiles exist, the user has to choose one from a list

### `dev-server setup`

Set up dev-server in the current directory. This should always be called in the directory where the `io-package.json` file of your adapter is located.

The following options are available:

`--adminPort <number>` TCP port on which ioBroker.admin will be available (default: 8081). This port number is also used to generate all other port numbers required to run dev-server. This allows multiple instances of dev-server to run in parallel. It is suggested to use ports in the range of 8000-9999. If you experience connection problems, try a different port.

`--jsController <version>` Define which version of js-controller to be used (default: "latest").

`--admin <version>` Define which version of admin to be used (default: "latest").

`--backupFile <filename>` Provide an ioBroker backup file to restore in this dev-server. Use this option to populate the dev-server with data (and possibly other adapters).

### `dev-server run`

Run dev-server, the adapter will not run, but you may test the Admin UI with hot-reload.

If you start the adapter from Admin, be aware that it will use the code uploaded during setup (or when `dev-server upload` was called explicitely).

### `dev-server watch`

Run dev-server and start the adapter in "watch" mode.

The adapter will automatically restart when its source code changes (with a 2 seconds delay).

You may attach a debugger to the running adapter. Keep in mind that the debugger will be detached when you change your source code, you need to manually attach again to the new process. Watch the console output for the correct process id to attach to.

If you are using TypeScript, make sure you have the `watch:ts` script defined the same way it is done by [Adapter Creator](https://github.com/ioBroker/create-adapter). There is no need to run `npm run watch:ts` separately, this is automatically done by dev-server.

### `dev-server debug`

Run dev-server and start the adapter from ioBroker in "debug" mode.

You may attach a debugger to the running adapter. Watch the console output for the correct process id to attach to.

The following options are available:

`--wait` Start the adapter only once the debugger is attached. This works the same way as calling `iobroker debug <adapter-name>.0 --wait` which in itself is similar to `node --inspect-brk ...`

### `dev-server update`

Update ioBroker and its dependencies to the latest versions.

If you specified `--jsController` during setup, the js-controller version will not be updated.

### `dev-server upload`

Upload the current version of your adapter to the dev-server.

This is only required if you changed something relevant in your io-package.json.

You should only do this when dev-server is not running.

This is a shortcut for `npm pack` and `npm install <package>.tgz`.

### `dev-server backup <filename>`

Create an ioBroker backup to the given file.

### `dev-server profile`

Lists all available profiles with their meta-data.
