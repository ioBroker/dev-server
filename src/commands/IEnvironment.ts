export interface IEnvironment {
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
