import type { DevServer } from '../DevServer.js';
import { CommandBase, IOBROKER_COMMAND } from './CommandBase.js';

export class Backup extends CommandBase {
    constructor(
        owner: DevServer,
        private readonly filename: string,
    ) {
        super(owner);
    }

    protected async doRun(): Promise<void> {
        await this.profileDir.exec(`${IOBROKER_COMMAND} backup "${this.filename}"`);
    }
}
