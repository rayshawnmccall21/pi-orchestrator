/**
 * Typed surface boundary for all slash command and extension tool interactions.
 *
 * `OrchestratorActions` is the **only** callable boundary for surfaces.
 * Slash commands, tools, and headless runners call actions — never
 * worker pool, state manager, or run controller directly.
 *
 * @see Section 5.15 of pi-package-refactor-plan.md
 */

import { OrchestratorError } from "./shared/errors.js";
import type {
  ActionResult,
  BlockerRecord,
  ChildSessionRecord,
  PipelineResult,
  PipelineRunState,
  PipelineStatus,
  WorkflowDispatchRecord,
  WorktreeStatus,
} from "./shared/types.js";
import type { OrchestratorEventBus } from "./events/bus.js";
import type { PipelineStateManager } from "./state/pipeline.js";

// ═══════════════════════════════════════════════════════════════════════════
// Scope & Summary Types
// ═══════════════════════════════════════════════════════════════════════════

/** Scope of a pipeline start request. */
export type StartScope = "analysis" | "planning" | "architecture" | "implementation" | "full";

/** Summary of an in-flight workflow dispatch. */
export interface DispatchSummary {
  /** Unique dispatch ID. */
  dispatchId: string;
  /** BMAD agent ID. */
  agent: string;
  /** BMAD workflow ID. */
  workflow: string;
  /** Story ID, or null for phase-scoped dispatches. */
  storyId: string | null;
  /** Current dispatch status. */
  status: string;
}

