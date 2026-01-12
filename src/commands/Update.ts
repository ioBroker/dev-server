import { CommandBase } from './CommandBase';

export class Update extends CommandBase {
    public async run(): Promise<void> {
        this.log.notice('Updating everything...');

        if (!this.config?.useSymlinks) {
            this.log.notice('Building local adapter.');
            await this.buildLocalAdapter();
            await this.installLocalAdapter(false); //do not install, keep .tgz file.
        }

        this.execSync('npm update --loglevel error', this.profileDir);
        this.uploadAdapter('admin');

        await this.installLocalAdapter();
        if (!this.isJSController()) {
            this.uploadAdapter(this.adapterName);
        }

        this.log.box(`dev-server was successfully updated.`);
    }
}
