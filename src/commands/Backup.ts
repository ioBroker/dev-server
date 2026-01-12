import type { DevServer } from '../DevServer';
import { CommandBase, IOBROKER_COMMAND } from './CommandBase';

export class Backup extends CommandBase {
    constructor(
        owner: DevServer,
        private readonly filename: string,
    ) {
        super(owner);
    }

    public async run(): Promise<void> {
        this.execSync(`${IOBROKER_COMMAND} backup "${this.filename}"`, this.profileDir);
    }
}
