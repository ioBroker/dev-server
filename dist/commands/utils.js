import { readFile, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import psTree from 'ps-tree';
export function escapeStringRegexp(value) {
    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}
export async function readJson(filePath) {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
}
export async function writeJson(filePath, data) {
    const content = JSON.stringify(data, null, 2);
    await writeFile(filePath, content, 'utf-8');
}
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
export function checkPort(port, host = '127.0.0.1', timeout = 1000) {
    return new Promise((resolve, reject) => {
        const socket = new Socket();
        const onError = (error) => {
            socket.destroy();
            reject(new Error(error));
        };
        socket.setTimeout(timeout);
        socket.once('error', onError);
        socket.once('timeout', onError);
        socket.once('close', onError);
        socket.connect(port, host, () => {
            setTimeout(() => {
                resolve();
                socket.end();
            }, 100); // slight delay to ensure port is ready
        });
    });
}
export function getChildProcesses(parentPid) {
    return new Promise((resolve, reject) => psTree(parentPid, (err, children) => {
        if (err) {
            reject(err);
        }
        else {
            // fix for MacOS bug #11
            children.forEach((c) => {
                if (c.COMM && !c.COMMAND) {
                    c.COMMAND = c.COMM;
                }
            });
            resolve(children);
        }
    }));
}
