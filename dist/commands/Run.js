import { RunCommandBase } from './RunCommandBase.js';
export class Run extends RunCommandBase {
    useBrowserSync;
    constructor(owner, useBrowserSync) {
        super(owner);
        this.useBrowserSync = useBrowserSync;
    }
    async doRun() {
        await this.startJsController();
        await this.startServer(this.useBrowserSync);
    }
}
