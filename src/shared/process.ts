/**
 * Argv-based command executor and spawn handle.
 *
 * All command execution uses (command, args) signatures with
 * shell=false (the default for node spawn). No raw shell command
 * strings are ever accepted or constructed.
 */

import { spawn as nodeSpawn } from "node:child_process";

/**
 * Result of executing a command to completion.
 */
export interface CommandResult {
  /** Standard output captured from the command. */
  stdout: string;
  /** Standard error captured from the command. */
  stderr: string;
  /** Exit code returned by the command process. */
  exitCode: number;
}

/**
 * Handle to a spawned long-running process.
 */
export interface ChildHandle {
  /** Process ID of the spawned process. */
  pid: number;
  /** Send SIGTERM to the spawned process. */
  kill(): void;
  /** Write data to the process stdin. */
  writeStdin(data: string): void;
}

/** Options for CommandExecutor.run. */
export interface RunOptions {
  /** Working directory for the subprocess. */
  cwd?: string | undefined;
  /** Additional environment variables. */
  env?: Record<string, string> | undefined;
  /** Timeout in milliseconds. */
  timeout?: number | undefined;
}

/** Options for CommandExecutor.spawn. */
export interface SpawnOptions {
  /** Working directory for the subprocess. */
  cwd?: string | undefined;
  /** Additional environment variables. */
  env?: Record<string, string> | undefined;
  /** Callback for stdout chunks. */
  onStdout?: ((chunk: string) => void) | undefined;
  /** Callback for stderr chunks. */
  onStderr?: ((chunk: string) => void) | undefined;
  /** Callback when the process exits. */
  onExit?: ((code: number) => void) | undefined;
  /** Callback when spawn itself fails (e.g. ENOENT for missing binary). */
  onError?: ((error: Error) => void) | undefined;
}

/**
 * Injectable command executor for running external processes.
 *
 * All methods accept (command, args) — no shell string methods exist.
 */
export interface CommandExecutor {
  /** Execute command with argv array. No shell interpolation. */
  run(command: string, args: string[], opts?: RunOptions): Promise<CommandResult>;

  /** Spawn long-running process with stdout streaming. */
  spawn(command: string, args: string[], opts?: SpawnOptions): ChildHandle;
}

/**
 * Creates a CommandExecutor backed by node spawn.
 *
 * Shell mode is never enabled. Arguments cross the seam as
 * command plus args, ensuring no shell interpolation.
 *
 * @returns A CommandExecutor instance.
 *
 * @example
 * ```typescript
 * const executor = createCommandExecutor();
 * const result = await executor.run("git", ["status"]);
 * ```
 */
export function createCommandExecutor(): CommandExecutor {
  return {
    run: executeCommand,
    spawn: spawnProcess,
  };
}

/**
 * Build the environment for a subprocess.
 *
 * @param extraEnv - Additional environment variables to merge.
 *
 * @returns Merged environment or undefined if no extras.
 *
 * @example
 * ```typescript
 * const env = buildSubprocessEnv({ MY_VAR: "value" });
 * ```
 */
function buildSubprocessEnv(
  extraEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv | undefined {
  if (extraEnv === undefined) {
    return undefined;
  }
  return { ...process.env, ...extraEnv };
}

/**
 * Execute a command to completion and collect output.
 *
 * @param command - The command to execute.
 * @param args - Arguments for the command.
 * @param opts - Optional execution options.
 *
 * @returns The command result with stdout, stderr, and exit code.
 *
 * @example
 * ```typescript
 * const result = await executeCommand("git", ["status"]);
 * ```
 */
function executeCommand(
  command: string,
  args: string[],
  opts?: RunOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const childProcess = nodeSpawn(command, args, {
      cwd: opts?.cwd,
      env: buildSubprocessEnv(opts?.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    childProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    childProcess.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    const timeoutHandle = scheduleTimeout(childProcess, opts?.timeout);

    childProcess.on("error", (spawnError: Error) => {
      clearScheduledTimeout(timeoutHandle);
      reject(spawnError);
    });

    childProcess.on("close", (code: number | null) => {
      clearScheduledTimeout(timeoutHandle);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
      });
    });
  });
}

/**
 * Schedule a SIGTERM timeout for a child process.
 *
 * @param childProcess - The child process to kill on timeout.
 * @param timeoutMs - Timeout in milliseconds, or undefined to skip.
 *
 * @returns The timeout handle, or undefined if no timeout was set.
 *
 * @example
 * ```typescript
 * const handle = scheduleTimeout(proc, 5000);
 * ```
 */
