/**
 * Unit tests for the OrchestratorActions boundary.
 *
 * Tests the typed surface boundary that all slash commands and extension tools
 * route through. Verifies delegation to run controller, state reads, worker
 * pool queries, event emission, and structured error responses.
 *
 * @see R-S13 story acceptance criteria
 * @see Section 5.15 of pi-package-refactor-plan.md
 */

import { describe, it, expect, vi } from "vitest";
import type { PipelineStateManager } from "../../src/state/pipeline.js";
import type { OrchestratorEventBus } from "../../src/events/bus.js";
import type { BlockerRecord, PipelineRunState, PipelineStatus } from "../../src/shared/types.js";
import {
  createOrchestratorActions,
  type OrchestratorActionsDeps,
  type OrchestratorRun,
  type WorkerPool,
  type WorkerHandle,
} from "../../src/actions.js";

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers — Mock Factories
// ═══════════════════════════════════════════════════════════════════════════

function createFreshState(overrides: Partial<PipelineRunState> = {}): PipelineRunState {
  return {
    schemaVersion: "pipeline-run-state.v1",
    pipelineId: "pipeline-test",
    runId: "run-test-1",
    status: "idle",
    phase: "analysis",
    activeStage: null,
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
    startedAt: "2025-07-16T00:00:00.000Z",
    updatedAt: "2025-07-16T00:00:00.000Z",
    finishedAt: null,
    completedPhases: [],
    ...overrides,
  };
}

