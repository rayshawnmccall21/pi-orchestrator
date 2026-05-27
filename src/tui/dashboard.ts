/**
 * Read-only TUI dashboard widget — state projection and lifecycle.
 *
 * The dashboard subscribes to `stateManager.onStateChange` and
 * `eventBus.onEvent` for real-time updates. Rendering is delegated
 * to `tui/render.ts` (pure functions). The widget never mutates state.
 *
 * @see R-S14 AC-3 (real state, not mocks), AC-5 (disposal)
 */

import type { OrchestratorEvent, PipelineRunState, PipelineEvent } from "../shared/types.js";
import {
  renderDashboard,
  type DashboardSnapshot,
  type DashboardStageRow,
  type DashboardEventRow,
  type DashboardStageStatus,
} from "./render.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Read-only state reader for pipeline state. */
interface DashboardStateReader {
  /** Read the current frozen pipeline state. */
  getState(): Readonly<PipelineRunState>;
  /** Subscribe to state changes. Returns a dispose function. */
  onStateChange(callback: (state: Readonly<PipelineRunState>) => void): () => void;
}

/** Event subscriber for dashboard updates. */
interface DashboardEventSource {
  /** Subscribe to all emitted events. Returns a dispose function. */
  onEvent(callback: (event: OrchestratorEvent) => void): () => void;
}

/** Dependencies for the dashboard widget — read-only access only. */
export interface DashboardWidgetDeps {
  /** State reader for pipeline state reads. */
  stateManager: DashboardStateReader;
  /** Event source for real-time event subscription. */
  eventBus: DashboardEventSource;
}

/** TUI handle providing re-render request capability. */
export interface TuiHandle {
  /** Request a re-render of the widget. */
  requestRender(force?: boolean): void;
}

