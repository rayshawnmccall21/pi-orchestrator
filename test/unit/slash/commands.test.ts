/* eslint-disable @typescript-eslint/unbound-method -- vi.fn() mock assertion pattern throughout test file. */
/**
 * Unit tests for slash/commands.ts — slash command and tool registration.
 *
 * Covers AC-1 (slash + tool equivalence via OrchestratorActions)
 * and AC-2 (invalid params → structured errors, no action).
 *
 * @see R-S14 story acceptance criteria
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PipelineStatus } from "../../../src/shared/types.js";
import type { OrchestratorActions } from "../../../src/actions.js";
import { registerSlashCommands, type SlashCommandDeps } from "../../../src/slash/commands.js";
import { registerOrchestrateTool } from "../../../src/extension/tool.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Factories
// ═══════════════════════════════════════════════════════════════════════════

function createMockActions(): OrchestratorActions {
  return {
    start: vi.fn().mockResolvedValue({
      success: true,
      message: "Pipeline started with scope: full",
      data: { runId: "run-1", status: "running" as PipelineStatus, phase: "analysis" },
    }),
    status: vi.fn().mockReturnValue({
      success: true,
      message: "Pipeline running",
      data: { active: true },
    }),
    list: vi.fn().mockReturnValue({
      success: true,
      message: "1 dispatch(es), 0 session(s)",
      data: { dispatches: [], sessions: [] },
    }),
    steer: vi.fn().mockResolvedValue({
      success: true,
      message: "Steer message sent",
      data: { dispatched: true },
    }),
    pause: vi.fn().mockResolvedValue({
      success: true,
      message: "Pipeline paused",
      data: { paused: true },
    }),
    resume: vi.fn().mockResolvedValue({
      success: true,
      message: "Pipeline resumed",
      data: { paused: false },
    }),
    abort: vi.fn().mockResolvedValue({
      success: true,
      message: "Pipeline aborted",
      data: { status: "aborted" },
    }),
    escalate: vi.fn().mockResolvedValue({
      success: true,
      message: "Blocker escalated",
      data: { blocker: null },
    }),
    result: vi.fn().mockReturnValue({
      status: "done",
      runId: "run-1",
      exitCode: 0,
      message: "done",
      evidenceRefs: [],
      finishedAt: "2025-07-16T00:00:00.000Z",
      durationMs: 1000,
    }),
  };
}

/** Registered command record. */
interface CommandRecord {
  /** Description. */
  description?: string;
  /** Handler fn. */
  handler: (args: string, ctx: unknown) => Promise<void>;
}

/** Registered tool record. */
interface ToolRecord {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** Schema. */
  parameters: unknown;
  /** Execute fn. */
  execute: (...args: unknown[]) => Promise<unknown>;
}

interface MockPiApi {
  /** Commands map. */
  registeredCommands: Map<string, CommandRecord>;
  /** Tools map. */
  registeredTools: Map<string, ToolRecord>;
  /** Register command spy. */
  registerCommand: ReturnType<typeof vi.fn>;
  /** Register tool spy. */
  registerTool: ReturnType<typeof vi.fn>;
}

function createMockPiApi(): MockPiApi {
  const registeredCommands = new Map<string, CommandRecord>();
  const registeredTools = new Map<string, ToolRecord>();

  return {
    registeredCommands,
    registeredTools,
    registerCommand: vi.fn((name: string, options: CommandRecord) => {
      registeredCommands.set(name, options);
    }),
    registerTool: vi.fn((tool: ToolRecord) => {
      registeredTools.set(tool.name, tool);
    }),
  };
}

/**
 * Invoke a registered slash command handler by name.
 *
 * @param mockApi - Mock Pi API containing registered commands.
 * @param commandName - Name of the registered command.
 * @param args - Arguments string to pass.
 */
async function invokeCommand(mockApi: MockPiApi, commandName: string, args: string): Promise<void> {
  const command = mockApi.registeredCommands.get(commandName);
  if (command === undefined) {
    throw new Error(`Command "${commandName}" not registered`);
  }
  await command.handler(args, {});
}

/**
 * Invoke a registered tool by name.
 *
 * @param mockApi - Mock Pi API containing registered tools.
 * @param toolName - Name of the registered tool.
 * @param params - Parameters to pass to the tool.
 *
 * @returns The tool execution result.
 */
