import path from 'node:path';
import type { DevServer } from '../DevServer.js';
import { CommandBase, IOBROKER_COMMAND } from './CommandBase.js';

const BACKUP_POSTFIX = `_backupiobroker`;

export class Backup extends CommandBase {
    constructor(
        owner: DevServer,
        private readonly filename: string,
    ) {
        super(owner);
    }

    protected async doRun(): Promise<void> {
        let fullPath = path.resolve(this.filename);
        if (!fullPath.endsWith(BACKUP_POSTFIX)) {
            fullPath += BACKUP_POSTFIX;
        }

        this.log.notice(`Creating backup to ${fullPath}`);
        await this.profileDir.execWithNewFile(fullPath, f => `${IOBROKER_COMMAND} backup "${f}"`);
    }
}
