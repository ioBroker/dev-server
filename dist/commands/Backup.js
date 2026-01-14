import { CommandBase, IOBROKER_COMMAND } from './CommandBase.js';
export class Backup extends CommandBase {
    filename;
    constructor(owner, filename) {
        super(owner);
        this.filename = filename;
    }
    async doRun() {
        await this.profileDir.exec(`${IOBROKER_COMMAND} backup "${this.filename}"`);
    }
}
