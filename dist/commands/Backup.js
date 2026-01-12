"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Backup = void 0;
const CommandBase_1 = require("./CommandBase");
class Backup extends CommandBase_1.CommandBase {
    constructor(owner, filename) {
        super(owner);
        this.filename = filename;
    }
    async run() {
        this.execSync(`${CommandBase_1.IOBROKER_COMMAND} backup "${this.filename}"`, this.profileDir);
    }
}
exports.Backup = Backup;
