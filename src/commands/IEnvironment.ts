export interface IEnvironment {
    exec(command: string): Promise<void>;

    execWithFile(fullPath: string, commandBuilder: (remotePath: string) => string): Promise<void>;

    spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null>;

    exitChildProcesses(signal: string): Promise<void>;

    sendSigIntToChildProcesses(): void;
}
