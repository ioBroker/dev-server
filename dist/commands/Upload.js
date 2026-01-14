import { CommandBase } from './CommandBase.js';
export class Upload extends CommandBase {
    async doRun() {
        await this.buildLocalAdapter();
        await this.installLocalAdapter();
        if (!this.isJSController()) {
            await this.uploadAdapter(this.adapterName);
        }
        const target = this.config.remote?.host ?? this.profilePath;
        this.log.box(`The latest content of iobroker.${this.adapterName} was uploaded to ${target}.`);
    }
}