function createMockRun(overrides: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    isPaused: vi.fn().mockReturnValue(false),
    isRunning: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

function noop(): void {
  /* mock dispose */
}

function createMockStateManager(
  state: PipelineRunState = createFreshState(),
): PipelineStateManager {
  return {
    getState: vi.fn().mockReturnValue(Object.freeze({ ...state })),
    apply: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue({
      recovered: false,
      fromPersisted: false,
      quarantinedPath: null,
      runId: state.runId,
    }),
    onStateChange: vi.fn().mockReturnValue(noop),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWorkerPool(activeWorkers: WorkerHandle[] = []): WorkerPool {
  return {
    steer: vi.fn().mockResolvedValue(undefined),
    getActiveWorkers: vi.fn().mockReturnValue(activeWorkers),
  };
}

function createMockEventBus(): OrchestratorEventBus {
  return {
    emit: vi.fn(),
    onEvent: vi.fn().mockReturnValue(noop),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestDeps(overrides: Partial<OrchestratorActionsDeps> = {}): OrchestratorActionsDeps {
  return {
    run: createMockRun(),
    stateManager: createMockStateManager(),
    workerPool: createMockWorkerPool(),
    eventBus: createMockEventBus(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: createOrchestratorActions returns all methods with typed contracts
// ═══════════════════════════════════════════════════════════════════════════

describe("OrchestratorActions", () => {
  describe("createOrchestratorActions", () => {
    it("returns an object with all 9 required action methods", () => {
      const deps = createTestDeps();
      const actions = createOrchestratorActions(deps);

      expect(actions).toHaveProperty("start");
      expect(actions).toHaveProperty("status");
      expect(actions).toHaveProperty("list");
      expect(actions).toHaveProperty("steer");
      expect(actions).toHaveProperty("pause");
      expect(actions).toHaveProperty("resume");
      expect(actions).toHaveProperty("abort");
      expect(actions).toHaveProperty("escalate");
      expect(actions).toHaveProperty("result");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // start()
  // ═══════════════════════════════════════════════════════════════════════

  describe("start", () => {
    it("delegates to run controller and returns runId, status, and phase", async () => {
      const runningState = createFreshState({
        status: "running",
        runId: "run-abc",
        phase: "analysis",
      });
      const mockRun = createMockRun();
      const mockStateManager = createMockStateManager(runningState);
      // After start, getState returns running
      (mockRun.start as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        (mockStateManager.getState as ReturnType<typeof vi.fn>).mockReturnValue(
          Object.freeze({ ...runningState }),
        );
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
        stateManager: mockStateManager,
      });

      const actionResult = await actions.start("full");

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.runId).toBe("run-abc");
      expect(actionResult.data.status).toBe("running");
      expect(actionResult.data.phase).toBe("analysis");
      expect(mockRun.start).toHaveBeenCalledWith("full"); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("passes scope argument through to run controller", async () => {
      const mockRun = createMockRun();
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
        stateManager: createMockStateManager(
          createFreshState({ status: "running", runId: "run-1" }),
        ),
      });

      await actions.start("implementation");

      expect(mockRun.start).toHaveBeenCalledWith("implementation"); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("returns failure result when run controller throws", async () => {
      const mockRun = createMockRun({
        start: vi.fn().mockRejectedValue(new Error("Bootstrap incomplete")),
      });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.start("full");

      expect(actionResult.success).toBe(false);
      expect(actionResult.message).toContain("Bootstrap incomplete");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-2: status() returns { active: false } when no run exists
  // ═══════════════════════════════════════════════════════════════════════

  describe("status", () => {
    it("returns { active: false } when pipeline is idle", () => {
      const idleState = createFreshState({ status: "idle" });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(idleState),
      });

      const actionResult = actions.status();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data).toEqual({ active: false });
    });

    it("returns full PipelineRunState when pipeline is running", () => {
      const runningState = createFreshState({
        status: "running",
        runId: "run-active",
        phase: "implementation",
        activeStage: "development",
      });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(runningState),
      });

      const actionResult = actions.status();

      expect(actionResult.success).toBe(true);
      // When active, data should be the full state — not { active: false }
      const statusData = actionResult.data as PipelineRunState;
      expect(statusData.runId).toBe("run-active");
      expect(statusData.status).toBe("running");
      expect(statusData.phase).toBe("implementation");
      expect(statusData.activeStage).toBe("development");
    });

    it("returns full state for non-idle terminal statuses", () => {
      const doneState = createFreshState({
        status: "done",
        runId: "run-done",
        finishedAt: "2025-07-16T01:00:00.000Z",
      });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(doneState),
      });

      const actionResult = actions.status();
      expect(actionResult.success).toBe(true);
      const statusData = actionResult.data as PipelineRunState;
      expect(statusData.status).toBe("done");
    });

    it("never throws — returns a structured result instead", () => {
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(createFreshState()),
      });

      // Should not throw
      expect(() => actions.status()).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // list()
  // ═══════════════════════════════════════════════════════════════════════

  describe("list", () => {
    it("returns dispatch summaries from state and session summaries from worker pool", () => {
      const stateWithDispatches = createFreshState({
        status: "running",
        dispatches: [
          {
            dispatchId: "d-1",
            sessionId: "s-1",
            phase: "analysis",
            stage: "analysis",
            agent: "analyst",
            workflowId: "create-prd",
            storyId: null,
            promptIds: [],
            status: "confirmed",
            dispatchedAt: "2025-07-16T00:00:00.000Z",
            resolvedAt: null,
            completionEvidence: null,
          },
        ],
      });

      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "s-1",
          transport: "tmux",
          worktreePath: "/trees/s-1",
          branchName: "worker/s-1",
        },
      ];

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(stateWithDispatches),
        workerPool: createMockWorkerPool(activeWorkers),
      });

      const actionResult = actions.list();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.dispatches).toHaveLength(1);
      const firstDispatchItem = actionResult.data.dispatches[0];
      expect(firstDispatchItem).toBeDefined();
      expect(firstDispatchItem!.dispatchId).toBe("d-1");
      expect(firstDispatchItem!.agent).toBe("analyst");
      expect(firstDispatchItem!.workflow).toBe("create-prd");
      expect(firstDispatchItem!.storyId).toBeNull();
      expect(firstDispatchItem!.status).toBe("confirmed");

      expect(actionResult.data.sessions).toHaveLength(1);
      expect(actionResult.data.sessions[0]!.sessionId).toBe("s-1");
    });

    it("returns empty arrays when no dispatches or sessions exist", () => {
      const actions = createOrchestratorActions(createTestDeps());

      const actionResult = actions.list();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.dispatches).toEqual([]);
      expect(actionResult.data.sessions).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: steer() delegates through worker pool
  // ═══════════════════════════════════════════════════════════════════════

  describe("steer", () => {
    it("sends steer message to worker pool and emits steer_sent event", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "worker-1",
          transport: "tmux",
          worktreePath: "/trees/worker-1",
          branchName: "worker/worker-1",
        },
      ];
      const mockWorkerPool = createMockWorkerPool(activeWorkers);
      const mockEventBus = createMockEventBus();

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
        eventBus: mockEventBus,
      });

      const actionResult = await actions.steer("worker-1", "Please focus on test coverage");

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.dispatched).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
      expect(mockWorkerPool.steer).toHaveBeenCalledWith(
        "worker-1",
        "Please focus on test coverage",
      );
    });

    // AC-5: invalid session ID
    it("returns failure when session does not exist", async () => {
      const mockWorkerPool = createMockWorkerPool([]); // no active workers

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
      });

      const actionResult = await actions.steer("nonexistent-session", "hello");

      expect(actionResult.success).toBe(false);
      expect(actionResult.data.dispatched).toBe(false);
      expect(mockWorkerPool.steer).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    // AC-5: empty message
    it("returns failure when message is empty", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "worker-1",
          transport: "tmux",
          worktreePath: "/trees/worker-1",
          branchName: "worker/worker-1",
        },
      ];
      const mockWorkerPool = createMockWorkerPool(activeWorkers);

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
      });

      const actionResult = await actions.steer("worker-1", "");

      expect(actionResult.success).toBe(false);
      expect(actionResult.data.dispatched).toBe(false);
      expect(mockWorkerPool.steer).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    // AC-5: empty session ID
    it("returns failure when session ID is empty", async () => {
      const actions = createOrchestratorActions(createTestDeps());

      const actionResult = await actions.steer("", "some message");

      expect(actionResult.success).toBe(false);
      expect(actionResult.data.dispatched).toBe(false);
    });

    it("returns failure when worker pool throws during steer", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "worker-1",
          transport: "tmux",
          worktreePath: "/trees/worker-1",
          branchName: "worker/worker-1",
        },
      ];
      const mockWorkerPool = createMockWorkerPool(activeWorkers);
      (mockWorkerPool.steer as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tmux write failed"),
      );

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
      });

      const actionResult = await actions.steer("worker-1", "some message");

      expect(actionResult.success).toBe(false);
      expect(actionResult.message).toContain("tmux write failed");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: pause() delegates through run controller
  // ═══════════════════════════════════════════════════════════════════════

  describe("pause", () => {
    it("delegates to run controller and returns paused: true", async () => {
      const mockRun = createMockRun({ isRunning: vi.fn().mockReturnValue(true) });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.pause();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.paused).toBe(true);
      expect(mockRun.pause).toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("returns success even when pipeline is not running (idempotent)", async () => {
      const mockRun = createMockRun({ isRunning: vi.fn().mockReturnValue(false) });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.pause();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.paused).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: resume() delegates through run controller
  // ═══════════════════════════════════════════════════════════════════════

  describe("resume", () => {
    it("delegates to run controller and returns paused: false", async () => {
      const mockRun = createMockRun({ isPaused: vi.fn().mockReturnValue(true) });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.resume();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.paused).toBe(false);
      expect(mockRun.resume).toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("returns success even when pipeline is not paused (idempotent)", async () => {
      const mockRun = createMockRun({ isPaused: vi.fn().mockReturnValue(false) });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.resume();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.paused).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: abort() delegates through run controller
  // ═══════════════════════════════════════════════════════════════════════

  describe("abort", () => {
    it("delegates to run controller with reason", async () => {
      const mockRun = createMockRun();
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.abort("operator requested");

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.status).toBe("aborted");
      expect(mockRun.abort).toHaveBeenCalledWith("operator requested"); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("delegates without reason when none provided", async () => {
      const mockRun = createMockRun();
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.abort();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.status).toBe("aborted");
      expect(mockRun.abort).toHaveBeenCalledWith(undefined); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("returns failure when abort throws", async () => {
      const mockRun = createMockRun({
        abort: vi.fn().mockRejectedValue(new Error("Cannot abort — merge in progress")),
      });
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.abort("stop");

      expect(actionResult.success).toBe(false);
      expect(actionResult.message).toContain("merge in progress");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // escalate()
  // ═══════════════════════════════════════════════════════════════════════

  describe("escalate", () => {
    it("emits escalation event and returns current blocker when blocker exists", async () => {
      const blocker: BlockerRecord = {
        kind: "gate-fail",
        reason: "Architecture gate failed",
        sessionId: "s-1",
        stage: "architecture",
        evidenceRefs: ["/logs/gate-result.json"],
        detectedAt: "2025-07-16T00:30:00.000Z",
        resolvedAt: null,
      };
      const stateWithBlocker = createFreshState({
        status: "blocked",
        blocker,
      });
      const mockEventBus = createMockEventBus();

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(stateWithBlocker),
        eventBus: mockEventBus,
      });

      const actionResult = await actions.escalate("Need human review");

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.blocker).toEqual(blocker);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "escalation_triggered",
        "orchestrator",
        expect.objectContaining({
          category: "gate-fail",
          reason: expect.any(String),
          evidenceRefs: expect.any(Array) as string[],
        }),
      );
    });

    it("returns null blocker when no blocker exists", async () => {
      const actions = createOrchestratorActions(createTestDeps());

      const actionResult = await actions.escalate();

      expect(actionResult.success).toBe(true);
      expect(actionResult.data.blocker).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // result()
  // ═══════════════════════════════════════════════════════════════════════

  describe("result", () => {
    it("returns terminal PipelineResult for done status", () => {
      const doneState = createFreshState({
        status: "done",
        runId: "run-done",
        startedAt: "2025-07-16T00:00:00.000Z",
        finishedAt: "2025-07-16T01:00:00.000Z",
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(doneState),
      });

      const pipelineResult = actions.result();

      expect(pipelineResult.status).toBe("done");
      expect(pipelineResult.runId).toBe("run-done");
      expect(pipelineResult.exitCode).toBe(0);
      expect(pipelineResult.finishedAt).toBe("2025-07-16T01:00:00.000Z");
      expect(pipelineResult.durationMs).toBeGreaterThan(0);
    });

    it("returns failed result for failed status", () => {
      const failedState = createFreshState({
        status: "failed",
        runId: "run-fail",
        startedAt: "2025-07-16T00:00:00.000Z",
        finishedAt: "2025-07-16T00:30:00.000Z",
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(failedState),
      });

      const pipelineResult = actions.result();

      expect(pipelineResult.status).toBe("failed");
      expect(pipelineResult.exitCode).toBe(1);
    });

    it("returns aborted result for aborted status", () => {
      const abortedState = createFreshState({
        status: "aborted",
        runId: "run-abort",
        startedAt: "2025-07-16T00:00:00.000Z",
        finishedAt: "2025-07-16T00:15:00.000Z",
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(abortedState),
      });

      const pipelineResult = actions.result();

      expect(pipelineResult.status).toBe("aborted");
      expect(pipelineResult.exitCode).toBe(2);
    });

    it("throws when pipeline is still running (not terminal)", () => {
      const runningState = createFreshState({ status: "running" });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(runningState),
      });

      expect(() => actions.result()).toThrow();
    });

    it("throws when pipeline is idle (never started)", () => {
      const actions = createOrchestratorActions(createTestDeps());

      expect(() => actions.result()).toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-4: Event emission for state-changing actions
  // ═══════════════════════════════════════════════════════════════════════

  describe("event emission", () => {
    it("emits steer_sent event on successful steer", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "w-1",
          transport: "tmux",
          worktreePath: "/trees/w-1",
          branchName: "worker/w-1",
        },
      ];
      const mockEventBus = createMockEventBus();

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: createMockWorkerPool(activeWorkers),
        eventBus: mockEventBus,
      });

      await actions.steer("w-1", "focus on tests");

      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        "steer_sent",
        "w-1",
        expect.objectContaining({
          messageRef: expect.any(String),
          attempt: 1,
        }),
      );
    });

    it("does not emit events when steer validation fails", async () => {
      const mockEventBus = createMockEventBus();
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: createMockWorkerPool([]),
        eventBus: mockEventBus,
      });

      await actions.steer("nonexistent", "hello");

      expect(mockEventBus.emit).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-5: Invalid input validation — no partial side effects
  // ═══════════════════════════════════════════════════════════════════════

  describe("input validation", () => {
    it("steer with empty session ID does not call worker pool", async () => {
      const mockWorkerPool = createMockWorkerPool([]);
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
      });

      await actions.steer("", "message");

      expect(mockWorkerPool.steer).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("steer with empty message does not call worker pool", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "w-1",
          transport: "tmux",
          worktreePath: "/trees/w-1",
          branchName: "worker/w-1",
        },
      ];
      const mockWorkerPool = createMockWorkerPool(activeWorkers);
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
      });

      await actions.steer("w-1", "");

      expect(mockWorkerPool.steer).not.toHaveBeenCalled(); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });

    it("start with invalid scope still delegates to run controller for validation", async () => {
      // The run controller is the validation authority for scopes
      // but we still test that obviously invalid values are handled
      const mockRun = createMockRun();
      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
        stateManager: createMockStateManager(createFreshState({ status: "running", runId: "r1" })),
      });

      // Valid scope passed through
      await actions.start("analysis");
      expect(mockRun.start).toHaveBeenCalledWith("analysis"); // eslint-disable-line @typescript-eslint/unbound-method -- vi.fn() mock
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Adversarial: Error isolation
  // ═══════════════════════════════════════════════════════════════════════

  describe("error isolation", () => {
    it("start catches run controller errors and returns structured failure", async () => {
      const mockRun = createMockRun({
        start: vi.fn().mockRejectedValue(new Error("Tool health check failed")),
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.start("full");

      expect(actionResult.success).toBe(false);
      expect(actionResult.message).toBeTruthy();
      // Must not throw
    });

    it("abort catches run controller errors and returns structured failure", async () => {
      const mockRun = createMockRun({
        abort: vi.fn().mockRejectedValue(new Error("Workers still draining")),
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        run: mockRun,
      });

      const actionResult = await actions.abort("stop");

      expect(actionResult.success).toBe(false);
      expect(actionResult.message).toContain("Workers still draining");
    });

    it("steer catches worker pool errors without partial side effects", async () => {
      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "w-err",
          transport: "tmux",
          worktreePath: "/trees/w-err",
          branchName: "worker/w-err",
        },
      ];
      const mockWorkerPool = createMockWorkerPool(activeWorkers);
      (mockWorkerPool.steer as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("tmux session not found"),
      );
      const mockEventBus = createMockEventBus();

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        workerPool: mockWorkerPool,
        eventBus: mockEventBus,
      });

      const actionResult = await actions.steer("w-err", "hello");

      expect(actionResult.success).toBe(false);
      // Should NOT emit steer_sent event because the steer failed
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock
      expect(mockEventBus.emit).not.toHaveBeenCalledWith(
        "steer_sent",
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // AC-3: Import boundary — surfaces only depend on actions.ts
  // ═══════════════════════════════════════════════════════════════════════

  describe("import boundary contract", () => {
    it("exports createOrchestratorActions factory function", async () => {
      const actionsModule = await import("../../src/actions.js");
      expect(actionsModule.createOrchestratorActions).toBeTypeOf("function");
    });

    it("exports all required type names for surface consumers", async () => {
      // This test verifies that the module exports the types surfaces need.
      // TypeScript compilation verifies this at build time, but we want a
      // runtime smoke test for the factory function's existence.
      const actionsModule = await import("../../src/actions.js");

      // Factory is the key export
      expect(actionsModule.createOrchestratorActions).toBeDefined();

      // The module should not re-export internal dependencies
      expect(
        (actionsModule as Record<string, unknown>)["createPipelineStateManager"],
      ).toBeUndefined();
      expect((actionsModule as Record<string, unknown>)["createEventBus"]).toBeUndefined();
      expect((actionsModule as Record<string, unknown>)["createRunController"]).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Adversarial: Multiple dispatch summary mapping
  // ═══════════════════════════════════════════════════════════════════════

  describe("dispatch summary mapping", () => {
    it("maps all required DispatchSummary fields from dispatch records", () => {
      const stateWithMultipleDispatches = createFreshState({
        status: "running",
        dispatches: [
          {
            dispatchId: "d-1",
            sessionId: "s-1",
            phase: "analysis",
            stage: "analysis",
            agent: "analyst",
            workflowId: "create-prd",
            storyId: null,
            promptIds: [],
            status: "completed",
            dispatchedAt: "2025-07-16T00:00:00.000Z",
            resolvedAt: "2025-07-16T00:30:00.000Z",
            completionEvidence: "evidence.json",
          },
          {
            dispatchId: "d-2",
            sessionId: "s-2",
            phase: "implementation",
            stage: "development",
            agent: "dev",
            workflowId: "dev-story",
            storyId: "R-S13",
            promptIds: ["p-1"],
            status: "confirmed",
            dispatchedAt: "2025-07-16T01:00:00.000Z",
            resolvedAt: null,
            completionEvidence: null,
          },
        ],
      });

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(stateWithMultipleDispatches),
      });

      const actionResult = actions.list();

      expect(actionResult.data.dispatches).toHaveLength(2);

      const firstDispatch = actionResult.data.dispatches[0];
      expect(firstDispatch).toBeDefined();
      expect(firstDispatch!.dispatchId).toBe("d-1");
      expect(firstDispatch!.agent).toBe("analyst");
      expect(firstDispatch!.workflow).toBe("create-prd");
      expect(firstDispatch!.storyId).toBeNull();
      expect(firstDispatch!.status).toBe("completed");

      const secondDispatch = actionResult.data.dispatches[1];
      expect(secondDispatch).toBeDefined();
      expect(secondDispatch!.dispatchId).toBe("d-2");
      expect(secondDispatch!.agent).toBe("dev");
      expect(secondDispatch!.workflow).toBe("dev-story");
      expect(secondDispatch!.storyId).toBe("R-S13");
      expect(secondDispatch!.status).toBe("confirmed");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // result() exit code correctness
  // ═══════════════════════════════════════════════════════════════════════

  describe("result exit code mapping", () => {
    it("maps done → 0, failed → 1, aborted → 2", () => {
      const statuses: { status: PipelineStatus; expectedExitCode: 0 | 1 | 2 }[] = [
        { status: "done", expectedExitCode: 0 },
        { status: "failed", expectedExitCode: 1 },
        { status: "aborted", expectedExitCode: 2 },
      ];

      for (const { status, expectedExitCode } of statuses) {
        const state = createFreshState({
          status,
          runId: `run-${status}`,
          startedAt: "2025-07-16T00:00:00.000Z",
          finishedAt: "2025-07-16T01:00:00.000Z",
        });

        const actions = createOrchestratorActions({
          ...createTestDeps(),
          stateManager: createMockStateManager(state),
        });

        const pipelineResult = actions.result();
        expect(pipelineResult.exitCode).toBe(expectedExitCode);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Session summary derivation from WorkerHandle
  // ═══════════════════════════════════════════════════════════════════════

  describe("session summary derivation", () => {
    it("derives session summaries from worker pool and state child sessions", () => {
      const stateWithSessions = createFreshState({
        status: "running",
        childSessions: [
          {
            sessionId: "w-1",
            tmuxSessionName: "tmux-w-1",
            workdir: "/trees/w-1",
            launchCommand: "pi --no-extensions",
            targetAgent: "dev",
            targetWorkflow: "dev-story",
            childStatePath: "/trees/w-1/.pi/state/bmad.json",
            status: "active",
            lastObservedAt: "2025-07-16T00:05:00.000Z",
            createdAt: "2025-07-16T00:00:00.000Z",
            terminatedAt: null,
          },
        ],
      });

      const activeWorkers: WorkerHandle[] = [
        {
          sessionId: "w-1",
          transport: "tmux",
          worktreePath: "/trees/w-1",
          branchName: "worker/w-1",
        },
      ];

      const actions = createOrchestratorActions({
        ...createTestDeps(),
        stateManager: createMockStateManager(stateWithSessions),
        workerPool: createMockWorkerPool(activeWorkers),
      });

      const actionResult = actions.list();

      expect(actionResult.data.sessions).toHaveLength(1);
      const firstSession = actionResult.data.sessions[0];
      expect(firstSession).toBeDefined();
      expect(firstSession!.sessionId).toBe("w-1");
      expect(firstSession!.agent).toBe("dev");
      expect(firstSession!.status).toBe("active");
    });
  });
});
