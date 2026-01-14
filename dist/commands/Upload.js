import { CommandBase } from './CommandBase.js';
export class Upload extends CommandBase {
    async doRun() {
        await this.buildLocalAdapter();
        await this.installLocalAdapter();
        if (!this.isJSController()) {
            await this.uploadAdapter(this.adapterName);
        }
    }
}
