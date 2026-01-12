"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Upload = void 0;
const CommandBase_1 = require("./CommandBase");
class Upload extends CommandBase_1.CommandBase {
    async run() {
        await this.buildLocalAdapter();
        await this.installLocalAdapter();
        if (!this.isJSController()) {
            this.uploadAdapter(this.adapterName);
        }
    }
}
exports.Upload = Upload;
