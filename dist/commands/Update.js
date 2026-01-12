"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Update = void 0;
const CommandBase_1 = require("./CommandBase");
class Update extends CommandBase_1.CommandBase {
    async run() {
        var _a;
        this.log.notice('Updating everything...');
        if (!((_a = this.config) === null || _a === void 0 ? void 0 : _a.useSymlinks)) {
            this.log.notice('Building local adapter.');
            await this.buildLocalAdapter();
            await this.installLocalAdapter(false); //do not install, keep .tgz file.
        }
        this.execSync('npm update --loglevel error', this.profileDir);
        this.uploadAdapter('admin');
        await this.installLocalAdapter();
        if (!this.isJSController()) {
            this.uploadAdapter(this.adapterName);
        }
        this.log.box(`dev-server was successfully updated.`);
    }
}
exports.Update = Update;
