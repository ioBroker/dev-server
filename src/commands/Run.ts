import type { DevServer } from '../DevServer.js';
import { RunCommandBase } from './RunCommandBase.js';

export class Run extends RunCommandBase {
    constructor(
        owner: DevServer,
        private readonly useBrowserSync: boolean,
    ) {
        super(owner);
    }

    protected async doRun(): Promise<void> {
        await this.startJsController();
        await this.startServer(this.useBrowserSync);
    }
}
