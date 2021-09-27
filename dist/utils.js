"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rimraf = void 0;
const rimrafSync = require("rimraf");
const util_1 = require("util");
exports.rimraf = (0, util_1.promisify)(rimrafSync);
