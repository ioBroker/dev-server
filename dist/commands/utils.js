"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.escapeStringRegexp = escapeStringRegexp;
exports.delay = delay;
exports.checkPort = checkPort;
const node_net_1 = require("node:net");
function escapeStringRegexp(value) {
    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function checkPort(port, host = '127.0.0.1', timeout = 1000) {
    return new Promise((resolve, reject) => {
        const socket = new node_net_1.Socket();
        const onError = (error) => {
            socket.destroy();
            reject(new Error(error));
        };
        socket.setTimeout(timeout);
        socket.once('error', onError);
        socket.once('timeout', onError);
        socket.connect(port, host, () => {
            socket.end();
            resolve();
        });
    });
}
