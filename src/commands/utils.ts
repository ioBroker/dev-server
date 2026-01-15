import { readFile, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import psTree from 'ps-tree';

export function escapeStringRegexp(value: string): string {
    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
}

export async function readJson<T = any>(filePath: string): Promise<T> {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
}

export async function writeJson(filePath: string, data: any): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await writeFile(filePath, content, 'utf-8');
}

export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function checkPort(port: number, host = '127.0.0.1', timeout = 1000): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = new Socket();

        const onError = (error: string): void => {
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

export function getChildProcesses(parentPid: number): Promise<readonly psTree.PS[]> {
    return new Promise<readonly psTree.PS[]>((resolve, reject) =>
        psTree(parentPid, (err, children) => {
            if (err) {
                reject(err);
            } else {
                // fix for MacOS bug #11
                children.forEach((c: any) => {
                    if (c.COMM && !c.COMMAND) {
                        c.COMMAND = c.COMM;
                    }
                });
                resolve(children);
            }
        }),
    );
}
