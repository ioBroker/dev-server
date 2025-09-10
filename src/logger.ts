import boxen from 'boxen';
import chalk from 'chalk';
import { table, type TableUserConfig } from 'table';

export class Logger implements ioBroker.Logger {
    constructor(public level: ioBroker.LogLevel) {}

    public error(message: string): void {
        console.log(chalk.redBright(message));
    }

    public warn(message: string): void {
        console.log(chalk.yellow(message));
    }

    public notice(message: string): void {
        console.log(chalk.blueBright(message));
    }

    public info(message: string): void {
        console.log(message);
    }

    public debug(message: string): void {
        console.log(chalk.grey(message));
    }

    public silly(message: string): void {
        if (this.level === 'silly') {
            console.log(chalk.grey(message));
        }
    }

    public box(message: string): void {
        console.log(
            boxen(chalk.greenBright(message), {
                padding: 1,
                borderStyle: 'round',
            }),
        );
    }

    public table(items: unknown[][], userConfig?: TableUserConfig): void {
        console.log(table(items, userConfig));
    }
}
