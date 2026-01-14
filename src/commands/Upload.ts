import { CommandBase } from './CommandBase.js';

export class Upload extends CommandBase {
    protected async doRun(): Promise<void> {
        await this.buildLocalAdapter();
        await this.installLocalAdapter();

        if (!this.isJSController()) {
            await this.uploadAdapter(this.adapterName);
        }
    }
}