/** Dashboard widget interface returned by the factory. */
export interface DashboardWidget {
  /** Render the dashboard at the given terminal width. Returns lines. */
  render(width: number): string[];
  /** Clean up subscriptions and timers. Idempotent. */
  dispose(): void;
  /** Invalidate cached render state (no-op for stateless rendering). */
  invalidate(): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum events retained for display. */
const MAX_EVENT_BUFFER_SIZE = 50;
/** Dashboard refresh interval in milliseconds. */
const REFRESH_INTERVAL_MS = 500;
/** Progress fraction for completed dispatches. */
const PROGRESS_COMPLETE = 1.0;
/** Progress fraction for active dispatches. */
const PROGRESS_ACTIVE = 0.5;
/** Progress fraction for failed dispatches. */
const PROGRESS_FAILED = 0.0;

// ═══════════════════════════════════════════════════════════════════════════
// State Projection — maps PipelineRunState to DashboardSnapshot
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map pipeline status string to stage display status.
 *
 * @param pipelineStatus - Pipeline status string.
 * @param isActive - Whether this stage is currently active.
 *
 * @returns Display status for the dashboard row.
 *
 * @example
 * ```typescript
 * mapPipelineStatusToStageStatus("running", true); // "running"
 * ```
 */
function mapPipelineStatusToStageStatus(
  pipelineStatus: string,
  isActive: boolean,
): DashboardStageStatus {
  if (!isActive) {
    return "pending";
  }
  switch (pipelineStatus) {
    case "running": {
      return "running";
    }
    case "blocked":
    case "needs-human": {
      return "blocked";
    }
    case "done": {
      return "done";
    }
    case "failed":
    case "aborted": {
      return "failed";
    }
    default: {
      return "pending";
    }
  }
}

/**
 * Map severity string to typed severity level.
 *
 * @param severity - Raw severity string.
 *
 * @returns Typed severity: "info", "warn", or "error".
 *
 * @example
 * ```typescript
 * mapEventSeverity("error"); // "error"
 * ```
 */
function mapEventSeverity(severity: string): "info" | "warn" | "error" {
  if (severity === "error") {
    return "error";
  }
  if (severity === "warn") {
    return "warn";
  }
  return "info";
}

/**
 * Project pipeline events into dashboard event rows.
 *
 * @param pipelineEvents - In-state event log entries.
 * @param externalEvents - External event bus entries.
 *
 * @returns Sorted array of dashboard event rows.
 *
 * @example
 * ```typescript
 * projectEventRows(state.events, busEvents);
 * ```
 */
function projectEventRows(
  pipelineEvents: readonly PipelineEvent[],
  externalEvents: readonly OrchestratorEvent[],
): DashboardEventRow[] {
  const rows: DashboardEventRow[] = [];

  for (const pipelineEvent of pipelineEvents) {
    rows.push({
      timestamp: pipelineEvent.timestamp,
      kind: pipelineEvent.kind,
      severity: mapEventSeverity(pipelineEvent.severity),
      message: pipelineEvent.message,
    });
  }

  for (const externalEvent of externalEvents) {
    rows.push({
      timestamp: externalEvent.timestamp,
      kind: externalEvent.kind,
      severity: mapEventSeverity(externalEvent.level),
      message:
        typeof externalEvent.payload === "object"
          ? JSON.stringify(externalEvent.payload)
          : String(externalEvent.payload),
    });
  }

  rows.sort((eventA, eventB) => eventA.timestamp.localeCompare(eventB.timestamp));
  return rows;
}

/**
 * Determine dispatch status classification.
 *
 * @param dispatchStatus - Raw dispatch status string.
 *
 * @returns Classified stage status.
 *
 * @example
 * ```typescript
 * classifyDispatchStatus("completed"); // "done"
 * ```
 */
function classifyDispatchStatus(dispatchStatus: string): DashboardStageStatus {
  if (dispatchStatus === "sent" || dispatchStatus === "confirmed") {
    return "running";
  }
  if (dispatchStatus === "completed") {
    return "done";
  }
  if (dispatchStatus === "failed" || dispatchStatus === "abandoned") {
    return "failed";
  }
  return "pending";
}

/**
 * Estimate progress from dispatch status.
 *
 * @param stageStatus - Classified stage status.
 *
 * @returns Progress fraction 0..1, or null.
 *
 * @example
 * ```typescript
 * estimateProgress("done"); // 1.0
 * ```
 */
function estimateProgress(stageStatus: DashboardStageStatus): number | null {
  if (stageStatus === "done") {
    return PROGRESS_COMPLETE;
  }
  if (stageStatus === "running") {
    return PROGRESS_ACTIVE;
  }
  if (stageStatus === "failed") {
    return PROGRESS_FAILED;
  }
  return null;
}

/**
 * Compute elapsed milliseconds for a dispatch.
 *
 * @param dispatchedAt - ISO-8601 dispatch timestamp.
 * @param resolvedAt - ISO-8601 resolution timestamp, or null.
 *
 * @returns Elapsed milliseconds, or null.
 *
 * @example
 * ```typescript
 * computeElapsedMs("2025-01-01T00:00:00Z", null);
 * ```
 */
function computeElapsedMs(dispatchedAt: string, resolvedAt: string | null): number | null {
  if (dispatchedAt.length === 0) {
    return null;
  }
  const endTime = resolvedAt ?? new Date().toISOString();
  return new Date(endTime).getTime() - new Date(dispatchedAt).getTime();
}

/**
 * Project stage rows from pipeline dispatches.
 *
 * @param state - Read-only pipeline run state.
 *
 * @returns Array of stage rows for dashboard rendering.
 *
 * @example
 * ```typescript
 * projectStageRows(pipelineState);
 * ```
 */
function projectStageRows(state: Readonly<PipelineRunState>): DashboardStageRow[] {
  const rows: DashboardStageRow[] = [];

  for (const dispatch of state.dispatches) {
    const stageStatus = classifyDispatchStatus(dispatch.status);

    rows.push({
      stage: dispatch.stage,
      agent: dispatch.agent,
      workflowId: dispatch.workflowId,
      activeStep: state.activeStepId,
      status: stageStatus,
      progress: estimateProgress(stageStatus),
      elapsedMs: computeElapsedMs(dispatch.dispatchedAt, dispatch.resolvedAt),
      loopCount: 0,
    });
  }

  // If no dispatches but pipeline is active, show a single status row
  if (rows.length === 0 && state.status !== "idle") {
    rows.push({
      stage: state.activeStage ?? state.phase,
      agent: "orchestrator",
      workflowId: state.activeWorkflowId ?? "—",
      activeStep: state.activeStepId,
      status: mapPipelineStatusToStageStatus(state.status, true),
      progress: null,
      elapsedMs: null,
      loopCount: 0,
    });
  }

  return rows;
}

/**
 * Project real pipeline state + events into a dashboard snapshot.
 *
 * This is the bridge between domain state and render layer.
 * Pure function: no side effects, no I/O.
 *
 * @param state - Current pipeline run state (read-only).
 * @param externalEvents - Recent events from the event bus buffer.
 *
 * @returns A DashboardSnapshot for the render layer.
 *
 * @example
 * ```typescript
 * projectDashboardSnapshot(pipelineState, recentEvents);
 * ```
 */
export function projectDashboardSnapshot(
  state: Readonly<PipelineRunState>,
  externalEvents: readonly OrchestratorEvent[],
): DashboardSnapshot {
  const stages = projectStageRows(state);
  const events = projectEventRows(state.events, externalEvents);

  const runningCount = stages.filter((stageRow) => stageRow.status === "running").length;
  const blockedCount = stages.filter((stageRow) => stageRow.status === "blocked").length;
  const doneCount = stages.filter((stageRow) => stageRow.status === "done").length;
  const totalLoops = stages.reduce((sum, stageRow) => sum + stageRow.loopCount, 0);

  return {
    pipelineId: state.pipelineId,
    runId: state.runId,
    status: state.status,
    summary: {
      counts: {
        running: runningCount,
        blocked: blockedCount,
        done: doneCount,
        loops: totalLoops,
      },
    },
    stages,
    events,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Widget Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a read-only dashboard widget.
 *
 * The widget subscribes to state changes and event bus for real-time updates,
 * and delegates rendering to pure functions in `tui/render.ts`.
 *
 * @param tuiHandle - TUI handle for requesting re-renders.
 * @param deps - Dependencies (state manager + event bus).
 *
 * @returns A DashboardWidget with render, dispose, and invalidate methods.
 *
 * @example
 * ```typescript
 * const widget = createDashboardWidget(tuiHandle, { stateManager, eventBus });
 * const lines = widget.render(120);
 * widget.dispose();
 * ```
 */
export function createDashboardWidget(
  tuiHandle: TuiHandle,
  deps: DashboardWidgetDeps,
): DashboardWidget {
  let disposed = false;
  const eventBuffer: OrchestratorEvent[] = [];

  // Subscribe to state changes
  const disposeStateSubscription = deps.stateManager.onStateChange(() => {
    if (!disposed) {
      tuiHandle.requestRender();
    }
  });

  // Subscribe to event bus
  const disposeEventSubscription = deps.eventBus.onEvent((event: OrchestratorEvent) => {
    if (disposed) {
      return;
    }
    eventBuffer.push(event);
    if (eventBuffer.length > MAX_EVENT_BUFFER_SIZE) {
      eventBuffer.splice(0, eventBuffer.length - MAX_EVENT_BUFFER_SIZE);
    }
    tuiHandle.requestRender();
  });

  // Animation timer
  const refreshTimer = setInterval(() => {
    if (!disposed) {
      tuiHandle.requestRender();
    }
  }, REFRESH_INTERVAL_MS);

  return {
    render(width: number): string[] {
      if (disposed) {
        return [];
      }
      const state = deps.stateManager.getState();
      const snapshot = projectDashboardSnapshot(state, eventBuffer);
      return renderDashboard(snapshot, Date.now(), width);
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      clearInterval(refreshTimer);
      disposeStateSubscription();
      disposeEventSubscription();
    },

    invalidate(): void {
      // No cached state — pure functional rendering.
    },
  };
}
