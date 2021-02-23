# dev-server

`dev-server` is a simple command line tool that allows you to quickly develop and test ioBroker adapters and their admin interface.

## Setup

You need to install the `dev-server` package as well as set it up it in the adapter directory.

### Install package

You can either install this tool as a global tool or install it as a dev-dependency of your adapter. We suggest to install it globally:

```bash
npm install --global ioBroker/dev-server
```

### Setup local dev-server

To set up and configure a local dev-server in your adapter directory, change to the base directory of your adapter and execute the following command:

```bash
dev-server setup
```

For additional command line arguments, see blow.

Please note that the executable can either be called with the short name `dev-server` or its full name `iobroker-dev-server`. We will use the first way in this document.

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
