"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const boxen_1 = __importDefault(require("boxen"));
const chalk_1 = __importDefault(require("chalk"));
class Logger {
    error(message) {
        console.log(chalk_1.default.redBright(message));
    }
    warn(message) {
        console.log(chalk_1.default.yellow(message));
    }
    notice(message) {
        console.log(chalk_1.default.blueBright(message));
    }
    info(message) {
        console.log(message);
    }
    debug(message) {
        console.log(chalk_1.default.grey(message));
    }
    box(message) {
        console.log(boxen_1.default(chalk_1.default.greenBright(message), {
            padding: 1,
            borderStyle: 'round',
        }));
    }
}
exports.Logger = Logger;
