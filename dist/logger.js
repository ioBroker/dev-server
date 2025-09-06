"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const boxen_1 = __importDefault(require("boxen"));
const chalk_1 = __importDefault(require("chalk"));
const table_1 = require("table");
class Logger {
    constructor(level) {
        this.level = level;
    }
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
    silly(message) {
        if (this.level === 'silly') {
            console.log(chalk_1.default.grey(message));
        }
    }
    box(message) {
        console.log((0, boxen_1.default)(chalk_1.default.greenBright(message), {
            padding: 1,
            borderStyle: 'round',
        }));
    }
    table(items, userConfig) {
        console.log((0, table_1.table)(items, userConfig));
    }
}
exports.Logger = Logger;
