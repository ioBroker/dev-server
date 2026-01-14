import path from 'node:path';
import { CommandBase, IOBROKER_COMMAND } from './CommandBase.js';
const BACKUP_POSTFIX = `_backupiobroker`;
export class Backup extends CommandBase {
    filename;
    constructor(owner, filename) {
        super(owner);
        this.filename = filename;
    }
    async doRun() {
        let fullPath = path.resolve(this.filename);
        if (!fullPath.endsWith(BACKUP_POSTFIX)) {
            fullPath += BACKUP_POSTFIX;
        }
        this.log.notice(`Creating backup to ${fullPath}`);
        await this.profileDir.execWithNewFile(fullPath, f => `${IOBROKER_COMMAND} backup "${f}"`);
    }
}
