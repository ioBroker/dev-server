import { CommandBase } from './CommandBase.js';

export class Update extends CommandBase {
    public async run(): Promise<void> {
        this.log.notice('Updating everything...');

        if (!this.config?.useSymlinks) {
            this.log.notice('Building local adapter.');
            await this.buildLocalAdapter();
            await this.installLocalAdapter(false); //do not install, keep .tgz file.
        }

        await this.profileDir.exec('npm update --loglevel error');
        await this.uploadAdapter('admin');

        await this.installLocalAdapter();
        if (!this.isJSController()) {
            await this.uploadAdapter(this.adapterName);
        }

        this.log.box(`dev-server was successfully updated.`);
    }
}
