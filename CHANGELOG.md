# Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	## __WORK IN PROGRESS__
-->
## __WORK IN PROGRESS__
* (stevenengland) Add support for jsonconfig json5 files hot reload

## 0.7.1 (2023-11-09)
* (Apollon77) downgrade boxen again to fix problems with it

## 0.7.0 (2023-11-09)
* (AlCalzone/Garfonso) symlink the local adapter instead of pack/install on each change
* (Apollon77) Update dependencies

## 0.6.0 (2022-10-02)
- (Apollon77) Add option --doNotWatch for "watch" mode to ignore changes on defined files or locations
- (Apollon77/kleinOr) Set several other system settings on "setup" call like the location, currency, language and temperature unit that they are not empty
- (Apollon77) Only send SIGINT on exit first and then SIGKILL after 5 seconds if not yet exited to allow clean shutdown of all components
- (Apollon77) Make sure initial file sync is finished before starting adapter (incl. a short static delay to make sure all is persisted before start watching)
- (Apollon77) Wait that js-controller DB ports are available before starting adapter
- (Apollon77) User 127.0.0.1 instead of localhost to avoid DNS lookup issues with Node.js 18 (looks up IPv6 by default)

## 0.5.0 (2022-04-29)

- (UncleSamSwiss) Added support for JSON config UI (#164)
- (UncleSamSwiss) `dev-server watch` works again for the latest `@iobroker/adapter-dev`
- (UncleSamSwiss) `dev-server watch` and `debug` support `--noInstall` which won't build/install the adapter
- (UncleSamSwiss) js-controller is now always started with inspector on port 9228 (#150)
- (UncleSamSwiss) Improvements during `dev-server setup` (#114, #201)

## 0.4.1 (2022-04-29)

- (UncleSamSwiss) Fixed warnings when debugging "old-style" React adapters like ioBroker.javascript
- (AlCalzone) Fixed `dev-server watch` not continuing when using `@iobroker/adapter-dev` to compile React

## 0.4.0 (2021-07-06)

- (UncleSamSwiss) Changed default log level to `debug` and adapter repo to `beta` (#74)
- (UncleSamSwiss) Added verification of .npmignore and .gitignore (#46)
- (UncleSamSwiss) Restarting adapter with `watch` when adapter config changes (#47)
- (UncleSamSwiss) Running "npm run build" before installing the adapter (#77)
- (UncleSamSwiss) Fixed bug that "watch" wasn't syncing files upon start-up, but only when they changed (this was causing issues with sourcemaps).
- (UncleSamSwiss) Added `--noStart` option to `watch`, this allows to start the adapter from an IDE afterwards

## 0.3.0 (2021-05-13)

- (AlCalzone & UncleSamSwiss) Added support for debugging `js-controller` (including `watch` and `debug --wait`)

## 0.2.1 (2021-05-05)

- (UncleSamSwiss) Fixed issue with `dev-server update` not properly updating admin

## 0.2.0 (2021-05-05)

- (UncleSamSwiss) **Breaking Change:** it is no longer possible to use `dev-server` without providing a command. Use `dev-server run` for the same behavior as before.
- (AlCalzone) Made build script handling more flexible (#23)
- (UncleSamSwiss) Added support for different profiles (#39)
- (UncleSamSwiss) Added possibility to create a backup (#28)
- (UncleSamSwiss) Added possibility to restore a backup file during `dev-server setup` (#28)
- (UncleSamSwiss) Added automatic installation of adapter dependencies (#8)
- (UncleSamSwiss) Added version check when starting dev-server
- (UncleSamSwiss) Added option to specify the ioBroker.admin version to use

## 0.1.4 (2021-04-14)

- (UncleSamSwiss) Fixed issue with bash reusing the process instead of creating a child

## 0.1.3 (2021-04-01)

- (UncleSamSwiss) Disabled license info dialog at first start-up (#10)
- (UncleSamSwiss) Fixed issue on MacOS about "COMMAND" property (#11)
- (UncleSamSwiss) Fixed issue where error output from parcel (or tsc) would kill the application

## 0.1.2 (2021-02-25)

- (UncleSamSwiss) Fixed automatic NPM deployment.

## 0.1.1 (2021-02-25)

- (UncleSamSwiss) Added release script and GitHub actions integration.
- (UncleSamSwiss) Added dependabot checking and auto-merging.
- (UncleSamSwiss) Updated to the latest dependencies.

### 0.1.0

- (UncleSamSwiss) Initial version
