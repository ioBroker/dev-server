import boxen from 'boxen';
import chalk from 'chalk';

export class Logger {
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

  public box(message: string): void {
    console.log(
      boxen(chalk.greenBright(message), {
        padding: 1,
        borderStyle: 'round',
      }),
    );
  }
}
