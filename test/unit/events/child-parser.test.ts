/**
 * Unit tests for events/child-parser.ts — createChildParser.
 *
 * Covers:
 *   AC-3: Child stdout partial JSONL chunk buffering
 *   AC-5: Unknown/malformed JSON resilience
 *   Pi event type routing to typed bus emissions
 *   Checkpoint detection from bmad_workflow_step tool events
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorEventKind } from "../../../src/shared/types.js";
import type { OrchestratorEventBus } from "../../../src/events/bus.js";
import type { ChildParser } from "../../../src/events/child-parser.js";
import { createChildParser } from "../../../src/events/child-parser.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface EmittedCall {
  kind: OrchestratorEventKind;
  sessionId: string;
  payload: unknown;
}

function createMockBus(): OrchestratorEventBus & { emittedCalls: EmittedCall[] } {
  const emittedCalls: EmittedCall[] = [];
  return {
    emittedCalls,
    emit: vi.fn((kind: OrchestratorEventKind, sessionId: string, payload: unknown) => {
      emittedCalls.push({ kind, sessionId, payload });
    }),
    onEvent: vi.fn(() => {
      return () => {
        // no-op dispose
      };
    }),
    close: vi.fn(async () => {
      // no-op close
    }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("ChildParser", () => {
  let mockBus: ReturnType<typeof createMockBus>;
  let parser: ChildParser;

  beforeEach(() => {
    mockBus = createMockBus();
    parser = createChildParser("session-1", mockBus);
  });

  // ── Pi event type routing ─────────────────────────────────────────

  describe("Pi event type routing", () => {
    it("routes agent_start to bus emit", () => {
      parser.feed('{"type":"agent_start","agentId":"dev","workflowId":"dev-story"}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("agent_start");
      expect(mockBus.emittedCalls[0]!.sessionId).toBe("session-1");
      expect(mockBus.emittedCalls[0]!.payload).toEqual({
        agentId: "dev",
        workflowId: "dev-story",
      });
    });

    it("routes agent_end to bus emit with exit code", () => {
      parser.feed('{"type":"agent_end","exitCode":1}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("agent_end");
      expect(mockBus.emittedCalls[0]!.payload).toEqual({ exitCode: 1, durationMs: undefined });
    });

    it("defaults exitCode to 0 when agent_end has no exitCode field", () => {
      parser.feed('{"type":"agent_end"}\n');
      expect(mockBus.emittedCalls[0]!.payload).toEqual({
        exitCode: 0,
        durationMs: undefined,
      });
    });

    it("routes turn_end to bus emit with turn index", () => {
      parser.feed('{"type":"turn_end","turnIndex":3}\n');
      expect(mockBus.emittedCalls[0]!.kind).toBe("turn_end");
      expect(mockBus.emittedCalls[0]!.payload).toEqual({ turnIndex: 3 });
    });

    it("defaults turnIndex to 0 when turn_end has no turnIndex field", () => {
      parser.feed('{"type":"turn_end"}\n');
      expect(mockBus.emittedCalls[0]!.payload).toEqual({ turnIndex: 0 });
    });

    it("routes tool_execution_start to bus emit with all args", () => {
      parser.feed(
        '{"type":"tool_execution_start","toolCallId":"tc-1","toolName":"Read","args":{"path":"/foo"}}\n',
      );
      expect(mockBus.emittedCalls[0]!.kind).toBe("tool_execution_start");
      expect(mockBus.emittedCalls[0]!.payload).toEqual({
        toolCallId: "tc-1",
        toolName: "Read",
        args: { path: "/foo" },
      });
    });

    it("routes tool_execution_end to bus emit", () => {
      parser.feed(
        '{"type":"tool_execution_end","toolCallId":"tc-1","toolName":"Read","isError":false}\n',
      );
      expect(mockBus.emittedCalls[0]!.kind).toBe("tool_execution_end");
      expect(mockBus.emittedCalls[0]!.payload).toEqual({
        toolCallId: "tc-1",
        toolName: "Read",
        isError: false,
      });
    });

    it("maps all 5 Pi events from a single multi-line chunk", () => {
      const chunk = [
        '{"type":"agent_start"}',
        '{"type":"turn_end","turnIndex":0}',
        '{"type":"tool_execution_start","toolCallId":"tc-1","toolName":"Bash","args":{}}',
        '{"type":"tool_execution_end","toolCallId":"tc-1","toolName":"Bash","isError":false}',
        '{"type":"agent_end","exitCode":0}',
        "",
      ].join("\n");
      parser.feed(chunk);

      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).toContain("agent_start");
      expect(kinds).toContain("turn_end");
      expect(kinds).toContain("tool_execution_start");
      expect(kinds).toContain("tool_execution_end");
      expect(kinds).toContain("agent_end");
    });

    it("attributes all events to the parser sessionId", () => {
      parser.feed('{"type":"agent_start"}\n');
      parser.feed('{"type":"agent_end","exitCode":0}\n');
      for (const call of mockBus.emittedCalls) {
        expect(call.sessionId).toBe("session-1");
      }
    });
  });

  // ── AC-3: Partial line buffering ──────────────────────────────────

  describe("partial line buffering", () => {
    it("buffers partial line and completes on next chunk", () => {
      parser.feed('{"type":"agen');
      expect(mockBus.emittedCalls).toHaveLength(0);
      parser.feed('t_start"}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("agent_start");
    });

    it("handles three-way chunk split", () => {
      parser.feed('{"type":');
      parser.feed('"turn_end",');
      parser.feed('"turnIndex":5}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.payload).toEqual({ turnIndex: 5 });
    });

    it("handles interleaved complete and partial lines", () => {
      parser.feed('{"type":"agent_start"}\n{"type":"tur');
      expect(mockBus.emittedCalls).toHaveLength(1);
      parser.feed('n_end","turnIndex":1}\n');
      expect(mockBus.emittedCalls).toHaveLength(2);
      expect(mockBus.emittedCalls[1]!.kind).toBe("turn_end");
    });

    it("handles many small chunks without data loss", () => {
      const fullLine =
        '{"type":"tool_execution_start","toolCallId":"tc-long","toolName":"Read","args":{"path":"/very/long/path/to/file.ts"}}\n';
      for (let index = 0; index < fullLine.length; index += 10) {
        parser.feed(fullLine.slice(index, index + 10));
      }
      expect(
        mockBus.emittedCalls.filter((call) => call.kind === "tool_execution_start"),
      ).toHaveLength(1);
    });
  });

  // ── AC-5: Unknown event kinds ─────────────────────────────────────

  describe("unknown event handling", () => {
    it("emits worker_state_changed for unknown Pi event types", () => {
      parser.feed('{"type":"some_future_event","data":"hello"}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("worker_state_changed");
      const payload = mockBus.emittedCalls[0]!.payload as Record<string, unknown>;
      expect(payload["to"]).toBe("unknown-event");
      expect(payload["reason"]).toContain("some_future_event");
    });

    it("continues processing after unknown event", () => {
      parser.feed('{"type":"some_future_event"}\n');
      parser.feed('{"type":"agent_start"}\n');
      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).toContain("agent_start");
    });

    it("does not crash on missing type field", () => {
      parser.feed('{"data":"no type here"}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("worker_state_changed");
      const payload = mockBus.emittedCalls[0]!.payload as Record<string, unknown>;
      expect(payload["reason"]).toContain("Missing type field");
    });
  });

  // ── AC-5: Malformed JSON handling ─────────────────────────────────

  describe("malformed JSON handling", () => {
    it("emits worker_state_changed for malformed JSON", () => {
      parser.feed('{"type":"agent_start"\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("worker_state_changed");
      const payload = mockBus.emittedCalls[0]!.payload as Record<string, unknown>;
      expect(payload["to"]).toBe("parse-error");
      expect(payload["reason"]).toContain("Malformed JSONL");
    });

    it("continues processing after malformed JSON", () => {
      parser.feed('{"type":"agent_start"\n');
      parser.feed('{"type":"agent_end","exitCode":0}\n');
      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).toContain("agent_end");
    });

    it("handles completely garbled data", () => {
      parser.feed("this is not json at all\n");
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("worker_state_changed");
    });

    it("feed never throws even with malformed input", () => {
      expect(() => {
        parser.feed("garbage\n");
      }).not.toThrow();
      expect(() => {
        parser.feed("more garbage\nstill garbage\n");
      }).not.toThrow();
    });

    it("silently skips empty lines without emitting", () => {
      parser.feed("\n");
      parser.feed("   \n");
      parser.feed("\t\n");
      expect(mockBus.emittedCalls).toHaveLength(0);
      parser.feed('{"type":"agent_start"}\n');
      expect(mockBus.emittedCalls).toHaveLength(1);
    });

    it("truncates long malformed lines in the error reason", () => {
      const longGarbage = "x".repeat(500) + "\n";
      parser.feed(longGarbage);
      const payload = mockBus.emittedCalls[0]!.payload as Record<string, unknown>;
      const reason = payload["reason"] as string;
      expect(reason.length).toBeLessThan(300);
    });
  });

  // ── Checkpoint detection ──────────────────────────────────────────

  describe("checkpoint result detection", () => {
    it("emits checkpoint_result for bmad_workflow_step tool_execution_end", () => {
      const checkpointEvent = JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-cp",
        toolName: "bmad_workflow_step",
        isError: false,
        result: {
          checkpointName: "red-gate-pass",
          passed: true,
          reason: "All tests fail as expected",
        },
      });
      parser.feed(checkpointEvent + "\n");

      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).toContain("tool_execution_end");
      expect(kinds).toContain("checkpoint_result");

      const checkpointCall = mockBus.emittedCalls.find((call) => call.kind === "checkpoint_result");
      expect(checkpointCall!.payload).toEqual({
        checkpointName: "red-gate-pass",
        passed: true,
        reason: "All tests fail as expected",
      });
    });

    it("does not emit checkpoint_result for non-bmad tools", () => {
      parser.feed(
        '{"type":"tool_execution_end","toolCallId":"tc-2","toolName":"Bash","isError":false}\n',
      );
      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).toContain("tool_execution_end");
      expect(kinds).not.toContain("checkpoint_result");
    });

    it("does not emit checkpoint_result when result lacks required fields", () => {
      const incompleteCheckpoint = JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "tc-cp",
        toolName: "bmad_workflow_step",
        isError: false,
        result: { checkpointName: "red-gate-pass" },
      });
      parser.feed(incompleteCheckpoint + "\n");
      const kinds = mockBus.emittedCalls.map((call) => call.kind);
      expect(kinds).not.toContain("checkpoint_result");
    });
  });

  // ── Flush behavior ────────────────────────────────────────────────

  describe("flush behavior", () => {
    it("parses remaining buffer content on flush", () => {
      parser.feed('{"type":"agent_start"}');
      expect(mockBus.emittedCalls).toHaveLength(0);
      parser.flush();
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("agent_start");
    });

    it("is a no-op when buffer is empty", () => {
      expect(() => {
        parser.flush();
      }).not.toThrow();
      expect(mockBus.emittedCalls).toHaveLength(0);
    });

    it("routes malformed content in buffer to error on flush", () => {
      parser.feed('{"truncated":true');
      parser.flush();
      expect(mockBus.emittedCalls).toHaveLength(1);
      expect(mockBus.emittedCalls[0]!.kind).toBe("worker_state_changed");
    });

    it("flush never throws", () => {
      parser.feed("garbage without newline");
      expect(() => {
        parser.flush();
      }).not.toThrow();
    });
  });

  // ── Crash resilience (INV-1) ──────────────────────────────────────

  describe("crash resilience", () => {
    it("feed never throws even when bus.emit throws", () => {
      const throwingBus = createMockBus();
      throwingBus.emit = vi.fn(() => {
        throw new Error("bus exploded");
      });
      const throwParser = createChildParser("s1", throwingBus);
      expect(() => {
        throwParser.feed('{"type":"agent_start"}\n');
      }).not.toThrow();
    });

    it("flush never throws even when bus.emit throws", () => {
      const throwingBus = createMockBus();
      throwingBus.emit = vi.fn(() => {
        throw new Error("bus exploded");
      });
      const throwParser = createChildParser("s1", throwingBus);
      throwParser.feed('{"type":"agent_start"}');
      expect(() => {
        throwParser.flush();
      }).not.toThrow();
    });
  });
});
