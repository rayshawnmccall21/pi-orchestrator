/**
 * Unit tests for shared/git.ts — GitPort.
 * Covers AC-5: all methods use CommandExecutor, argv construction is internal,
 * and unit tests verify command/args with a mock executor.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { createGitPort, type GitPort } from "../../../src/shared/git.js";
import type { CommandExecutor, CommandResult, RunOptions } from "../../../src/shared/process.js";

/** Records every call made to the executor for verification. */
interface RecordedCall {
  command: string;
  args: string[];
  opts: RunOptions | undefined;
}

function createMockExecutor(defaultResult: Partial<CommandResult> = {}): {
  executor: CommandExecutor;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const executor: CommandExecutor = {
    async run(command, args, opts) {
      calls.push({ command, args, opts });
      return {
        stdout: defaultResult.stdout ?? "",
        stderr: defaultResult.stderr ?? "",
        exitCode: defaultResult.exitCode ?? 0,
      };
    },
    spawn() {
      throw new Error("spawn not expected in git port tests");
    },
  };
  return { executor, calls };
}

describe("GitPort", () => {
  let port: GitPort;
  let calls: RecordedCall[];

  beforeEach(() => {
    const mock = createMockExecutor();
    calls = mock.calls;
    port = createGitPort({ exec: mock.executor, cwd: "/test/repo" });
  });

  describe("worktreeAdd", () => {
    it("calls git with worktree add arguments", async () => {
      await port.worktreeAdd("/path/to/wt", "feature-branch", "main");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toContain("worktree");
      expect(calls[0]!.args).toContain("add");
      expect(calls[0]!.args).toContain("/path/to/wt");
    });
  });

  describe("worktreeLock", () => {
    it("calls git worktree lock with reason", async () => {
      await port.worktreeLock("/path/to/wt", "locked by orchestrator");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toContain("worktree");
      expect(calls[0]!.args).toContain("lock");
    });

    it("passes user data as a single argv element — no interpolation", async () => {
      await port.worktreeLock("/path", "reason with $(whoami) and; rm -rf /");
      expect(calls).toHaveLength(1);
      // The reason must be a single element in the args array
      const reasonArg = calls[0]!.args.find((arg) => arg.includes("$(whoami)"));
      expect(reasonArg).toBeDefined();
      // It should NOT be split at spaces
      expect(reasonArg).toContain("rm -rf /");
    });
  });

  describe("worktreeUnlock", () => {
    it("calls git worktree unlock", async () => {
      await port.worktreeUnlock("/path/to/wt");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toContain("unlock");
    });
  });

  describe("worktreeRemove", () => {
    it("calls git worktree remove", async () => {
      await port.worktreeRemove("/path/to/wt");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toContain("remove");
    });

    it("passes force flag when requested", async () => {
      await port.worktreeRemove("/path/to/wt", true);
      expect(calls[0]!.args).toContain("--force");
    });
  });

  describe("worktreeList", () => {
    it("calls git worktree list and parses output", async () => {
      const mock = createMockExecutor({
        stdout: [
          "worktree /repo",
          "HEAD abc1234",
          "branch refs/heads/main",
          "",
          "worktree /repo/.trees/worker-1",
          "HEAD def5678",
          "branch refs/heads/worker/sess-1",
          "",
        ].join("\n"),
      });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const entries = await gitPort.worktreeList();
      expect(mock.calls[0]!.command).toBe("git");
      expect(mock.calls[0]!.args).toContain("worktree");
      expect(mock.calls[0]!.args).toContain("list");
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("branchExists", () => {
    it("calls git to check branch existence", async () => {
      await port.branchExists("feature-branch");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
    });

    it("returns true when branch exists (exit 0)", async () => {
      const mock = createMockExecutor({ exitCode: 0 });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const exists = await gitPort.branchExists("main");
      expect(exists).toBe(true);
    });

    it("returns false when branch does not exist (exit non-zero)", async () => {
      const mock = createMockExecutor({ exitCode: 1 });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const exists = await gitPort.branchExists("nonexistent");
      expect(exists).toBe(false);
    });
  });

  describe("branchCreate", () => {
    it("calls git branch create with base", async () => {
      await port.branchCreate("new-branch", "main");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
      expect(calls[0]!.args).toContain("new-branch");
    });
  });

  describe("branchDelete", () => {
    it("calls git branch delete", async () => {
      await port.branchDelete("old-branch");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("git");
    });

    it("passes force flag when requested", async () => {
      await port.branchDelete("old-branch", true);
      expect(calls[0]!.args).toContain("-D");
    });
  });

  describe("merge", () => {
    it("calls git merge and returns result", async () => {
      const mock = createMockExecutor({ exitCode: 0, stdout: "" });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const result = await gitPort.merge("feature", "main");
      expect(result.success).toBe(true);
      expect(mock.calls.length).toBeGreaterThanOrEqual(1);
      const hasMergeCall = mock.calls.some((c) => c.args.includes("merge"));
      expect(hasMergeCall).toBe(true);
    });

    it("aborts merge and returns conflict files on failure", async () => {
      let callIndex = 0;
      const responses: Partial<CommandResult>[] = [
        { exitCode: 0, stdout: "", stderr: "" }, // checkout into
        { exitCode: 1, stdout: "", stderr: "CONFLICT" }, // merge --no-edit
        { exitCode: 0, stdout: "src/conflict.ts\n", stderr: "" }, // diff --name-only --diff-filter=U
        { exitCode: 0, stdout: "", stderr: "" }, // merge --abort
      ];
      const calls: RecordedCall[] = [];
      const executor: CommandExecutor = {
        async run(command, args, opts) {
          calls.push({ command, args, opts });
          const response = responses[callIndex] ?? { exitCode: 0, stdout: "", stderr: "" };
          callIndex++;
          return {
            stdout: response.stdout ?? "",
            stderr: response.stderr ?? "",
            exitCode: response.exitCode ?? 0,
          };
        },
        spawn() {
          throw new Error("spawn not expected");
        },
      };
      const gitPort = createGitPort({ exec: executor, cwd: "/test/repo" });
      const result = await gitPort.merge("feature", "main");

      expect(result.success).toBe(false);
      expect(result.conflictFiles).toEqual(["src/conflict.ts"]);

      // Verify merge --abort was called (the 4th call)
      const abortCall = calls.find((c) => c.args.includes("merge") && c.args.includes("--abort"));
      expect(abortCall).toBeDefined();
      expect(abortCall!.command).toBe("git");
    });
  });

  describe("currentBranch", () => {
    it("calls git to get current branch name", async () => {
      const mock = createMockExecutor({ stdout: "main\n" });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const branch = await gitPort.currentBranch();
      expect(branch).toBe("main");
    });
  });

  describe("changedFiles", () => {
    it("calls git diff and returns file list", async () => {
      const mock = createMockExecutor({
        stdout: "src/a.ts\nsrc/b.ts\n",
      });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });
      const files = await gitPort.changedFiles("feature", "main");
      expect(files).toEqual(["src/a.ts", "src/b.ts"]);
    });
  });

  describe("all methods use executor — no direct child_process", () => {
    it("every method produces executor.run('git', ...) calls", async () => {
      // Create a port that records
      const mock = createMockExecutor({
        stdout: "/repo abc1234 [main]\n",
      });
      const gitPort = createGitPort({
        exec: mock.executor,
        cwd: "/test/repo",
      });

      await gitPort.worktreeAdd("/p", "b", "main");
      await gitPort.worktreeLock("/p", "reason");
      await gitPort.worktreeUnlock("/p");
      await gitPort.worktreeRemove("/p");
      await gitPort.worktreeList();
      await gitPort.branchExists("b");
      await gitPort.branchCreate("b", "main");
      await gitPort.branchDelete("b");
      await gitPort.merge("b", "main");
      await gitPort.currentBranch();
      await gitPort.changedFiles("b", "main");

      // All calls should be to 'git'
      for (const call of mock.calls) {
        expect(call.command).toBe("git");
      }
      // Should have >= 11 calls (one per method, merge may need multiple)
      expect(mock.calls.length).toBeGreaterThanOrEqual(11);
    });
  });
});