/** Summary of a worker session. */
export interface SessionSummary {
  /** Unique session ID. */
  sessionId: string;
  /** BMAD agent ID. */
  agent: string;
  /** Worker lifecycle status. */
  status: WorktreeStatus;
  /** ISO-8601 last heartbeat timestamp. */
  lastHeartbeat: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Dependency Ports (inlined until R-S12 / R-S8 land)
// ═══════════════════════════════════════════════════════════════════════════

/** Run controller interface consumed by actions. */
export interface OrchestratorRun {
  /** Start a pipeline run with the given scope. */
  start(scope?: StartScope): Promise<void>;
  /** Pause the running pipeline. */
  pause(): void;
  /** Resume a paused pipeline. */
  resume(): void;
  /** Abort the pipeline with optional reason. */
  abort(reason?: string): Promise<void>;
  /** Whether the pipeline is currently paused. */
  isPaused(): boolean;
  /** Whether the pipeline is currently running. */
  isRunning(): boolean;
}

/** Worker handle returned by the pool. */
export interface WorkerHandle {
  /** Unique session ID. */
  sessionId: string;
  /** Transport mechanism. */
  transport: "tmux" | "spawn";
  /** Absolute worktree path. */
  worktreePath: string;
  /** Git branch name. */
  branchName: string;
}

/** Worker pool interface consumed by actions. */
export interface WorkerPool {
  /** Send a diagnostic steer message to a worker. */
  steer(sessionId: string, message: string): Promise<void>;
  /** Get all active worker handles. */
  getActiveWorkers(): WorkerHandle[];
}

/** Typed surface boundary — all surface calls route through this interface. */
export interface OrchestratorActions {
  /** Start a new pipeline run with the given scope. */
  start(
    scope: StartScope,
  ): Promise<ActionResult<{ runId: string; status: PipelineStatus; phase: string }>>;
  /** Query current pipeline state. */
  status(): ActionResult<PipelineRunState | { active: false }>;
  /** List active dispatches and worker sessions. */
  list(): ActionResult<{ dispatches: DispatchSummary[]; sessions: SessionSummary[] }>;
  /** Inject a steer message into a worker session. */
  steer(sessionId: string, message: string): Promise<ActionResult<{ dispatched: boolean }>>;
  /** Pause the running pipeline. */
  pause(): Promise<ActionResult<{ paused: true }>>;
  /** Resume a paused pipeline. */
  resume(): Promise<ActionResult<{ paused: false }>>;
  /** Abort the pipeline with optional reason. */
  abort(reason?: string): Promise<ActionResult<{ status: "aborted" }>>;
  /** Trigger escalation for current blocker. */
  escalate(reason?: string): Promise<ActionResult<{ blocker: BlockerRecord | null }>>;
  /** Get final pipeline result after completion. */
  result(): PipelineResult;
}

/** Dependencies injected into the actions factory. */
export interface OrchestratorActionsDeps {
  /** Run controller for lifecycle operations. */
  run: OrchestratorRun;
  /** State manager for reading pipeline state. */
  stateManager: PipelineStateManager;
  /** Worker pool for session operations. */
  workerPool: WorkerPool;
  /** Event bus for audit events. */
  eventBus: OrchestratorEventBus;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants & Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Exhaustive child session → worktree status mapping (no type assertions needed). */
const SESSION_TO_WORKTREE: Readonly<Record<ChildSessionRecord["status"], WorktreeStatus>> = {
  creating: "creating",
  launching: "creating",
  active: "active",
  idle: "idle",
  stale: "stale",
  dead: "dead",
  killed: "dead",
};

/** Exit code for success. */
const EXIT_CODE_DONE = 0 satisfies PipelineResult["exitCode"];
/** Exit code for failure. */
const EXIT_CODE_FAILED = 1 satisfies PipelineResult["exitCode"];
/** Exit code for abort. */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Named exit code constant.
const EXIT_CODE_ABORTED = 2 satisfies PipelineResult["exitCode"];
/** Exit code for system failure. */
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Named exit code constant.
const EXIT_CODE_SYSTEM_FAILURE = 3 satisfies PipelineResult["exitCode"];

const EXIT_CODE_BY_STATUS: Readonly<Record<string, PipelineResult["exitCode"]>> = {
  done: EXIT_CODE_DONE,
  failed: EXIT_CODE_FAILED,
  aborted: EXIT_CODE_ABORTED,
};

function isTerminalStatus(status: PipelineStatus): status is "done" | "failed" | "aborted" {
  return status === "done" || status === "failed" || status === "aborted";
}

function extractErrorMessage(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function mapDispatchToSummary(dispatchRecord: WorkflowDispatchRecord): DispatchSummary {
  return {
    dispatchId: dispatchRecord.dispatchId,
    agent: dispatchRecord.agent,
    workflow: dispatchRecord.workflowId,
    storyId: dispatchRecord.storyId,
    status: dispatchRecord.status,
  };
}

function deriveSessionSummaries(
  workerHandles: WorkerHandle[],
  childSessionRecords: ChildSessionRecord[],
): SessionSummary[] {
  const sessionMap = new Map<string, ChildSessionRecord>();
  for (const record of childSessionRecords) {
    sessionMap.set(record.sessionId, record);
  }
  return workerHandles.map((handle) => {
    const record = sessionMap.get(handle.sessionId);
    return {
      sessionId: handle.sessionId,
      agent: record?.targetAgent ?? "unknown",
      status:
        record !== undefined ? SESSION_TO_WORKTREE[record.status] : SESSION_TO_WORKTREE.active,
      lastHeartbeat: record?.lastObservedAt ?? new Date().toISOString(),
    };
  });
}

function buildPipelineResult(pipelineState: Readonly<PipelineRunState>): PipelineResult {
  if (!isTerminalStatus(pipelineState.status)) {
    throw new OrchestratorError(
      `Cannot build result — pipeline is "${pipelineState.status}", expected terminal`,
      "RESULT_NOT_TERMINAL",
      { status: pipelineState.status, runId: pipelineState.runId },
    );
  }
  const finishedAt = pipelineState.finishedAt ?? new Date().toISOString();
  const durationMs = new Date(finishedAt).getTime() - new Date(pipelineState.startedAt).getTime();
  const evidenceRefs: string[] = [];
  for (const phase of pipelineState.completedPhases) {
    evidenceRefs.push(...phase.artifacts);
  }
  return {
    status: pipelineState.status,
    runId: pipelineState.runId,
    exitCode: EXIT_CODE_BY_STATUS[pipelineState.status] ?? EXIT_CODE_SYSTEM_FAILURE,
    message: `Pipeline ${pipelineState.status}: ${pipelineState.runId}`,
    evidenceRefs,
    finishedAt,
    durationMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Action Implementations
// ═══════════════════════════════════════════════════════════════════════════

async function executeStart(
  deps: OrchestratorActionsDeps,
  scope: StartScope,
): Promise<ActionResult<{ runId: string; status: PipelineStatus; phase: string }>> {
  try {
    await deps.run.start(scope);
    const state = deps.stateManager.getState();
    return {
      success: true,
      message: `Pipeline started with scope: ${scope}`,
      data: { runId: state.runId, status: state.status, phase: state.phase },
    };
  } catch (thrown: unknown) {
    const idleStatus: PipelineStatus = "idle";
    return {
      success: false,
      message: `Failed to start pipeline: ${extractErrorMessage(thrown)}`,
      data: { runId: "", status: idleStatus, phase: "" },
    };
  }
}

function executeStatus(
  deps: OrchestratorActionsDeps,
): ActionResult<PipelineRunState | { active: false }> {
  const state = deps.stateManager.getState();
  if (state.status === "idle") {
    return { success: true, message: "No active pipeline run", data: { active: false } };
  }
  return { success: true, message: `Pipeline ${state.status}`, data: state };
}

function executeList(
  deps: OrchestratorActionsDeps,
): ActionResult<{ dispatches: DispatchSummary[]; sessions: SessionSummary[] }> {
  const state = deps.stateManager.getState();
  const dispatches = state.dispatches.map(mapDispatchToSummary);
  const sessions = deriveSessionSummaries(deps.workerPool.getActiveWorkers(), state.childSessions);
  return {
    success: true,
    message: `${dispatches.length.toString()} dispatch(es), ${sessions.length.toString()} session(s)`,
    data: { dispatches, sessions },
  };
}

async function executeSteer(
  deps: OrchestratorActionsDeps,
  sessionId: string,
  steerMessage: string,
): Promise<ActionResult<{ dispatched: boolean }>> {
  if (sessionId.length === 0) {
    return { success: false, message: "Session ID is required", data: { dispatched: false } };
  }
  if (steerMessage.length === 0) {
    return { success: false, message: "Steer message is required", data: { dispatched: false } };
  }
  const match = deps.workerPool.getActiveWorkers().find((h) => h.sessionId === sessionId);
  if (match === undefined) {
    return {
      success: false,
      message: `Session "${sessionId}" not found or not active`,
      data: { dispatched: false },
    };
  }
  try {
    await deps.workerPool.steer(sessionId, steerMessage);
    deps.eventBus.emit("steer_sent", sessionId, { messageRef: steerMessage, attempt: 1 });
    return {
      success: true,
      message: `Steer message sent to ${sessionId}`,
      data: { dispatched: true },
    };
  } catch (thrown: unknown) {
    return {
      success: false,
      message: `Steer failed: ${extractErrorMessage(thrown)}`,
      data: { dispatched: false },
    };
  }
}

async function executeAbort(
  deps: OrchestratorActionsDeps,
  reason: string | undefined,
): Promise<ActionResult<{ status: "aborted" }>> {
  try {
    await deps.run.abort(reason);
    const msg =
      reason !== undefined && reason.length > 0
        ? `Pipeline aborted: ${reason}`
        : "Pipeline aborted";
    return { success: true, message: msg, data: { status: "aborted" } };
  } catch (thrown: unknown) {
    return {
      success: false,
      message: `Abort failed: ${extractErrorMessage(thrown)}`,
      data: { status: "aborted" },
    };
  }
}

function executeEscalate(
  deps: OrchestratorActionsDeps,
  reason: string | undefined,
): ActionResult<{ blocker: BlockerRecord | null }> {
  const blocker = deps.stateManager.getState().blocker;
  if (blocker === null) {
    return { success: true, message: "No active blocker to escalate", data: { blocker: null } };
  }
  deps.eventBus.emit("escalation_triggered", "orchestrator", {
    category: blocker.kind,
    reason: reason ?? blocker.reason,
    evidenceRefs: blocker.evidenceRefs,
  });
  return { success: true, message: `Blocker escalated: ${blocker.kind}`, data: { blocker } };
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates the typed OrchestratorActions boundary.
 *
 * All lifecycle operations delegate to the run controller. Read-only queries
 * read from the state manager and worker pool. Steer delegates to the pool.
 *
 * @param deps - Injected dependencies.
 *
 * @returns OrchestratorActions instance.
 *
 * @example
 * ```typescript
 * const actions = createOrchestratorActions(deps);
 * const statusResult = actions.status();
 * ```
 */
export function createOrchestratorActions(deps: OrchestratorActionsDeps): OrchestratorActions {
  return {
    start: (scope) => executeStart(deps, scope),
    status: () => executeStatus(deps),
    list: () => executeList(deps),
    steer: (sessionId, message) => executeSteer(deps, sessionId, message),
    pause(): Promise<ActionResult<{ paused: true }>> {
      deps.run.pause();
      return Promise.resolve({ success: true, message: "Pipeline paused", data: { paused: true } });
    },
    resume(): Promise<ActionResult<{ paused: false }>> {
      deps.run.resume();
      return Promise.resolve({
        success: true,
        message: "Pipeline resumed",
        data: { paused: false },
      });
    },
    abort: (reason) => executeAbort(deps, reason),
    escalate: (reason) => Promise.resolve(executeEscalate(deps, reason)),
    result: () => buildPipelineResult(deps.stateManager.getState()),
  };
}
