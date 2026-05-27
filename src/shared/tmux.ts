/**
 * TmuxPort interface and implementation.
 *
 * All tmux operations are constructed as argv arrays and delegated to a
 * CommandExecutor. No raw shell strings cross this seam. No direct
 * process imports exist in this file — only the executor port.
 */

import type { CommandExecutor } from "./process.js";

/**
 * Configuration for creating a new tmux session.
 */
export interface TmuxSessionConfig {
  /** Session name. */
  name: string;
  /** Working directory for the session. */
  cwd: string;
  /** Command to run in the session. */
  command: string;
  /** Arguments for the command. */
  args: string[];
  /** Whether to create the session detached. */
  detached: boolean;
}

/**
 * Port for all tmux operations. All command construction is internal.
 * No raw strings cross this seam.
 */
export interface TmuxPort {
  /** Check if a tmux session with the given name exists. */
  hasSession(name: string): Promise<boolean>;
  /** Create a new tmux session. */
  newSession(config: TmuxSessionConfig): Promise<void>;
  /** Send keystrokes to a tmux session. */
  sendKeys(session: string, keys: string): Promise<void>;
  /** Kill a tmux session. */
  killSession(session: string): Promise<void>;
  /** Capture pane content from a tmux session. */
  capturePane(session: string, lines?: number): Promise<string>;
  /** List all tmux sessions. */
  listSessions(): Promise<string[]>;
}

/**
 * Creates a TmuxPort backed by a CommandExecutor.
 *
 * @param deps - Injected executor.
 *
 * @returns A TmuxPort where all argv construction is internal.
 *
 * @example
 * ```typescript
 * const tmuxPort = createTmuxPort({ exec: executor });
 * const exists = await tmuxPort.hasSession("worker-1");
 * ```
 */
export function createTmuxPort(deps: { exec: CommandExecutor }): TmuxPort {
  const { exec } = deps;

  return {
    hasSession: (name) =>
      exec.run("tmux", ["has-session", "-t", name]).then((r) => r.exitCode === 0),
    newSession: (config) => buildAndRunNewSession(exec, config),
    sendKeys: (session, keys) =>
      exec.run("tmux", ["send-keys", "-t", session, keys, "Enter"]).then(discardResult),
    killSession: (session) => exec.run("tmux", ["kill-session", "-t", session]).then(discardResult),
    capturePane: (session, lines) => runCapturePane(exec, session, lines),
    listSessions: () => runListSessions(exec),
  };
}

/**
 * Discard a CommandResult value. Used to convert Promise<CommandResult> to Promise<void>.
 *
 * @example
 * ```typescript
 * promise.then(discardResult);
 * ```
 */
function discardResult(): void {
  // Intentionally empty — discards the resolved value.
}

/**
 * Build and execute a tmux new-session command.
 *
 * @param exec - The command executor.
 * @param config - Session configuration.
 *
 * @example
 * ```typescript
 * await buildAndRunNewSession(exec, config);
 * ```
 */
async function buildAndRunNewSession(
  exec: CommandExecutor,
  config: TmuxSessionConfig,
): Promise<void> {
  const args: string[] = ["new-session"];
  if (config.detached) {
    args.push("-d");
  }
  args.push("-s", config.name, "-c", config.cwd, config.command, ...config.args);
  await exec.run("tmux", args);
}

/**
 * Run tmux capture-pane with optional line count.
 *
 * @param exec - The command executor.
 * @param session - Tmux session name.
 * @param lines - Optional number of lines to capture.
 *
 * @returns Captured pane content.
 *
 * @example
 * ```typescript
 * const content = await runCapturePane(exec, "worker-1", 50);
 * ```
 */
async function runCapturePane(
  exec: CommandExecutor,
  session: string,
  lines: number | undefined,
): Promise<string> {
  const args = ["capture-pane", "-t", session, "-p"];
  if (lines !== undefined) {
    args.push("-S", `-${String(lines)}`);
  }
  const result = await exec.run("tmux", args);
  return result.stdout;
}

/**
 * Run tmux list-sessions and parse session names.
 *
 * @param exec - The command executor.
 *
 * @returns Array of session names.
 *
 * @example
 * ```typescript
 * const sessions = await runListSessions(exec);
 * ```
 */
async function runListSessions(exec: CommandExecutor): Promise<string[]> {
  const result = await exec.run("tmux", ["list-sessions", "-F", "#{session_name}"]);
  if (result.exitCode !== 0) {
    return [];
  }
  return result.stdout.trim().split("\n").filter(Boolean);
}
