/**
 * Unit tests for shared/tmux.ts — TmuxPort.
 * Covers AC-5: all methods use CommandExecutor, argv construction is internal.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { createTmuxPort, type TmuxPort } from "../../../src/shared/tmux.js";
import type { CommandExecutor, CommandResult, RunOptions } from "../../../src/shared/process.js";

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
      throw new Error("spawn not expected in tmux port tests");
    },
  };
  return { executor, calls };
}

describe("TmuxPort", () => {
  let port: TmuxPort;
  let calls: RecordedCall[];

  beforeEach(() => {
    const mock = createMockExecutor();
    calls = mock.calls;
    port = createTmuxPort({ exec: mock.executor });
  });

  describe("hasSession", () => {
    it("calls tmux to check session existence", async () => {
      await port.hasSession("my-session");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("tmux");
    });

    it("returns true when session exists (exit 0)", async () => {
      const mock = createMockExecutor({ exitCode: 0 });
      const tmuxPort = createTmuxPort({ exec: mock.executor });
      const exists = await tmuxPort.hasSession("session-1");
      expect(exists).toBe(true);
    });

    it("returns false when session does not exist (exit non-zero)", async () => {
      const mock = createMockExecutor({ exitCode: 1 });
      const tmuxPort = createTmuxPort({ exec: mock.executor });
      const exists = await tmuxPort.hasSession("nonexistent");
      expect(exists).toBe(false);
    });
  });

  describe("newSession", () => {
    it("calls tmux new-session with config", async () => {
      await port.newSession({
        name: "worker-1",
        cwd: "/tmp/worktree",
        command: "pi",
        args: ["--extension", "pi-bmad.ts"],
        detached: true,
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("tmux");
      expect(calls[0]!.args).toContain("new-session");
    });
  });

  describe("sendKeys", () => {
    it("calls tmux send-keys with session and keys", async () => {
      await port.sendKeys("worker-1", "echo hello");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("tmux");
      expect(calls[0]!.args).toContain("send-keys");
    });
  });

  describe("killSession", () => {
    it("calls tmux kill-session", async () => {
      await port.killSession("worker-1");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("tmux");
      expect(calls[0]!.args).toContain("kill-session");
    });
  });

  describe("capturePane", () => {
    it("calls tmux capture-pane and returns content", async () => {
      const mock = createMockExecutor({ stdout: "captured output\n" });
      const tmuxPort = createTmuxPort({ exec: mock.executor });
      const content = await tmuxPort.capturePane("worker-1");
      expect(content).toBe("captured output\n");
      expect(mock.calls[0]!.command).toBe("tmux");
    });

    it("accepts optional line count", async () => {
      await port.capturePane("worker-1", 50);
      expect(calls).toHaveLength(1);
    });
  });

  describe("listSessions", () => {
    it("calls tmux list-sessions with -F format and returns parsed session names", async () => {
      // Mock data matches -F "#{session_name}" output format (bare names)
      const mock = createMockExecutor({
        stdout: "worker-1\nworker-2\n",
      });
      const tmuxPort = createTmuxPort({ exec: mock.executor });
      const sessions = await tmuxPort.listSessions();
      expect(sessions).toEqual(["worker-1", "worker-2"]);
      expect(mock.calls[0]!.command).toBe("tmux");
      expect(mock.calls[0]!.args).toContain("-F");
      expect(mock.calls[0]!.args).toContain("#{session_name}");
    });

    it("returns empty array when tmux exits non-zero", async () => {
      const mock = createMockExecutor({ exitCode: 1, stdout: "" });
      const tmuxPort = createTmuxPort({ exec: mock.executor });
      const sessions = await tmuxPort.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("all methods use executor — no direct child_process", () => {
    it("every method produces executor.run('tmux', ...) calls", async () => {
      const mock = createMockExecutor({
        stdout: "session: 1 windows\n",
      });
      const tmuxPort = createTmuxPort({ exec: mock.executor });

      await tmuxPort.hasSession("s");
      await tmuxPort.newSession({
        name: "s",
        cwd: "/tmp",
        command: "pi",
        args: [],
        detached: true,
      });
      await tmuxPort.sendKeys("s", "key");
      await tmuxPort.killSession("s");
      await tmuxPort.capturePane("s");
      await tmuxPort.listSessions();

      // All calls should be to 'tmux'
      for (const call of mock.calls) {
        expect(call.command).toBe("tmux");
      }
      // 6 methods => 6 calls
      expect(mock.calls).toHaveLength(6);
    });
  });
});
