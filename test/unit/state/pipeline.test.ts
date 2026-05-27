/**
 * Unit tests for the PipelineStateManager — the single state authority.
 *
 * Tests cover all 17 mutation variants, initialization/recovery, subscriber
 * management, persistence ordering, validation, and adversarial cases.
 *
 * @see ADR-003 for the reducer-based state management decision.
 * @see Section 5.8 of pi-package-refactor-plan.md for interface contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  createPipelineStateManager,
  type PipelineStateManager,
} from "../../../src/state/pipeline.js";
import type {
  PipelineRunState,
  PipelineStatus,
  WorkflowDispatchRecord,
  ChildSessionRecord,
  PromptRecord,
  ApprovalRecord,
  GateResultRecord,
  ArtifactEvidenceRecord,
  StoryReviewLoopState,
  BlockerRecord,
  CompletedPhaseRecord,
} from "../../../src/shared/types.js";
import type { AtomicJsonStore, ReadOutcome } from "../../../src/shared/atomic-json.js";
import type { OrchestratorEventBus } from "../../../src/events/bus.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Doubles — tracking mocks without vi.fn() to avoid unbound-method
// ═══════════════════════════════════════════════════════════════════════════

/** Tracking store with call counters and data capture. */
interface TrackingStore extends AtomicJsonStore<PipelineRunState> {
  /** Stored data reflecting latest write. */
  data: PipelineRunState | undefined;
  /** Simulated quarantine path for corrupt state tests. */
  quarantinedPath: string | null;
  /** Number of times write() was called. */
  writeCallCount: number;
  /** All states passed to write() in order. */
  writtenStates: PipelineRunState[];
  /** Reset counters for test isolation. */
  resetTracking(): void;
}

function createTrackingStore(): TrackingStore {
  const tracker: TrackingStore = {
    data: undefined,
    quarantinedPath: null,
    writeCallCount: 0,
    writtenStates: [],
    async read(): Promise<PipelineRunState | undefined> {
      return tracker.data;
    },
    async readWithOutcome(): Promise<ReadOutcome<PipelineRunState>> {
      return { data: tracker.data, quarantinedPath: tracker.quarantinedPath };
    },
    async write(state: PipelineRunState): Promise<void> {
      tracker.data = state;
      tracker.writeCallCount += 1;
      tracker.writtenStates.push(state);
    },
    resetTracking(): void {
      tracker.writeCallCount = 0;
      tracker.writtenStates = [];
    },
  };
  return tracker;
}

/** Tracking event bus with emission capture. */
interface TrackingEventBus extends OrchestratorEventBus {
  /** All emitted events as [kind, sessionId, payload] records. */
  emittedEvents: { kind: string; sessionId: string; payload: unknown }[];
  /** Reset captured emissions. */
  resetTracking(): void;
}

function createTrackingEventBus(): TrackingEventBus {
  const tracker: TrackingEventBus = {
    emittedEvents: [],
    emit(kind, sessionId, payload): void {
      tracker.emittedEvents.push({ kind, sessionId, payload });
    },
    onEvent(): () => void {
      return () => {
        /* unsubscribe noop */
      };
    },
    async close(): Promise<void> {
      /* noop */
    },
    resetTracking(): void {
      tracker.emittedEvents = [];
    },
  };
  return tracker;
}

function createTestDeps() {
  const store = createTrackingStore();
  const eventBus = createTrackingEventBus();
  return { store, eventBus };
}

// ═══════════════════════════════════════════════════════════════════════════
// Record Factories
// ═══════════════════════════════════════════════════════════════════════════

function makeDispatchRecord(
  overrides: Partial<WorkflowDispatchRecord> = {},
): WorkflowDispatchRecord {
  return {
    dispatchId: "dispatch-1",
    sessionId: "session-1",
    phase: "implementation",
    stage: "development",
    agent: "dev",
    workflowId: "dev-story",
    storyId: null,
    promptIds: [],
    status: "sent",
    dispatchedAt: new Date().toISOString(),
    resolvedAt: null,
    completionEvidence: null,
    ...overrides,
  };
}

function makeChildSessionRecord(overrides: Partial<ChildSessionRecord> = {}): ChildSessionRecord {
  return {
    sessionId: "session-1",
    tmuxSessionName: "orch-session-1",
    workdir: "/tmp/test",
    launchCommand: "pi --agent dev",
    targetAgent: "dev",
    targetWorkflow: "dev-story",
    childStatePath: "/tmp/test/.pi/state/bmad/session.json",
    status: "creating",
    lastObservedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    terminatedAt: null,
    ...overrides,
  };
}

