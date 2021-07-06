# Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	## __WORK IN PROGRESS__
-->

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
