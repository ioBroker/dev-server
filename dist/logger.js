"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const boxen_1 = __importDefault(require("boxen"));
const chalk_1 = require("chalk");
const table_1 = require("table");
class Logger {
    error(message) {
        console.log(chalk_1.redBright(message));
    }
    warn(message) {
        console.log(chalk_1.yellow(message));
    }
    notice(message) {
        console.log(chalk_1.blueBright(message));
    }
    info(message) {
        console.log(message);
    }
    debug(message) {
        console.log(chalk_1.grey(message));
    }
    box(message) {
        console.log(boxen_1.default(chalk_1.greenBright(message), {
            padding: 1,
            borderStyle: 'round',
        }));
    }
    table(items, userConfig) {
        console.log(table_1.table(items, userConfig));
    }
}
exports.Logger = Logger;