function scheduleTimeout(
  childProcess: ReturnType<typeof nodeSpawn>,
  timeoutMs: number | undefined,
): ReturnType<typeof setTimeout> | undefined {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return undefined;
  }
  return setTimeout(() => {
    childProcess.kill("SIGTERM");
  }, timeoutMs);
}

/**
 * Clear a scheduled timeout if it exists.
 *
 * @param handle - The timeout handle to clear.
 *
 * @example
 * ```typescript
 * clearScheduledTimeout(timeoutHandle);
 * ```
 */
function clearScheduledTimeout(handle: ReturnType<typeof setTimeout> | undefined): void {
  if (handle !== undefined) {
    clearTimeout(handle);
  }
}

/**
 * Spawn a long-running process with streaming callbacks.
 *
 * @param command - The command to spawn.
 * @param args - Arguments for the command.
 * @param opts - Optional spawn options with callbacks.
 *
 * @returns A ChildHandle for the spawned process.
 *
 * @example
 * ```typescript
 * const handle = spawnProcess("pi", ["--interactive"], {
 *   onStdout: (chunk) => console.log(chunk),
 * });
 * ```
 */
function spawnProcess(command: string, args: string[], opts?: SpawnOptions): ChildHandle {
  const childProcess = nodeSpawn(command, args, {
    cwd: opts?.cwd,
    env: buildSubprocessEnv(opts?.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  attachSpawnErrorCallback(childProcess, opts?.onError);
  attachStdoutCallback(childProcess, opts?.onStdout);
  attachStderrCallback(childProcess, opts?.onStderr);
  attachExitCallback(childProcess, opts?.onExit);

  return {
    pid: childProcess.pid ?? 0,
    kill(): void {
      childProcess.kill("SIGTERM");
    },
    writeStdin(data: string): void {
      childProcess.stdin.write(data);
    },
  };
}

/**
 * Attach a spawn error callback to a child process.
 *
 * When no callback is provided, errors are still caught and logged to
 * stderr so they never surface as unhandled exceptions.
 *
 * @param childProcess - The spawned child process.
 * @param callback - The error callback, or undefined for default logging.
 *
 * @example
 * ```typescript
 * attachSpawnErrorCallback(proc, (err) => console.error(err));
 * ```
 */
function attachSpawnErrorCallback(
  childProcess: ReturnType<typeof nodeSpawn>,
  callback: ((error: Error) => void) | undefined,
): void {
  childProcess.on("error", (spawnError: Error) => {
    if (callback !== undefined) {
      callback(spawnError);
    } else {
      // Prevent unhandled error crash — log to stderr as a fallback.
      process.stderr.write(`spawn error: ${spawnError.message}\n`);
    }
  });
}

/**
 * Attach a stdout callback to a child process.
 *
 * @param childProcess - The spawned child process.
 * @param callback - The stdout callback, or undefined to skip.
 *
 * @example
 * ```typescript
 * attachStdoutCallback(proc, console.log);
 * ```
 */
function attachStdoutCallback(
  childProcess: ReturnType<typeof nodeSpawn>,
  callback: ((chunk: string) => void) | undefined,
): void {
  if (callback !== undefined) {
    childProcess.stdout?.on("data", (chunk: Buffer) => {
      callback(chunk.toString("utf-8"));
    });
  }
}

/**
 * Attach a stderr callback to a child process.
 *
 * @param childProcess - The spawned child process.
 * @param callback - The stderr callback, or undefined to skip.
 *
 * @example
 * ```typescript
 * attachStderrCallback(proc, console.error);
 * ```
 */
function attachStderrCallback(
  childProcess: ReturnType<typeof nodeSpawn>,
  callback: ((chunk: string) => void) | undefined,
): void {
  if (callback !== undefined) {
    childProcess.stderr?.on("data", (chunk: Buffer) => {
      callback(chunk.toString("utf-8"));
    });
  }
}

/**
 * Attach an exit callback to a child process.
 *
 * @param childProcess - The spawned child process.
 * @param callback - The exit callback, or undefined to skip.
 *
 * @example
 * ```typescript
 * attachExitCallback(proc, (code) => console.log(code));
 * ```
 */
function attachExitCallback(
  childProcess: ReturnType<typeof nodeSpawn>,
  callback: ((code: number) => void) | undefined,
): void {
  if (callback !== undefined) {
    childProcess.on("close", (code: number | null) => {
      callback(code ?? 1);
    });
  }
}
