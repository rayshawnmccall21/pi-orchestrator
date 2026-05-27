/**
 * Tests for extension/index.ts — the Pi extension entry point.
 *
 * Covers AC-4 (hooks registration, prompt hot-reload, shutdown disposal)
 * and AC-5 (no legacy root type imports).
 */

import { describe, it, expect, vi } from "vitest";
import registerExtension from "../../../src/extension/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Pi ExtensionAPI
// ═══════════════════════════════════════════════════════════════════════════

interface MockHookRegistration {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

interface MockCommandRegistration {
  name: string;
  options: Record<string, unknown>;
}

interface MockToolRegistration {
  tool: Record<string, unknown>;
}

function createMockExtensionAPI() {
  const hookRegistrations: MockHookRegistration[] = [];
  const commandRegistrations: MockCommandRegistration[] = [];
  const toolRegistrations: MockToolRegistration[] = [];

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      hookRegistrations.push({ event, handler });
    }),
    registerCommand: vi.fn((name: string, options: Record<string, unknown>) => {
      commandRegistrations.push({ name, options });
    }),
    registerTool: vi.fn((tool: Record<string, unknown>) => {
      toolRegistrations.push({ tool });
    }),
    hookRegistrations,
    commandRegistrations,
    toolRegistrations,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("extension/index.ts", () => {
  describe("hook registration (AC-4)", () => {
    it("registers a session_start hook", () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      const sessionStartHooks = mockApi.hookRegistrations.filter(
        (registration) => registration.event === "session_start",
      );
      expect(sessionStartHooks.length).toBeGreaterThanOrEqual(1);
    });

    it("registers a before_agent_start hook for prompt hot-reload", () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      const beforeAgentHooks = mockApi.hookRegistrations.filter(
        (registration) => registration.event === "before_agent_start",
      );
      expect(beforeAgentHooks.length).toBeGreaterThanOrEqual(1);
    });

    it("registers a session_shutdown hook for disposal", () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      const shutdownHooks = mockApi.hookRegistrations.filter(
        (registration) => registration.event === "session_shutdown",
      );
      expect(shutdownHooks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("command and tool registration (AC-4)", () => {
    it("registers at least one slash command", () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      expect(mockApi.commandRegistrations.length).toBeGreaterThanOrEqual(1);
    });

    it("registers the orchestrate tool", () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      expect(mockApi.toolRegistrations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("extension entry signature (AC-5)", () => {
    it("default export is a function", () => {
      expect(typeof registerExtension).toBe("function");
    });

    it("accepts a Pi ExtensionAPI parameter and does not throw", () => {
      const mockApi = createMockExtensionAPI();
      expect(() => {
        registerExtension(mockApi);
      }).not.toThrow();
    });
  });

  describe("prompt hot-reload behavior", () => {
    it("before_agent_start handler returns an object with systemPrompt", async () => {
      const mockApi = createMockExtensionAPI();
      registerExtension(mockApi);
      const beforeAgentHook = mockApi.hookRegistrations.find(
        (registration) => registration.event === "before_agent_start",
      );
      expect(beforeAgentHook).toBeDefined();
      const hookResult = await beforeAgentHook!.handler({}, { cwd: "/project" });
      expect(hookResult).toHaveProperty("systemPrompt");
      const hookResultRecord = hookResult as Record<string, unknown>;
      expect(typeof hookResultRecord["systemPrompt"]).toBe("string");
    });
  });
});
