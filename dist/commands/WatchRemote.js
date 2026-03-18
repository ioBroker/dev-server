import path from 'node:path';
import { RemoteConnection } from './RemoteConnection.js';
import { ADAPTER_DEBUGGER_PORT } from './RunCommandBase.js';
import { Watch } from './Watch.js';
export class WatchRemote extends Watch {
    async prepare() {
        if (!this.startAdapter) {
            throw new Error('Cannot watch remote adapter without starting it');
        }
        await super.prepare();
        if (this.profileDir instanceof RemoteConnection) {
            // this should always be the case
            await this.profileDir.tunnelPort(ADAPTER_DEBUGGER_PORT);
        }
    }
    async startNodemon(baseDir, scriptName) {
        const script = path.join(baseDir, scriptName);
        this.log.notice(`Starting nodemon for ${script} on remote host`);
        await this.profileDir.writeJson('nodemon.json', this.createNodemonConfig(script, baseDir));
        await this.profileDir.spawn('npx', ['nodemon', '--config', 'nodemon.json', script], (exitCode) => {
            this.log.warn(`Nodemon process on remote host has exited with exit code ${exitCode}`);
            return this.exit(exitCode);
        });
        this.log.box(`Debugger will be available on port 127.0.0.1:${ADAPTER_DEBUGGER_PORT}`);
    }
}