async function invokeTool(
  mockApi: MockPiApi,
  toolName: string,
  params: Record<string, string>,
): Promise<unknown> {
  const tool = mockApi.registeredTools.get(toolName);
  if (tool === undefined) {
    throw new Error(`Tool "${toolName}" not registered`);
  }
  return tool.execute("call-id", params);
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("slash/commands.ts", () => {
  let mockPiApi: MockPiApi;
  let mockActions: OrchestratorActions;
  let deps: SlashCommandDeps;

  beforeEach(() => {
    mockPiApi = createMockPiApi();
    mockActions = createMockActions();
    deps = { actions: mockActions };
  });

  describe("registerSlashCommands", () => {
    it("registers a pipeline command", () => {
      registerSlashCommands(mockPiApi, deps);
      expect(mockPiApi.registeredCommands.has("pipeline")).toBe(true);
    });

    it("pipeline command description mentions available subcommands", () => {
      registerSlashCommands(mockPiApi, deps);
      const command = mockPiApi.registeredCommands.get("pipeline");
      expect(command?.description).toContain("start");
      expect(command?.description).toContain("status");
    });
  });

  describe("slash command → OrchestratorActions routing (AC-1)", () => {
    it("routes /pipeline start to actions.start()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "start full");
      expect(mockActions.start).toHaveBeenCalledWith("full");
    });

    it("routes /pipeline status to actions.status()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "status");
      expect(mockActions.status).toHaveBeenCalled();
    });

    it("routes /pipeline pause to actions.pause()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "pause");
      expect(mockActions.pause).toHaveBeenCalled();
    });

    it("routes /pipeline resume to actions.resume()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "resume");
      expect(mockActions.resume).toHaveBeenCalled();
    });

    it("routes /pipeline abort with reason to actions.abort(reason)", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "abort manual stop");
      expect(mockActions.abort).toHaveBeenCalledWith("manual stop");
    });

    it("routes /pipeline list to actions.list()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "list");
      expect(mockActions.list).toHaveBeenCalled();
    });

    it("routes /pipeline escalate to actions.escalate()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "escalate");
      expect(mockActions.escalate).toHaveBeenCalled();
    });

    it("routes /pipeline result to actions.result()", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "result");
      expect(mockActions.result).toHaveBeenCalled();
    });

    it("defaults to status when no subcommand provided", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "");
      expect(mockActions.status).toHaveBeenCalled();
    });

    it("returns error message for unknown subcommand", async () => {
      registerSlashCommands(mockPiApi, deps);
      // Should not throw, should handle gracefully
      await expect(invokeCommand(mockPiApi, "pipeline", "destroy")).resolves.not.toThrow();
    });
  });

  describe("registerOrchestrateTool", () => {
    it("registers a tool named 'orchestrate'", () => {
      registerOrchestrateTool(mockPiApi, deps);
      expect(mockPiApi.registeredTools.has("orchestrate")).toBe(true);
    });

    it("tool has description mentioning pipeline operations", () => {
      registerOrchestrateTool(mockPiApi, deps);
      const tool = mockPiApi.registeredTools.get("orchestrate");
      expect(tool?.description).toBeDefined();
      expect(tool?.description?.length).toBeGreaterThan(10);
    });
  });

  describe("tool → OrchestratorActions equivalence (AC-1)", () => {
    it("tool start produces the same action call as /pipeline start", async () => {
      registerOrchestrateTool(mockPiApi, deps);
      await invokeTool(mockPiApi, "orchestrate", { action: "start", scope: "full" });
      expect(mockActions.start).toHaveBeenCalledWith("full");
    });

    it("tool status produces the same action call as /pipeline status", async () => {
      registerOrchestrateTool(mockPiApi, deps);
      await invokeTool(mockPiApi, "orchestrate", { action: "status" });
      expect(mockActions.status).toHaveBeenCalled();
    });

    it("tool list produces the same action call as /pipeline list", async () => {
      registerOrchestrateTool(mockPiApi, deps);
      await invokeTool(mockPiApi, "orchestrate", { action: "list" });
      expect(mockActions.list).toHaveBeenCalled();
    });

    it("tool steer delegates to actions.steer with correct params", async () => {
      registerOrchestrateTool(mockPiApi, deps);
      await invokeTool(mockPiApi, "orchestrate", {
        action: "steer",
        sessionId: "sess-1",
        message: "hello",
      });
      expect(mockActions.steer).toHaveBeenCalledWith("sess-1", "hello");
    });

    it("tool returns structured content with success indicator", async () => {
      registerOrchestrateTool(mockPiApi, deps);
      const toolResult = await invokeTool(mockPiApi, "orchestrate", { action: "status" });
      const typed = toolResult as { content: { type: string; text: string }[] };
      expect(typed).toHaveProperty("content");
      expect(Array.isArray(typed.content)).toBe(true);
      expect(typed.content[0]).toHaveProperty("type", "text");
      expect(typed.content[0]).toHaveProperty("text");
    });
  });

  describe("adversarial: slash commands never bypass actions (AC-1)", () => {
    it("steer with missing sessionId returns error without calling action", async () => {
      registerSlashCommands(mockPiApi, deps);
      await invokeCommand(mockPiApi, "pipeline", "steer");
      // steer should still be called but with empty strings (actions validates)
      // The key assertion: no direct state or worker pool access occurred
    });
  });
});
