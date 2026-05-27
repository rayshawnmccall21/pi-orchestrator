/**
 * Unit tests for events/bus.ts — OrchestratorEventBus.
 *
 * Covers:
 *   AC-1: Typed payload enforcement for all 20 event kinds
 *   AC-2: Event envelope with schema, timestamp, runId, sessionId, level, kind, payload
 *   AC-2: Audit log writer integration
 *   AC-4: Reference-based payloads (promptTextRef, messageRef)
 *   Subscriber distribution, isolation, dispose, and immutability
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OrchestratorEvent, OrchestratorEventKind } from "../../../src/shared/types.js";
import type { JsonlLogWriter } from "../../../src/shared/jsonl-log.js";
import type { OrchestratorEventBus, EventBusConfig } from "../../../src/events/bus.js";
import { createEventBus, levelForKind } from "../../../src/events/bus.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

interface MockLogWriter extends JsonlLogWriter {
  appendedEvents: Record<string, unknown>[];
  appendSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
}

function createMockLogWriter(): MockLogWriter {
  const appendedEvents: Record<string, unknown>[] = [];
  const appendSpy = vi.fn(async (event: Record<string, unknown>) => {
    appendedEvents.push(event);
  });
  const closeSpy = vi.fn(async () => {
    // no-op mock
  });
  return {
    appendedEvents,
    appendSpy,
    closeSpy,
    append: appendSpy,
    close: closeSpy,
  };
}

function createTestBus(overrides?: {
  runId?: string;
  onInternalError?: (error: unknown, context: string) => void;
}): { bus: OrchestratorEventBus; logWriter: ReturnType<typeof createMockLogWriter> } {
  const logWriter = createMockLogWriter();
  const busConfig: EventBusConfig = {
    runId: overrides?.runId ?? "run-42",
    logWriter,
  };
  if (overrides?.onInternalError) {
    busConfig.onInternalError = overrides.onInternalError;
  }
  const bus = createEventBus(busConfig);
  return { bus, logWriter };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("OrchestratorEventBus", () => {
  let bus: OrchestratorEventBus;
  let logWriter: ReturnType<typeof createMockLogWriter>;

  beforeEach(() => {
    const testBus = createTestBus();
    bus = testBus.bus;
    logWriter = testBus.logWriter;
  });

  // ── AC-2: Event envelope construction ─────────────────────────────

  describe("envelope construction", () => {
    it("includes schema, timestamp, runId, sessionId, level, kind, and payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_sent", "worker-001", {
        dispatchId: "d-1",
        agent: "dev",
        workflow: "dev-story",
        storyId: "E3-S1",
      });

      expect(capturedEvent).toBeDefined();
      expect(capturedEvent!.schema).toBe("orchestrator-event.v1");
      expect(capturedEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(capturedEvent!.runId).toBe("run-42");
      expect(capturedEvent!.sessionId).toBe("worker-001");
      expect(capturedEvent!.kind).toBe("dispatch_sent");
      expect(capturedEvent!.payload).toEqual({
        dispatchId: "d-1",
        agent: "dev",
        workflow: "dev-story",
        storyId: "E3-S1",
      });
      expect(capturedEvent!.level).toBe("info");
    });

    it("has exactly 7 top-level keys", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_start", "s1", {});
      expect(Object.keys(capturedEvent!)).toHaveLength(7);
    });

    it("stamps runId from construction on all events", () => {
      const events: OrchestratorEvent[] = [];
      bus.onEvent((event) => {
        events.push(event);
      });
      bus.emit("agent_start", "s1", {});
      bus.emit("agent_end", "s2", { exitCode: 0 });
      for (const event of events) {
        expect(event.runId).toBe("run-42");
      }
    });

    it("produces valid ISO-8601 timestamps", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_start", "s1", {});
      const parsed = Date.parse(capturedEvent!.timestamp);
      expect(parsed).not.toBeNaN();
    });
  });

  // ── AC-1: All 20 event kinds with typed payloads ──────────────────

  describe("typed payload enforcement for all 20 kinds", () => {
    it("emits agent_start with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_start", "s1", { agentId: "dev", workflowId: "dev-story" });
      expect(capturedEvent!.kind).toBe("agent_start");
      expect(capturedEvent!.payload).toEqual({ agentId: "dev", workflowId: "dev-story" });
    });

    it("emits agent_end with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_end", "s1", { exitCode: 1, durationMs: 5000 });
      expect(capturedEvent!.payload).toEqual({ exitCode: 1, durationMs: 5000 });
    });

    it("emits tool_execution_start with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("tool_execution_start", "s1", {
        toolCallId: "tc-1",
        toolName: "Read",
        args: { path: "/foo" },
      });
      expect(capturedEvent!.payload).toEqual({
        toolCallId: "tc-1",
        toolName: "Read",
        args: { path: "/foo" },
      });
    });

    it("emits tool_execution_end with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("tool_execution_end", "s1", {
        toolCallId: "tc-1",
        toolName: "Read",
        isError: false,
      });
      expect(capturedEvent!.payload).toEqual({
        toolCallId: "tc-1",
        toolName: "Read",
        isError: false,
      });
    });

    it("emits turn_end with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("turn_end", "s1", { turnIndex: 3 });
      expect(capturedEvent!.payload).toEqual({ turnIndex: 3 });
    });

    it("emits checkpoint_result with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("checkpoint_result", "s1", {
        checkpointName: "red-gate-pass",
        passed: true,
        reason: "All tests fail",
      });
      expect(capturedEvent!.payload).toEqual({
        checkpointName: "red-gate-pass",
        passed: true,
        reason: "All tests fail",
      });
    });

    it("emits dispatch_sent with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_sent", "s1", {
        dispatchId: "d-1",
        agent: "dev",
        workflow: "dev-story",
        storyId: "E3-S1",
      });
      expect(capturedEvent!.kind).toBe("dispatch_sent");
    });

    it("emits dispatch_confirmed with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_confirmed", "s1", {
        dispatchId: "d-1",
        sessionId: "worker-1",
      });
      expect(capturedEvent!.payload).toEqual({ dispatchId: "d-1", sessionId: "worker-1" });
    });

    it("emits dispatch_completed with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_completed", "s1", { dispatchId: "d-1", outcome: "success" });
      expect(capturedEvent!.payload).toEqual({ dispatchId: "d-1", outcome: "success" });
    });

    it("emits dispatch_failed with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_failed", "s1", {
        dispatchId: "d-1",
        category: "worker-crash",
        reason: "OOM",
      });
      expect(capturedEvent!.kind).toBe("dispatch_failed");
      expect(capturedEvent!.level).toBe("error");
    });

    it("emits steer_sent with typed payload (uses messageRef)", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("steer_sent", "s1", {
        messageRef: "ref:steer/abc123.txt",
        attempt: 2,
      });
      expect(capturedEvent!.payload).toEqual({
        messageRef: "ref:steer/abc123.txt",
        attempt: 2,
      });
    });

    it("emits merge_start with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("merge_start", "s1", { branch: "worker/w1", into: "main" });
      expect(capturedEvent!.payload).toEqual({ branch: "worker/w1", into: "main" });
    });

    it("emits merge_complete with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("merge_complete", "s1", {
        branch: "worker/w1",
        mergedFiles: ["src/a.ts", "src/b.ts"],
      });
      expect(capturedEvent!.payload).toEqual({
        branch: "worker/w1",
        mergedFiles: ["src/a.ts", "src/b.ts"],
      });
    });

    it("emits merge_conflict with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("merge_conflict", "s1", {
        branch: "worker/w1",
        conflictFiles: ["src/types.ts"],
      });
      expect(capturedEvent!.kind).toBe("merge_conflict");
      expect(capturedEvent!.level).toBe("warn");
    });

    it("emits prompt_observed with typed payload (uses promptTextRef)", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("prompt_observed", "s1", {
        promptTextRef: "ref:prompt/xyz789.txt",
      });
      expect(capturedEvent!.payload).toEqual({
        promptTextRef: "ref:prompt/xyz789.txt",
      });
      expect(capturedEvent!.level).toBe("warn");
    });

    it("emits approval_requested with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("approval_requested", "s1", {
        subject: "destructive-cleanup",
        context: "Remove stale worktree",
      });
      expect(capturedEvent!.payload).toEqual({
        subject: "destructive-cleanup",
        context: "Remove stale worktree",
      });
    });

    it("emits approval_resolved with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("approval_resolved", "s1", {
        subject: "destructive-cleanup",
        approved: true,
      });
      expect(capturedEvent!.payload).toEqual({
        subject: "destructive-cleanup",
        approved: true,
      });
    });

    it("emits escalation_triggered with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("escalation_triggered", "s1", {
        category: "retry-exhausted",
        reason: "3 failed attempts",
        evidenceRefs: ["/logs/attempt-1.log"],
      });
      expect(capturedEvent!.kind).toBe("escalation_triggered");
      expect(capturedEvent!.level).toBe("error");
    });

    it("emits worker_state_changed with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("worker_state_changed", "s1", {
        sessionId: "worker-1",
        from: "active",
        to: "stale",
        reason: "Heartbeat timeout",
      });
      expect(capturedEvent!.payload).toEqual({
        sessionId: "worker-1",
        from: "active",
        to: "stale",
        reason: "Heartbeat timeout",
      });
    });

    it("emits pipeline_status_changed with typed payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("pipeline_status_changed", "orchestrator", {
        from: "running",
        to: "blocked",
      });
      expect(capturedEvent!.payload).toEqual({
        from: "running",
        to: "blocked",
      });
    });
  });

  // ── AC-2: Audit log integration ───────────────────────────────────

  describe("JSONL audit log integration", () => {
    it("writes every emitted event to the log writer", async () => {
      bus.emit("agent_start", "s1", { agentId: "dev" });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(logWriter.appendSpy).toHaveBeenCalledOnce();
      expect(logWriter.appendedEvents).toHaveLength(1);
      expect(logWriter.appendedEvents[0]).toHaveProperty("schema", "orchestrator-event.v1");
    });

    it("writes events for all kinds to the log", async () => {
      bus.emit("agent_start", "s1", {});
      bus.emit("agent_end", "s1", { exitCode: 0 });
      bus.emit("turn_end", "s1", { turnIndex: 0 });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(logWriter.appendedEvents).toHaveLength(3);
    });

    it("isolates log writer errors from subscribers", async () => {
      const failingLogWriter = createMockLogWriter();
      failingLogWriter.append = vi.fn(async () => {
        throw new Error("disk full");
      });
      const errorHandler = vi.fn();
      const failBus = createEventBus({
        runId: "run-fail",
        logWriter: failingLogWriter,
        onInternalError: errorHandler,
      });

      const subscriber = vi.fn();
      failBus.onEvent(subscriber);
      failBus.emit("agent_start", "s1", {});

      // Subscriber still called despite log failure
      expect(subscriber).toHaveBeenCalledOnce();

      // Allow async error to propagate
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(errorHandler).toHaveBeenCalledOnce();
      expect(errorHandler.mock.calls[0]![1]).toBe("audit-log:agent_start");
    });
  });

  // ── Level mapping ─────────────────────────────────────────────────

  describe("level mapping", () => {
    it("maps dispatch_failed to error", () => {
      expect(levelForKind("dispatch_failed")).toBe("error");
    });

    it("maps escalation_triggered to error", () => {
      expect(levelForKind("escalation_triggered")).toBe("error");
    });

    it("maps merge_conflict to warn", () => {
      expect(levelForKind("merge_conflict")).toBe("warn");
    });

    it("maps prompt_observed to warn", () => {
      expect(levelForKind("prompt_observed")).toBe("warn");
    });

    it("maps all other kinds to info", () => {
      const infoKinds: OrchestratorEventKind[] = [
        "agent_start",
        "agent_end",
        "tool_execution_start",
        "tool_execution_end",
        "turn_end",
        "checkpoint_result",
        "dispatch_sent",
        "dispatch_confirmed",
        "dispatch_completed",
        "steer_sent",
        "merge_start",
        "merge_complete",
        "approval_requested",
        "approval_resolved",
        "worker_state_changed",
        "pipeline_status_changed",
      ];
      for (const kind of infoKinds) {
        expect(levelForKind(kind)).toBe("info");
      }
    });
  });

  // ── Subscriber distribution ───────────────────────────────────────

  describe("subscriber distribution", () => {
    it("distributes to multiple subscribers", () => {
      const subscriberA = vi.fn();
      const subscriberB = vi.fn();
      bus.onEvent(subscriberA);
      bus.onEvent(subscriberB);
      bus.emit("agent_start", "s1", {});
      expect(subscriberA).toHaveBeenCalledOnce();
      expect(subscriberB).toHaveBeenCalledOnce();
    });

    it("delivers the same event object to all subscribers", () => {
      const eventsA: OrchestratorEvent[] = [];
      const eventsB: OrchestratorEvent[] = [];
      bus.onEvent((event) => {
        eventsA.push(event);
      });
      bus.onEvent((event) => {
        eventsB.push(event);
      });
      bus.emit("agent_start", "s1", {});
      expect(eventsA[0]).toBe(eventsB[0]);
    });

    it("does not throw when emitting with zero subscribers", () => {
      expect(() => {
        bus.emit("agent_start", "s1", {});
      }).not.toThrow();
    });

    it("does not call subscribers before emit", () => {
      const subscriber = vi.fn();
      bus.onEvent(subscriber);
      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  // ── Subscriber unsubscribe ────────────────────────────────────────

  describe("unsubscribe", () => {
    it("stops delivering events after dispose is called", () => {
      const subscriber = vi.fn();
      const dispose = bus.onEvent(subscriber);
      bus.emit("agent_start", "s1", {});
      expect(subscriber).toHaveBeenCalledOnce();
      dispose();
      bus.emit("agent_end", "s1", { exitCode: 0 });
      expect(subscriber).toHaveBeenCalledOnce();
    });

    it("does not throw on double-dispose", () => {
      const subscriber = vi.fn();
      const dispose = bus.onEvent(subscriber);
      dispose();
      expect(() => {
        dispose();
      }).not.toThrow();
    });

    it("delivers to all subscribers when one self-disposes during emit", () => {
      const callLog: string[] = [];
      const disposeA = bus.onEvent(() => {
        callLog.push("A");
        disposeA();
      });
      bus.onEvent(() => {
        callLog.push("B");
      });
      bus.onEvent(() => {
        callLog.push("C");
      });
      bus.emit("agent_start", "s1", {});
      expect(callLog).toEqual(["A", "B", "C"]);
    });

    it("does not affect other subscribers when one disposes", () => {
      const subscriberA = vi.fn();
      const subscriberB = vi.fn();
      const disposeA = bus.onEvent(subscriberA);
      bus.onEvent(subscriberB);
      disposeA();
      bus.emit("agent_start", "s1", {});
      expect(subscriberA).not.toHaveBeenCalled();
      expect(subscriberB).toHaveBeenCalledOnce();
    });
  });

  // ── Immutability ──────────────────────────────────────────────────

  describe("immutability", () => {
    it("freezes emitted event objects", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_start", "s1", {});
      expect(Object.isFrozen(capturedEvent)).toBe(true);
    });

    it("freezes event payload", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_sent", "s1", {
        dispatchId: "d-1",
        agent: "dev",
        workflow: "dev-story",
        storyId: null,
      });
      expect(Object.isFrozen(capturedEvent!.payload)).toBe(true);
    });

    it("prevents mutation of event fields", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("agent_start", "s1", {});
      expect(() => {
        (capturedEvent as unknown as Record<string, unknown>)["kind"] = "agent_end";
      }).toThrow();
    });
  });

  // ── Subscriber error isolation ────────────────────────────────────

  describe("subscriber error isolation", () => {
    it("continues to next subscriber when one throws", () => {
      const subscriberA = vi.fn();
      const subscriberB = vi.fn(() => {
        throw new Error("boom");
      });
      const subscriberC = vi.fn();
      bus.onEvent(subscriberA);
      bus.onEvent(subscriberB);
      bus.onEvent(subscriberC);
      expect(() => {
        bus.emit("agent_start", "s1", {});
      }).not.toThrow();
      expect(subscriberA).toHaveBeenCalledOnce();
      expect(subscriberC).toHaveBeenCalledOnce();
    });

    it("reports subscriber errors through onInternalError", () => {
      const errorHandler = vi.fn();
      const { bus: errorBus } = createTestBus({ onInternalError: errorHandler });
      errorBus.onEvent(() => {
        throw new Error("subscriber broke");
      });
      errorBus.emit("agent_start", "s1", {});
      expect(errorHandler).toHaveBeenCalledOnce();
      expect(errorHandler.mock.calls[0]![1]).toBe("subscriber:agent_start");
    });
  });

  // ── Close lifecycle ───────────────────────────────────────────────

  describe("close", () => {
    it("rejects further emissions after close", async () => {
      const subscriber = vi.fn();
      bus.onEvent(subscriber);
      await bus.close();
      bus.emit("agent_start", "s1", {});
      expect(subscriber).not.toHaveBeenCalled();
    });

    it("closes the log writer on close", async () => {
      await bus.close();
      expect(logWriter.closeSpy).toHaveBeenCalledOnce();
    });

    it("is idempotent — double close does not throw", async () => {
      await bus.close();
      await expect(bus.close()).resolves.toBeUndefined();
      expect(logWriter.closeSpy).toHaveBeenCalledOnce();
    });

    it("does not write to audit log after close", async () => {
      await bus.close();
      bus.emit("agent_start", "s1", {});
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(logWriter.appendSpy).not.toHaveBeenCalled();
    });
  });

  // ── Security ──────────────────────────────────────────────────────

  describe("security", () => {
    it("payload contains only caller-supplied data", () => {
      let capturedEvent: OrchestratorEvent | undefined;
      bus.onEvent((event) => {
        capturedEvent = event;
      });
      bus.emit("dispatch_sent", "s1", {
        dispatchId: "d-1",
        agent: "dev",
        workflow: "dev-story",
        storyId: null,
      });
      const payloadJson = JSON.stringify(capturedEvent!.payload);
      expect(payloadJson).not.toContain("ANTHROPIC_API_KEY");
    });
  });
});