function makePromptRecord(overrides: Partial<PromptRecord> = {}): PromptRecord {
  return {
    promptId: "prompt-1",
    textOrHash: "Continue?",
    answer: "yes",
    actor: "auto-policy",
    policyRuleId: "auto-continue",
    sessionName: "session-1",
    workflowId: "dev-story",
    paneCaptureRef: null,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeApprovalRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: "approval-1",
    subject: "merge-conflict-resolution",
    decision: "approved",
    actor: "human",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeGateResultRecord(overrides: Partial<GateResultRecord> = {}): GateResultRecord {
  return {
    gateName: "analysis-to-planning",
    status: "pass",
    reason: "All artifacts present",
    checks: [],
    evaluatedAt: new Date().toISOString(),
    contextId: null,
    ...overrides,
  };
}

function makeArtifactEvidenceRecord(
  overrides: Partial<ArtifactEvidenceRecord> = {},
): ArtifactEvidenceRecord {
  return {
    path: ".pi/artifacts/planning/prd.md",
    registered: true,
    existsOnDisk: true,
    nonEmpty: true,
    registryStatus: "current",
    sectionsPresent: ["overview"],
    sectionsMissing: [],
    mtime: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeReviewLoopState(overrides: Partial<StoryReviewLoopState> = {}): StoryReviewLoopState {
  return {
    storyId: "story-1",
    status: "in-progress",
    loopCount: 0,
    lastReviewFindings: null,
    lastReviewTimestamp: null,
    escalated: false,
    ...overrides,
  };
}

function makeBlockerRecord(overrides: Partial<BlockerRecord> = {}): BlockerRecord {
  return {
    kind: "stuck",
    reason: "Worker is not responding",
    sessionId: "session-1",
    stage: "development",
    evidenceRefs: [],
    detectedAt: new Date().toISOString(),
    resolvedAt: null,
    ...overrides,
  };
}

function makeCompletedPhaseRecord(
  overrides: Partial<CompletedPhaseRecord> = {},
): CompletedPhaseRecord {
  return {
    phase: "analysis",
    stage: "analysis",
    workflowId: "analyze",
    dispatchId: "dispatch-analysis",
    gateResult: makeGateResultRecord(),
    artifacts: [".pi/artifacts/planning/prd.md"],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 60000,
    ...overrides,
  };
}

function makePersisted(): PipelineRunState {
  return {
    schemaVersion: "pipeline-run-state.v1",
    pipelineId: "pipeline-existing",
    runId: "run-existing",
    status: "running",
    phase: "planning",
    activeStage: "planning",
    activeWorkflowId: null,
    activeStepId: null,
    activeStoryId: null,
    dispatches: [],
    childSessions: [],
    prompts: [],
    approvals: [],
    gateResults: [],
    artifactEvidence: [],
    storyLifecycles: {},
    retryCounts: {},
    events: [],
    blocker: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T01:00:00.000Z",
    finishedAt: null,
    completedPhases: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Initialization / Recovery
// ═══════════════════════════════════════════════════════════════════════════

describe("PipelineStateManager", () => {
  describe("initialize", () => {
    it("creates fresh state when no persisted state exists (AC-3)", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });

      const result = await manager.initialize("run-1", "pipeline-1");

      expect(result.recovered).toBe(false);
      expect(result.fromPersisted).toBe(false);
      expect(result.quarantinedPath).toBeNull();
      expect(result.runId).toBe("run-1");

      const state = manager.getState();
      expect(state.schemaVersion).toBe("pipeline-run-state.v1");
      expect(state.runId).toBe("run-1");
      expect(state.pipelineId).toBe("pipeline-1");
      expect(state.status).toBe("idle");
      expect(state.phase).toBe("analysis");
    });

    it("persists the fresh state immediately on creation (AC-3)", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });

      await manager.initialize("run-1", "pipeline-1");

      expect(store.writeCallCount).toBe(1);
    });

    it("loads valid persisted state with recovered=true", async () => {
      const { store, eventBus } = createTestDeps();
      store.data = makePersisted();
      const manager = createPipelineStateManager({ store, eventBus });

      const result = await manager.initialize("run-existing", "pipeline-existing");

      expect(result.recovered).toBe(true);
      expect(result.fromPersisted).toBe(true);
      expect(result.quarantinedPath).toBeNull();
      expect(result.runId).toBe("run-existing");

      const state = manager.getState();
      expect(state.status).toBe("running");
      expect(state.phase).toBe("planning");
    });

    it("quarantines corrupt persisted state and reports evidence (AC-4)", async () => {
      const corruptStore = createTrackingStore();
      // Simulate AtomicJsonStore quarantine behavior: read returns undefined
      // when corruption is detected (the store renames the file internally)
      corruptStore.data = undefined;
      corruptStore.quarantinedPath = "/tmp/pipeline-state.json.quarantine.2026-05-28";
      const { eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store: corruptStore, eventBus });

      const result = await manager.initialize("run-recover", "pipeline-recover");

      // Should create fresh state, not throw
      expect(result.recovered).toBe(false);
      expect(result.fromPersisted).toBe(false);
      expect(result.quarantinedPath).toBe("/tmp/pipeline-state.json.quarantine.2026-05-28");
      expect(result.runId).toBe("run-recover");

      // Fresh state should be usable
      const state = manager.getState();
      expect(state.status).toBe("idle");
    });

    it("throws when called twice without state being reset", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });

      await manager.initialize("run-1", "pipeline-1");

      await expect(manager.initialize("run-2", "pipeline-2")).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-1: Valid StateMutation → validate → reduce → persist → emit → notify
  // ═══════════════════════════════════════════════════════════════════════

  describe("apply — mutation pipeline ordering (AC-1)", () => {
    let manager: PipelineStateManager;
    let store: TrackingStore;
    let eventBus: TrackingEventBus;

    beforeEach(async () => {
      const deps = createTestDeps();
      store = deps.store;
      eventBus = deps.eventBus;
      manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
      store.resetTracking();
      eventBus.resetTracking();
    });

    it("persists state atomically after reducing", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "starting" });

      expect(store.writeCallCount).toBe(1);
      expect(store.writtenStates[0]?.status).toBe("running");
    });

    it("emits pipeline_status_changed event after persist", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "starting" });

      const statusEvents = eventBus.emittedEvents.filter(
        (ev) => ev.kind === "pipeline_status_changed",
      );
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0]?.payload).toEqual({ from: "idle", to: "running" });
    });

    it("notifies subscribers after persist and emit", async () => {
      const subscriberStates: PipelineStatus[] = [];
      manager.onStateChange((state) => {
        subscriberStates.push(state.status);
      });

      await manager.apply({ kind: "set-status", status: "running", reason: "starting" });

      expect(subscriberStates).toEqual(["running"]);
    });

    it("updates updatedAt timestamp on every mutation", async () => {
      const beforeApply = manager.getState().updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 2));
      await manager.apply({ kind: "set-status", status: "running", reason: "start" });

      expect(manager.getState().updatedAt).not.toBe(beforeApply);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-2: Invalid mutation → throw OrchestratorError, no side effects
  // ═══════════════════════════════════════════════════════════════════════

  describe("apply — invalid mutations (AC-2)", () => {
    let manager: PipelineStateManager;
    let store: TrackingStore;
    let eventBus: TrackingEventBus;

    beforeEach(async () => {
      const deps = createTestDeps();
      store = deps.store;
      eventBus = deps.eventBus;
      manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
      store.resetTracking();
      eventBus.resetTracking();
    });

    it("throws OrchestratorError for update-dispatch with nonexistent dispatchId", async () => {
      await expect(
        manager.apply({ kind: "update-dispatch", dispatchId: "nonexistent", status: "completed" }),
      ).rejects.toThrow();
    });

    it("does not persist state when mutation is invalid", async () => {
      try {
        await manager.apply({
          kind: "update-dispatch",
          dispatchId: "nonexistent",
          status: "completed",
        });
      } catch {
        // expected
      }

      expect(store.writeCallCount).toBe(0);
    });

    it("does not notify subscribers when mutation is invalid", async () => {
      const notifications: PipelineRunState[] = [];
      manager.onStateChange((state) => notifications.push(state));

      try {
        await manager.apply({
          kind: "update-dispatch",
          dispatchId: "nonexistent",
          status: "completed",
        });
      } catch {
        // expected
      }

      expect(notifications).toHaveLength(0);
    });

    it("does not emit events when mutation is invalid", async () => {
      try {
        await manager.apply({
          kind: "update-dispatch",
          dispatchId: "nonexistent",
          status: "completed",
        });
      } catch {
        // expected
      }

      expect(eventBus.emittedEvents).toHaveLength(0);
    });

    it("leaves in-memory state unchanged on invalid mutation", async () => {
      const stateBefore = manager.getState();

      try {
        await manager.apply({
          kind: "update-dispatch",
          dispatchId: "nonexistent",
          status: "completed",
        });
      } catch {
        // expected
      }

      expect(manager.getState().updatedAt).toBe(stateBefore.updatedAt);
    });

    it("throws OrchestratorError for update-child-session with nonexistent sessionId", async () => {
      await expect(
        manager.apply({ kind: "update-child-session", sessionId: "nonexistent", status: "active" }),
      ).rejects.toThrow();
    });

    it("throws when apply is called before initialize", async () => {
      const freshDeps = createTestDeps();
      const uninitializedManager = createPipelineStateManager({
        store: freshDeps.store,
        eventBus: freshDeps.eventBus,
      });

      await expect(
        uninitializedManager.apply({ kind: "set-status", status: "running", reason: "test" }),
      ).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-5: All 17 mutation variants covered
  // ═══════════════════════════════════════════════════════════════════════

  describe("apply — all 17 mutation variants (AC-5)", () => {
    let manager: PipelineStateManager;

    beforeEach(async () => {
      const deps = createTestDeps();
      manager = createPipelineStateManager({ store: deps.store, eventBus: deps.eventBus });
      await manager.initialize("run-1", "pipeline-1");
    });

    // 1. set-status
    it("reduces set-status mutation", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "starting pipeline" });
      expect(manager.getState().status).toBe("running");
    });

    it("sets finishedAt when status is terminal (done)", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "start" });
      await manager.apply({ kind: "set-status", status: "done", reason: "completed" });
      expect(manager.getState().finishedAt).not.toBeNull();
    });

    it("sets finishedAt when status is terminal (failed)", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "start" });
      await manager.apply({ kind: "set-status", status: "failed", reason: "crashed" });
      expect(manager.getState().finishedAt).not.toBeNull();
    });

    it("sets finishedAt when status is terminal (aborted)", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "start" });
      await manager.apply({ kind: "set-status", status: "aborted", reason: "operator abort" });
      expect(manager.getState().finishedAt).not.toBeNull();
    });

    // 2. advance-phase
    it("reduces advance-phase mutation", async () => {
      await manager.apply({ kind: "advance-phase", phase: "planning", stage: "planning" });
      expect(manager.getState().phase).toBe("planning");
      expect(manager.getState().activeStage).toBe("planning");
    });

    // 3. set-active-stage
    it("reduces set-active-stage mutation", async () => {
      await manager.apply({ kind: "set-active-stage", stage: "development" });
      expect(manager.getState().activeStage).toBe("development");
    });

    it("reduces set-active-stage to null", async () => {
      await manager.apply({ kind: "set-active-stage", stage: "development" });
      await manager.apply({ kind: "set-active-stage", stage: null });
      expect(manager.getState().activeStage).toBeNull();
    });

    // 4. record-dispatch
    it("reduces record-dispatch mutation", async () => {
      await manager.apply({ kind: "record-dispatch", dispatch: makeDispatchRecord() });
      expect(manager.getState().dispatches).toHaveLength(1);
      expect(manager.getState().dispatches[0]?.dispatchId).toBe("dispatch-1");
    });

    // 5. update-dispatch
    it("reduces update-dispatch mutation", async () => {
      await manager.apply({
        kind: "record-dispatch",
        dispatch: makeDispatchRecord({ dispatchId: "d-upd" }),
      });
      await manager.apply({ kind: "update-dispatch", dispatchId: "d-upd", status: "completed" });
      const updated = manager
        .getState()
        .dispatches.find((dispatch) => dispatch.dispatchId === "d-upd");
      expect(updated?.status).toBe("completed");
      expect(updated?.resolvedAt).not.toBeNull();
    });

    it("does not set resolvedAt for non-terminal dispatch status", async () => {
      await manager.apply({
        kind: "record-dispatch",
        dispatch: makeDispatchRecord({ dispatchId: "d-nonterminal" }),
      });
      await manager.apply({
        kind: "update-dispatch",
        dispatchId: "d-nonterminal",
        status: "confirmed",
      });
      const updated = manager
        .getState()
        .dispatches.find((dispatch) => dispatch.dispatchId === "d-nonterminal");
      expect(updated?.resolvedAt).toBeNull();
    });

    it("reduces update-dispatch with evidence", async () => {
      await manager.apply({
        kind: "record-dispatch",
        dispatch: makeDispatchRecord({ dispatchId: "d-ev" }),
      });
      await manager.apply({
        kind: "update-dispatch",
        dispatchId: "d-ev",
        status: "completed",
        evidence: "gate passed",
      });
      const updated = manager
        .getState()
        .dispatches.find((dispatch) => dispatch.dispatchId === "d-ev");
      expect(updated?.completionEvidence).toBe("gate passed");
    });

    // 6. record-child-session
    it("reduces record-child-session mutation", async () => {
      await manager.apply({ kind: "record-child-session", session: makeChildSessionRecord() });
      expect(manager.getState().childSessions).toHaveLength(1);
      expect(manager.getState().childSessions[0]?.sessionId).toBe("session-1");
    });

    // 7. update-child-session
    it("reduces update-child-session mutation", async () => {
      await manager.apply({
        kind: "record-child-session",
        session: makeChildSessionRecord({ sessionId: "s-upd" }),
      });
      await manager.apply({ kind: "update-child-session", sessionId: "s-upd", status: "active" });
      const updated = manager
        .getState()
        .childSessions.find((session) => session.sessionId === "s-upd");
      expect(updated?.status).toBe("active");
      expect(updated?.terminatedAt).toBeNull();
    });

    it("sets terminatedAt when child session reaches terminal status", async () => {
      await manager.apply({
        kind: "record-child-session",
        session: makeChildSessionRecord({ sessionId: "s-dead" }),
      });
      await manager.apply({ kind: "update-child-session", sessionId: "s-dead", status: "dead" });
      const updated = manager
        .getState()
        .childSessions.find((session) => session.sessionId === "s-dead");
      expect(updated?.status).toBe("dead");
      expect(updated?.terminatedAt).not.toBeNull();
    });

    // 8. record-prompt
    it("reduces record-prompt mutation", async () => {
      await manager.apply({ kind: "record-prompt", prompt: makePromptRecord() });
      expect(manager.getState().prompts).toHaveLength(1);
    });

    // 9. record-approval
    it("reduces record-approval mutation", async () => {
      await manager.apply({ kind: "record-approval", approval: makeApprovalRecord() });
      expect(manager.getState().approvals).toHaveLength(1);
    });

    // 10. record-gate
    it("reduces record-gate mutation", async () => {
      await manager.apply({ kind: "record-gate", gateResult: makeGateResultRecord() });
      expect(manager.getState().gateResults).toHaveLength(1);
    });

    // 11. record-artifact-evidence
    it("reduces record-artifact-evidence mutation", async () => {
      await manager.apply({
        kind: "record-artifact-evidence",
        evidence: makeArtifactEvidenceRecord(),
      });
      expect(manager.getState().artifactEvidence).toHaveLength(1);
    });

    // 12. update-review-loop
    it("reduces update-review-loop mutation — creates lifecycle for new story", async () => {
      await manager.apply({
        kind: "update-review-loop",
        storyId: "story-rl",
        loopState: makeReviewLoopState({ storyId: "story-rl", loopCount: 2 }),
      });
      const lifecycle = manager.getState().storyLifecycles["story-rl"];
      expect(lifecycle).toBeDefined();
      expect(lifecycle?.storyId).toBe("story-rl");
      expect(lifecycle?.reviewLoopbacks).toBe(2);
    });

    it("reduces update-review-loop mutation — updates existing lifecycle", async () => {
      await manager.apply({
        kind: "update-review-loop",
        storyId: "story-rl2",
        loopState: makeReviewLoopState({ storyId: "story-rl2", loopCount: 1 }),
      });
      await manager.apply({
        kind: "update-review-loop",
        storyId: "story-rl2",
        loopState: makeReviewLoopState({
          storyId: "story-rl2",
          loopCount: 3,
          lastReviewFindings: {
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
            findingIds: ["f-1"],
          },
        }),
      });
      const lifecycle = manager.getState().storyLifecycles["story-rl2"];
      expect(lifecycle?.reviewLoopbacks).toBe(3);
      expect(lifecycle?.reviewFindings?.critical).toBe(1);
    });

    // 13. set-blocker
    it("reduces set-blocker mutation", async () => {
      await manager.apply({ kind: "set-blocker", blocker: makeBlockerRecord() });
      expect(manager.getState().blocker).not.toBeNull();
      expect(manager.getState().blocker?.kind).toBe("stuck");
    });

    // 14. clear-blocker
    it("reduces clear-blocker mutation", async () => {
      await manager.apply({ kind: "set-blocker", blocker: makeBlockerRecord() });
      await manager.apply({ kind: "clear-blocker" });
      expect(manager.getState().blocker).toBeNull();
    });

    // 15. update-echo-fields
    it("reduces update-echo-fields mutation", async () => {
      await manager.apply({
        kind: "update-echo-fields",
        workflowId: "dev-story",
        stepId: "step-1",
        storyId: "story-1",
      });
      const state = manager.getState();
      expect(state.activeWorkflowId).toBe("dev-story");
      expect(state.activeStepId).toBe("step-1");
      expect(state.activeStoryId).toBe("story-1");
    });

    it("reduces update-echo-fields to null", async () => {
      await manager.apply({
        kind: "update-echo-fields",
        workflowId: "dev-story",
        stepId: "step-1",
        storyId: "story-1",
      });
      await manager.apply({
        kind: "update-echo-fields",
        workflowId: null,
        stepId: null,
        storyId: null,
      });
      const state = manager.getState();
      expect(state.activeWorkflowId).toBeNull();
      expect(state.activeStepId).toBeNull();
      expect(state.activeStoryId).toBeNull();
    });

    // 16. record-completed-phase
    it("reduces record-completed-phase mutation", async () => {
      await manager.apply({ kind: "record-completed-phase", record: makeCompletedPhaseRecord() });
      expect(manager.getState().completedPhases).toHaveLength(1);
    });

    // 17. increment-retry
    it("reduces increment-retry mutation", async () => {
      await manager.apply({ kind: "increment-retry", category: "checkpoint-fail" });
      expect(manager.getState().retryCounts["checkpoint-fail"]).toBe(1);
    });

    it("increments existing retry counter", async () => {
      await manager.apply({ kind: "increment-retry", category: "worker-crash" });
      await manager.apply({ kind: "increment-retry", category: "worker-crash" });
      expect(manager.getState().retryCounts["worker-crash"]).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Subscriber Management
  // ═══════════════════════════════════════════════════════════════════════

  describe("onStateChange — subscriber management", () => {
    let manager: PipelineStateManager;

    beforeEach(async () => {
      const { store, eventBus } = createTestDeps();
      manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
    });

    it("delivers state snapshot to subscriber on mutation", async () => {
      const receivedStates: PipelineRunState[] = [];
      manager.onStateChange((state) => receivedStates.push(state));

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });

      expect(receivedStates).toHaveLength(1);
      expect(receivedStates[0]?.status).toBe("running");
    });

    it("delivers read-only snapshot to subscriber", async () => {
      let receivedState: Readonly<PipelineRunState> | null = null;
      manager.onStateChange((state) => {
        receivedState = state;
      });

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });

      expect(receivedState).not.toBeNull();
      expect(Object.isFrozen(receivedState)).toBe(true);
    });

    it("disposes subscription correctly", async () => {
      const receivedStates: PipelineStatus[] = [];
      const dispose = manager.onStateChange((state) => {
        receivedStates.push(state.status);
      });

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });
      dispose();
      await manager.apply({ kind: "set-status", status: "blocked", reason: "stuck" });

      expect(receivedStates).toEqual(["running"]);
    });

    it("dispose is idempotent", async () => {
      const receivedStates: PipelineStatus[] = [];
      const dispose = manager.onStateChange((state) => {
        receivedStates.push(state.status);
      });

      dispose();
      dispose(); // second call is safe

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });
      expect(receivedStates).toEqual([]);
    });

    it("continues notifying remaining subscribers when one throws", async () => {
      const calls: string[] = [];
      manager.onStateChange(() => calls.push("A"));
      manager.onStateChange(() => {
        throw new Error("subscriber boom");
      });
      manager.onStateChange(() => calls.push("C"));

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });

      expect(calls).toEqual(["A", "C"]);
    });

    it("supports self-disposal during notification", async () => {
      const calls: string[] = [];
      const disposeA = manager.onStateChange(() => {
        calls.push("A");
        disposeA();
      });
      manager.onStateChange(() => calls.push("B"));

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });
      expect(calls).toEqual(["A", "B"]);

      // After self-disposal, A should no longer be called
      calls.length = 0;
      await manager.apply({ kind: "set-status", status: "blocked", reason: "test2" });
      expect(calls).toEqual(["B"]);
    });

    it("prevents recursive state mutations during notification", async () => {
      const recursiveErrors: unknown[] = [];
      manager.onStateChange(() => {
        const recursivePromise = manager.apply({
          kind: "set-status",
          status: "blocked",
          reason: "recursive",
        });
        recursivePromise.catch((error: unknown) => recursiveErrors.push(error));
      });

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });

      // Allow microtask queue to flush
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(recursiveErrors).toHaveLength(1);
      expect(recursiveErrors[0]).toBeInstanceOf(Error);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // getState
  // ═══════════════════════════════════════════════════════════════════════

  describe("getState", () => {
    it("throws when called before initialize", () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });

      expect(() => manager.getState()).toThrow();
    });

    it("returns a frozen read-only snapshot", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");

      const state = manager.getState();
      expect(Object.isFrozen(state)).toBe(true);
    });

    it("returns consistent state after mutation", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });
      expect(manager.getState().status).toBe("running");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // flush
  // ═══════════════════════════════════════════════════════════════════════

  describe("flush", () => {
    it("persists current state to disk", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
      store.resetTracking();

      await manager.flush();

      expect(store.writeCallCount).toBe(1);
    });

    it("throws when called before initialize", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });

      await expect(manager.flush()).rejects.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Event emission for status changes
  // ═══════════════════════════════════════════════════════════════════════

  describe("event emission", () => {
    let manager: PipelineStateManager;
    let eventBus: TrackingEventBus;

    beforeEach(async () => {
      const deps = createTestDeps();
      eventBus = deps.eventBus;
      manager = createPipelineStateManager({ store: deps.store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
      eventBus.resetTracking();
    });

    it("emits pipeline_status_changed for set-status mutations", async () => {
      await manager.apply({ kind: "set-status", status: "running", reason: "start" });

      const statusEvents = eventBus.emittedEvents.filter(
        (ev) => ev.kind === "pipeline_status_changed",
      );
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0]?.payload).toEqual({ from: "idle", to: "running" });
    });

    it("does not emit pipeline_status_changed for non-status mutations", async () => {
      await manager.apply({ kind: "increment-retry", category: "test" });

      const statusEvents = eventBus.emittedEvents.filter(
        (ev) => ev.kind === "pipeline_status_changed",
      );
      expect(statusEvents).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Adversarial / edge cases
  // ═══════════════════════════════════════════════════════════════════════

  describe("adversarial", () => {
    it("persists before notifying — subscriber sees durable state", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");
      store.resetTracking();

      let storeWrittenBeforeNotify = false;
      manager.onStateChange(() => {
        storeWrittenBeforeNotify = store.writeCallCount > 0;
      });

      await manager.apply({ kind: "set-status", status: "running", reason: "test" });
      expect(storeWrittenBeforeNotify).toBe(true);
    });

    it("handles rapid sequential mutations without data loss", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");

      await manager.apply({ kind: "set-status", status: "running", reason: "start" });
      await manager.apply({ kind: "increment-retry", category: "cat-a" });
      await manager.apply({ kind: "increment-retry", category: "cat-a" });
      await manager.apply({ kind: "increment-retry", category: "cat-b" });

      const state = manager.getState();
      expect(state.status).toBe("running");
      expect(state.retryCounts["cat-a"]).toBe(2);
      expect(state.retryCounts["cat-b"]).toBe(1);
    });

    it("does not modify arrays in-place — mutations produce new array references", async () => {
      const { store, eventBus } = createTestDeps();
      const manager = createPipelineStateManager({ store, eventBus });
      await manager.initialize("run-1", "pipeline-1");

      const dispatchesBefore = manager.getState().dispatches;

      await manager.apply({ kind: "record-dispatch", dispatch: makeDispatchRecord() });

      const stateAfter = manager.getState();
      expect(stateAfter.dispatches).not.toBe(dispatchesBefore);
      expect(stateAfter.dispatches).toHaveLength(1);
    });
  });
});
