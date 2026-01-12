"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Run = void 0;
const RunCommandBase_1 = require("./RunCommandBase");
class Run extends RunCommandBase_1.RunCommandBase {
    constructor(owner, useBrowserSync) {
        super(owner);
        this.useBrowserSync = useBrowserSync;
    }
    async run() {
        await this.startJsController();
        await this.startServer(this.useBrowserSync);
    }
}
exports.Run = Run;
