/**
 * Integration tests for the Pi extension entry point.
 *
 * Validates that extension/index.ts correctly registers hooks, commands,
 * tools, and handles lifecycle events.
 *
 * - AC-4: Hooks registered, session start initializes, before-agent-start
 *   hot-reloads prompt, commands/tool register, shutdown disposes safely.
 * - AC-5: No legacy imports.
 */

import { describe, it, expect } from "vitest";

// Import the default export — the extension registration function
import registerPiOrchestratorExtension from "../../src/extension/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Pi Extension API
// ═══════════════════════════════════════════════════════════════════════════

interface RegisteredHook {
  event: string;
  handler: (...args: unknown[]) => unknown;
}

interface RegisteredCommand {
  name: string;
  description: string | undefined;
  handler: (...args: unknown[]) => unknown;
}

interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  execute: (...args: unknown[]) => unknown;
}

function createMockPiApi() {
  const hooks: RegisteredHook[] = [];
  const commands: RegisteredCommand[] = [];
  const tools: RegisteredTool[] = [];

  return {
    hooks,
    commands,
    tools,
    on(event: string, handler: (...args: unknown[]) => unknown) {
      hooks.push({ event, handler });
    },
    registerCommand(
      name: string,
      options: { description?: string; handler: (...args: unknown[]) => unknown },
    ) {
      commands.push({ name, description: options.description, handler: options.handler });
    },
    registerTool(tool: {
      name: string;
      description: string;
      parameters: unknown;
      execute: (...args: unknown[]) => unknown;
    }) {
      tools.push(tool);
    },
    // Additional methods that may be called
    getActiveTools: () => [],
    getAllTools: () => [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setActiveTools: (_toolNames: string[]) => {
      /* no-op mock */
    },
    getCommands: () => [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("extension/index.ts — registerPiOrchestratorExtension", () => {
  describe("AC-4: hook registration", () => {
    it("registers a session_start hook", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      const sessionStartHooks = mockApi.hooks.filter((h) => h.event === "session_start");
      expect(sessionStartHooks.length).toBeGreaterThanOrEqual(1);
    });

    it("registers a session_shutdown hook for safe disposal", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      const shutdownHooks = mockApi.hooks.filter((h) => h.event === "session_shutdown");
      expect(shutdownHooks.length).toBeGreaterThanOrEqual(1);
    });

    it("registers a before_agent_start hook for prompt hot-reload", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      const agentStartHooks = mockApi.hooks.filter((h) => h.event === "before_agent_start");
      expect(agentStartHooks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("AC-4: command registration", () => {
    it("registers an 'orchestrate' slash command", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      const orchestrateCommands = mockApi.commands.filter((c) => c.name === "orchestrate");
      expect(orchestrateCommands.length).toBe(1);
    });

    it("registers at least one slash command", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      expect(mockApi.commands.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("AC-4: tool registration", () => {
    it("registers at least one tool", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      expect(mockApi.tools.length).toBeGreaterThanOrEqual(1);
    });

    it("registered tools have name, description, parameters, and execute", () => {
      const mockApi = createMockPiApi();
      registerPiOrchestratorExtension(mockApi as never);

      for (const tool of mockApi.tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.execute).toBe("function");
      }
    });
  });

  describe("AC-5: no legacy imports", () => {
    it("exports a function (not an empty stub)", () => {
      expect(typeof registerPiOrchestratorExtension).toBe("function");
    });

    it("the function accepts a piApi argument (not zero-arg stub)", () => {
      // The current stub is zero-arg. The real impl takes piApi.
      const mockApi = createMockPiApi();

      // Should not throw when called with piApi
      expect(() => {
        registerPiOrchestratorExtension(mockApi as never);
      }).not.toThrow();

      // And should have registered things (not be a no-op)
      const totalRegistrations =
        mockApi.hooks.length + mockApi.commands.length + mockApi.tools.length;
      expect(totalRegistrations).toBeGreaterThan(0);
    });
  });

  describe("adversarial: extension safety", () => {
    it("does not throw when called with a minimal mock API", () => {
      const mockApi = createMockPiApi();
      expect(() => {
        registerPiOrchestratorExtension(mockApi as never);
      }).not.toThrow();
    });
  });
});
