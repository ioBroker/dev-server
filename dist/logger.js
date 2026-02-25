import boxen from 'boxen';
import chalk from 'chalk';
import { table } from 'table';
export class Logger {
    constructor(level) {
        this.level = level;
    }
    error(message) {
        console.error(chalk.redBright(message));
    }
    warn(message) {
        console.log(chalk.yellow(message));
    }
    notice(message) {
        console.log(chalk.blueBright(message));
    }
    info(message) {
        console.log(message);
    }
    debug(message) {
        console.log(chalk.grey(message));
    }
    silly(message) {
        if (this.level === 'silly') {
            console.log(chalk.grey(message));
        }
    }
    box(message) {
        console.log(boxen(chalk.greenBright(message), {
            padding: 1,
            borderStyle: 'round',
        }));
    }
    table(items, userConfig) {
        console.log(table(items, userConfig));
    }
}
//# sourceMappingURL=logger.js.map