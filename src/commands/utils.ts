import { Socket } from 'node:net';

export function escapeStringRegexp(value: string): string {
    // Escape characters with special meaning either inside or outside character sets.
    // Use a simple backslash escape when it’s always valid, and a `\xnn` escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/-/g, '\\x2d');
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

        socket.connect(port, host, () => {
            socket.end();
            resolve();
        });
    });
}
