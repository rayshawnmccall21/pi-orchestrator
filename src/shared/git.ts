/**
 * GitPort interface and implementation.
 *
 * All git operations are constructed as argv arrays and delegated to a
 * CommandExecutor. No raw shell strings cross this seam. No direct
 * process imports exist in this file — only the executor port.
 */

import type { CommandExecutor, CommandResult } from "./process.js";

/**
 * A parsed entry from git worktree list.
 */
export interface GitWorktreeEntry {
  /** Absolute path to the worktree directory. */
  path: string;
  /** Branch name checked out in the worktree. */
  branch: string;
  /** Whether the worktree is locked. */
  locked: boolean;
  /** Lock reason, or null if not locked. */
  lockReason: string | null;
}

/**
 * Result of a git merge operation.
 */
export interface MergeResult {
  /** Whether the merge completed without conflicts. */
  success: boolean;
  /** File paths that have merge conflicts. */
  conflictFiles: string[];
  /** File paths that were successfully merged. */
  mergedFiles: string[];
}

/**
 * Port for all git operations. All command construction is internal.
 * No raw strings cross this seam.
 */
export interface GitPort {
  /** Add a new worktree at the given path for the given branch. */
  worktreeAdd(path: string, branch: string, base: string): Promise<void>;
  /** Lock a worktree with a reason. */
  worktreeLock(path: string, reason: string): Promise<void>;
  /** Unlock a worktree. */
  worktreeUnlock(path: string): Promise<void>;
  /** Remove a worktree. */
  worktreeRemove(path: string, force?: boolean): Promise<void>;
  /** List all worktrees. */
  worktreeList(): Promise<GitWorktreeEntry[]>;
  /** Check if a branch exists. */
  branchExists(name: string): Promise<boolean>;
  /** Create a branch from a base. */
  branchCreate(name: string, base: string): Promise<void>;
  /** Delete a branch. */
  branchDelete(name: string, force?: boolean): Promise<void>;
  /** Merge a branch into another branch. */
  merge(branch: string, into: string): Promise<MergeResult>;
  /** Get the name of the current branch. */
  currentBranch(): Promise<string>;
  /** Get files changed between two branches. */
  changedFiles(branch: string, base: string): Promise<string[]>;
}

/** Helper to run git commands through the executor. */
type GitRunner = (...args: string[]) => Promise<CommandResult>;

/**
 * Creates a GitPort backed by a CommandExecutor.
 *
 * @param deps - Injected executor and working directory.
 *
 * @returns A GitPort where all argv construction is internal.
 *
 * @example
 * ```typescript
 * const gitPort = createGitPort({ exec: executor, cwd: "/repo" });
 * await gitPort.worktreeAdd("/path", "branch", "main");
 * ```
 */
