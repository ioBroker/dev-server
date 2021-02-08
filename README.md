# dev-server

## How to add this tool to your Adapter

Note: if you haven't created the adapter with the [Adapter Creator](https://github.com/ioBroker/create-adapter), you might run into issues. We will try to solve those, but in most cases it is the easiest to just follow the Adapter Creator (or template) directory structure.

1. Add this project to your dev-dependencies:

```bash
npm i --save-dev UncleSamSwiss/iobroker-dev-server
```

2. Add the tool to your npm scripts: edit `package.json` to contain the following line in your scripts section:

```json
  "scripts": {
    "devserver": "devserver"
  },
```

3. Add the temp directory to your `.gitignore` **and** `.npmignore`:

```text
.devserver/
```

4. Launch the devserver in your adapter directory:

```bash
npm run devserver -- run
```

You can find more command line options using:

```bash
npm run devserver -- --help
```
