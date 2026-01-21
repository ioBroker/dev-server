export interface IEnvironment {
    readFile(relPath: string): Promise<string>;

    writeFile(relPath: string, data: string): Promise<void>;

    readJson<T = any>(relPath: string): Promise<T>;

    writeJson(relPath: string, data: any): Promise<void>;

    copyFileTo(src: string, dest: string): Promise<void>;

    exists(relPath: string): Promise<boolean>;

    unlink(relPath: string): Promise<void>;

    exec(command: string): Promise<void>;

    execWithExistingFile(fullPath: string, commandBuilder: (remotePath: string) => string): Promise<void>;

    execWithNewFile(fullPath: string, commandBuilder: (remotePath: string) => string): Promise<void>;

    spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null>;

    exitChildProcesses(signal: string): Promise<void>;

    sendSigIntToChildProcesses(): void;
}