export function createGitPort(deps: { exec: CommandExecutor; cwd: string }): GitPort {
  const runGit: GitRunner = (...args) => deps.exec.run("git", args, { cwd: deps.cwd });

  return {
    worktreeAdd: (worktreePath, branch, base) =>
      runGit("worktree", "add", "-b", branch, worktreePath, base).then(discardResult),
    worktreeLock: (worktreePath, reason) =>
      runGit("worktree", "lock", "--reason", reason, worktreePath).then(discardResult),
    worktreeUnlock: (worktreePath) =>
      runGit("worktree", "unlock", worktreePath).then(discardResult),
    worktreeRemove: (worktreePath, force) => runGitWorktreeRemove(runGit, worktreePath, force),
    worktreeList: () =>
      runGit("worktree", "list", "--porcelain").then((r) => parseWorktreeListPorcelain(r.stdout)),
    branchExists: (name) =>
      runGit("rev-parse", "--verify", `refs/heads/${name}`).then((r) => r.exitCode === 0),
    branchCreate: (name, base) => runGit("branch", name, base).then(discardResult),
    branchDelete: (name, force) =>
      runGit("branch", force === true ? "-D" : "-d", name).then(discardResult),
    merge: (branch, into) => executeMerge(runGit, branch, into),
    currentBranch: () => runGit("rev-parse", "--abbrev-ref", "HEAD").then((r) => r.stdout.trim()),
    changedFiles: (branch, base) =>
      runGit("diff", "--name-only", base, branch).then((r) => splitLines(r.stdout)),
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
 * Run git worktree remove with optional force flag.
 *
 * @param runGit - Git command runner.
 * @param worktreePath - Path to the worktree to remove.
 * @param force - Whether to force removal.
 *
 * @example
 * ```typescript
 * await runGitWorktreeRemove(runGit, "/path/to/wt", true);
 * ```
 */
async function runGitWorktreeRemove(
  runGit: GitRunner,
  worktreePath: string,
  force?: boolean,
): Promise<void> {
  const args = ["worktree", "remove"];
  if (force === true) {
    args.push("--force");
  }
  args.push(worktreePath);
  await runGit(...args);
}

/**
 * Execute a git merge and return structured result.
 *
 * @param runGit - Function to execute git commands.
 * @param branch - Branch to merge from.
 * @param into - Branch to merge into.
 *
 * @returns Structured merge result.
 *
 * @example
 * ```typescript
 * const result = await executeMerge(runGit, "feature", "main");
 * ```
 */
async function executeMerge(runGit: GitRunner, branch: string, into: string): Promise<MergeResult> {
  await runGit("checkout", into);
  const mergeResult = await runGit("merge", "--no-edit", branch);

  if (mergeResult.exitCode === 0) {
    const diffResult = await runGit("diff", "--name-only", "HEAD~1", "HEAD");
    return { success: true, conflictFiles: [], mergedFiles: splitLines(diffResult.stdout) };
  }

  const conflictResult = await runGit("diff", "--name-only", "--diff-filter=U");
  const conflictFiles = splitLines(conflictResult.stdout);

  // Abort the merge so the repository is not left in a dirty conflict state.
  await runGit("merge", "--abort");

  return { success: false, conflictFiles, mergedFiles: [] };
}

/**
 * Split trimmed output into non-empty lines.
 *
 * @param output - Raw command output.
 *
 * @returns Array of non-empty lines.
 *
 * @example
 * ```typescript
 * const lines = splitLines("a\nb\n");
 * ```
 */
function splitLines(output: string): string[] {
  return output.trim().split("\n").filter(Boolean);
}

/**
 * Parse git worktree list porcelain output into structured entries.
 *
 * @param output - Raw porcelain output from git worktree list.
 *
 * @returns Parsed worktree entries.
 *
 * @example
 * ```typescript
 * const entries = parseWorktreeListPorcelain(output);
 * ```
 */
function parseWorktreeListPorcelain(output: string): GitWorktreeEntry[] {
  if (!output.trim()) {
    return [];
  }
  return output
    .trim()
    .split("\n\n")
    .map((block) => parseWorktreeBlock(block))
    .filter((entry): entry is GitWorktreeEntry => entry !== undefined);
}

/**
 * Parse a single porcelain block into a worktree entry.
 *
 * @param block - A single porcelain block (lines separated by newline).
 *
 * @returns A GitWorktreeEntry or undefined if the block is invalid.
 *
 * @example
 * ```typescript
 * const entry = parseWorktreeBlock("worktree /repo\nbranch refs/heads/main");
 * ```
 */
function parseWorktreeBlock(block: string): GitWorktreeEntry | undefined {
  const lines = block.trim().split("\n");
  let worktreePath = "";
  let branch = "";
  let locked = false;
  let lockReason: string | null = null;

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const fullRef = line.slice("branch ".length);
      branch = fullRef.startsWith("refs/heads/") ? fullRef.slice("refs/heads/".length) : fullRef;
    } else if (line === "locked") {
      locked = true;
    } else if (line.startsWith("locked ")) {
      locked = true;
      lockReason = line.slice("locked ".length);
    }
  }

  if (!worktreePath) {
    return undefined;
  }
  return { path: worktreePath, branch, locked, lockReason };
}
