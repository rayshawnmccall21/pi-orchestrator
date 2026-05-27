/**
 * Unit tests for shared/process.ts — CommandExecutor.
 * Covers AC-4: argv-only run/spawn, no shell interpolation.
 */

import { describe, it, expect } from "vitest";

import { createCommandExecutor } from "../../../src/shared/process.js";

describe("CommandExecutor", () => {
  describe("run", () => {
    it("executes a command and returns stdout", async () => {
      const executor = createCommandExecutor();
      const result = await executor.run("echo", ["hello"]);
      expect(result.stdout.trim()).toBe("hello");
      expect(result.exitCode).toBe(0);
    });

    it("returns stderr from failed commands", async () => {
      const executor = createCommandExecutor();
      const result = await executor.run("ls", ["/nonexistent-path-that-should-not-exist-abc123"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });

    it("accepts command and args as separate values — no shell interpolation", async () => {
      const executor = createCommandExecutor();
      // Shell metacharacters should be treated as literal strings
      const result = await executor.run("echo", ["hello; rm -rf /", "$(whoami)"]);
      // The stdout should contain the literal metacharacters, not expanded
      expect(result.stdout).toContain("hello; rm -rf /");
      expect(result.stdout).toContain("$(whoami)");
      expect(result.exitCode).toBe(0);
    });

    it("passes cwd option to the subprocess", async () => {
      const executor = createCommandExecutor();
      const result = await executor.run("pwd", [], { cwd: "/tmp" });
      // macOS /tmp -> /private/tmp
      expect(result.stdout.trim() === "/tmp" || result.stdout.trim() === "/private/tmp").toBe(true);
    });

    it("passes env option to the subprocess", async () => {
      const executor = createCommandExecutor();
      const result = await executor.run("env", [], {
        env: { TEST_ORCH_VAR: "test-value-123" },
      });
      expect(result.stdout).toContain("TEST_ORCH_VAR=test-value-123");
    });

    it("rejects with error for nonexistent commands", async () => {
      const executor = createCommandExecutor();
      await expect(executor.run("nonexistent-command-xyz-999", [])).rejects.toThrow();
    });
  });

  describe("spawn", () => {
    it("returns a ChildHandle with pid", () => {
      const executor = createCommandExecutor();
      const handle = executor.spawn("sleep", ["0.1"]);
      expect(handle.pid).toBeGreaterThan(0);
      handle.kill();
    });

    it("calls onStdout callback with output", async () => {
      const executor = createCommandExecutor();
      const chunks: string[] = [];

      const handle = executor.spawn("echo", ["spawn-output"], {
        onStdout: (chunk) => chunks.push(chunk),
      });

      // Wait for process to finish
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          // Try kill; if already dead it's fine
          try {
            process.kill(handle.pid, 0);
          } catch {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
      });

      expect(chunks.join("")).toContain("spawn-output");
    });

    it("calls onExit callback when process terminates", async () => {
      const executor = createCommandExecutor();
      let exitCode: number | undefined;

      executor.spawn("echo", ["done"], {
        onExit: (code) => {
          exitCode = code;
        },
      });

      // Wait for exit
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      expect(exitCode).toBe(0);
    });

    it("calls onError callback when command binary does not exist", async () => {
      const executor = createCommandExecutor();
      let spawnError: Error | undefined;

      executor.spawn("nonexistent-binary-xyz-999", ["arg"], {
        onError: (error) => {
          spawnError = error;
        },
      });

      // Wait for error event
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      expect(spawnError).toBeDefined();
      // Bun says "Executable not found in $PATH", Node says "ENOENT"
      expect(
        spawnError!.message.includes("ENOENT") || spawnError!.message.includes("not found"),
      ).toBe(true);
    });

    it("does not crash the process when spawn fails without onError callback", async () => {
      const executor = createCommandExecutor();

      // This should NOT throw an unhandled error — the default handler logs to stderr
      executor.spawn("nonexistent-binary-xyz-999", ["arg"]);

      // Wait for error event to be handled
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      // If we reach here, the process didn't crash
      expect(true).toBe(true);
    });

    it("kill terminates the spawned process", async () => {
      const executor = createCommandExecutor();
      const handle = executor.spawn("sleep", ["60"]);
      const pid = handle.pid;
      handle.kill();

      // Wait briefly for kill to take effect
      await new Promise<void>((resolve) => setTimeout(resolve, 200));

      // Process should be dead
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  describe("interface safety", () => {
    it("run accepts (command, args[]) signature — not shell strings", () => {
      const executor = createCommandExecutor();
      // TypeScript compile-time check: run takes string + string[]
      // At runtime, verify the function exists with the right arity
      expect(typeof executor.run).toBe("function");
      expect(typeof executor.spawn).toBe("function");
    });
  });
});
