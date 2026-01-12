import { CommandBase } from './CommandBase';

export class Upload extends CommandBase {
    public async run(): Promise<void> {
        await this.buildLocalAdapter();
        await this.installLocalAdapter();

        if (!this.isJSController()) {
            this.uploadAdapter(this.adapterName);
        }
    }
}
