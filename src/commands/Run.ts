import type { DevServer } from '../DevServer';
import { RunCommandBase } from './RunCommandBase';

export class Run extends RunCommandBase {
    constructor(
        owner: DevServer,
        private readonly useBrowserSync: boolean,
    ) {
        super(owner);
    }

    public async run(): Promise<void> {
        await this.startJsController();
        await this.startServer(this.useBrowserSync);
    }
}
