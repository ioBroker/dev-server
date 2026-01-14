export interface IEnvironment {
    installTarball(tarballPath: string): Promise<void>;

    exec(command: string): Promise<void>;

    spawn(
        command: string,
        args: ReadonlyArray<string>,
        onExit: (exitCode: number) => void | Promise<void>,
    ): Promise<number | null>;

    exitChildProcesses(signal: string): Promise<void>;

    sendSigIntToChildProcesses(): void;
}
