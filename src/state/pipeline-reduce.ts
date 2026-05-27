/**
 * Private pure reducer for PipelineRunState mutations.
 *
 * Every function is pure: no I/O, no side effects. The reducer produces
 * a new state object from (currentState, mutation). Array fields always
 * produce new references — never mutated in place.
 *
 * This module is imported only by `state/pipeline.ts`.
 */

import type {
  ChildSessionRecord,
  PipelineRunState,
  PipelineStatus,
  StateMutation,
  StoryLifecycleState,
  StoryReviewLoopState,
  WorkflowDispatchRecord,
} from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Pipeline statuses that indicate the run has finished. */
const TERMINAL_STATUSES: ReadonlySet<PipelineStatus> = new Set(["done", "failed", "aborted"]);

/** Dispatch statuses that indicate the dispatch has resolved. */
const TERMINAL_DISPATCH_STATUSES: ReadonlySet<WorkflowDispatchRecord["status"]> = new Set([
  "completed",
  "failed",
  "abandoned",
]);

/** Child session statuses that indicate the session has terminated. */
const TERMINAL_SESSION_STATUSES: ReadonlySet<ChildSessionRecord["status"]> = new Set([
  "dead",
  "killed",
]);

/** Default maximum e2e attempts per story lifecycle. */
const DEFAULT_MAX_E2E_ATTEMPTS = 3;

/** Default maximum review loopbacks per story lifecycle. */
const DEFAULT_MAX_REVIEW_LOOPBACKS = 3;

// ═══════════════════════════════════════════════════════════════════════════
// Timestamp Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Applies a partial update with a fresh `updatedAt` timestamp.
 *
 * @param state - Current state.
 * @param partial - Fields to merge into the new state.
 *
 * @returns New state with the partial update and fresh timestamp.
 *
 * @example
 * ```typescript
 * const newState = withTimestamp(state, { status: "running" });
 * ```
 */
function withTimestamp(
  state: PipelineRunState,
  partial: Partial<PipelineRunState>,
): PipelineRunState {
  return { ...state, ...partial, updatedAt: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Reducer — split into category functions for low cyclomatic complexity
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pure reducer: (state, mutation) → newState.
 * Dispatches to category sub-reducers to stay under complexity limits.
 *
 * @param state - Current pipeline state (not mutated).
 * @param mutation - The mutation to apply.
 *
 * @returns A new PipelineRunState reflecting the mutation.
 *
 * @example
 * ```typescript
 * const newState = reduceMutation(currentState, { kind: "set-status", status: "running", reason: "start" });
 * ```
 */
export function reduceMutation(state: PipelineRunState, mutation: StateMutation): PipelineRunState {
  if (isLifecycleMutation(mutation)) {
    return reduceLifecycleMutation(state, mutation);
  }
  if (isRecordMutation(mutation)) {
    return reduceRecordMutation(state, mutation);
  }
  return reduceAuditMutation(state, mutation);
}

/** Lifecycle mutation kinds — status, phase, stage, blocker, echo fields. */
const LIFECYCLE_KINDS = new Set([
  "set-status",
  "advance-phase",
  "set-active-stage",
  "set-blocker",
  "clear-blocker",
  "update-echo-fields",
]);

/** Record mutation kinds — dispatches, sessions, prompts, approvals. */
const RECORD_KINDS = new Set([
  "record-dispatch",
  "update-dispatch",
  "record-child-session",
  "update-child-session",
  "record-prompt",
  "record-approval",
]);

/**
 * Type guard for lifecycle mutations.
 *
 * @param mutation - Mutation to check.
 *
 * @returns True if the mutation is a lifecycle mutation.
 *
 * @example
 * ```typescript
 * if (isLifecycleMutation(m)) { reduceLifecycleMutation(state, m); }
 * ```
 */
function isLifecycleMutation(mutation: StateMutation): mutation is Extract<
  StateMutation,
  {
    kind:
      | "set-status"
      | "advance-phase"
      | "set-active-stage"
      | "set-blocker"
      | "clear-blocker"
      | "update-echo-fields";
  }
> {
  return LIFECYCLE_KINDS.has(mutation.kind);
}

/**
 * Type guard for record mutations.
 *
 * @param mutation - Mutation to check.
 *
 * @returns True if the mutation is a record mutation.
 *
 * @example
 * ```typescript
 * if (isRecordMutation(m)) { reduceRecordMutation(state, m); }
 * ```
 */
function isRecordMutation(mutation: StateMutation): mutation is Extract<
  StateMutation,
  {
    kind:
      | "record-dispatch"
      | "update-dispatch"
      | "record-child-session"
      | "update-child-session"
      | "record-prompt"
      | "record-approval";
  }
> {
  return RECORD_KINDS.has(mutation.kind);
}

/**
 * Reduces lifecycle / status / echo mutations.
 *
 * @param state - Current pipeline state.
 * @param mutation - A lifecycle-category mutation.
 *
 * @returns New pipeline state with lifecycle fields updated.
 *
 * @example
 * ```typescript
 * reduceLifecycleMutation(state, { kind: "set-status", status: "running", reason: "go" });
 * ```
 */
function reduceLifecycleMutation(
  state: PipelineRunState,
  mutation: Extract<
    StateMutation,
    {
      kind:
        | "set-status"
        | "advance-phase"
        | "set-active-stage"
        | "set-blocker"
        | "clear-blocker"
        | "update-echo-fields";
    }
  >,
): PipelineRunState {
  switch (mutation.kind) {
    case "set-status":
      return reduceSetStatus(state, mutation.status);
    case "advance-phase":
      return withTimestamp(state, { phase: mutation.phase, activeStage: mutation.stage });
    case "set-active-stage":
      return withTimestamp(state, { activeStage: mutation.stage });
    case "set-blocker":
      return withTimestamp(state, { blocker: mutation.blocker });
    case "clear-blocker":
      return withTimestamp(state, { blocker: null });
    case "update-echo-fields":
      return reduceEchoFields(state, mutation);
  }
}

/**
 * Reduces record/update mutations for dispatches, sessions, prompts, approvals.
 *
 * @param state - Current pipeline state.
 * @param mutation - A record-category mutation.
 *
 * @returns New pipeline state with records appended or updated.
 *
 * @example
 * ```typescript
 * reduceRecordMutation(state, { kind: "record-dispatch", dispatch });
 * ```
 */
function reduceRecordMutation(
  state: PipelineRunState,
  mutation: Extract<
    StateMutation,
    {
      kind:
        | "record-dispatch"
        | "update-dispatch"
        | "record-child-session"
        | "update-child-session"
        | "record-prompt"
        | "record-approval";
    }
  >,
): PipelineRunState {
  switch (mutation.kind) {
    case "record-dispatch":
      return withTimestamp(state, { dispatches: [...state.dispatches, mutation.dispatch] });
    case "update-dispatch":
      return reduceUpdateDispatch(state, mutation);
    case "record-child-session":
      return withTimestamp(state, { childSessions: [...state.childSessions, mutation.session] });
    case "update-child-session":
      return reduceUpdateChildSession(state, mutation);
    case "record-prompt":
      return withTimestamp(state, { prompts: [...state.prompts, mutation.prompt] });
    case "record-approval":
      return withTimestamp(state, { approvals: [...state.approvals, mutation.approval] });
  }
}

/**
 * Reduces gate, evidence, review-loop, phase-completion, and retry mutations.
 *
 * @param state - Current pipeline state.
 * @param mutation - An audit-category mutation.
 *
 * @returns New pipeline state with audit records updated.
 *
 * @example
 * ```typescript
 * reduceAuditMutation(state, { kind: "record-gate", gateResult });
 * ```
 */
function reduceAuditMutation(
  state: PipelineRunState,
  mutation: Extract<
    StateMutation,
    {
      kind:
        | "record-gate"
        | "record-artifact-evidence"
        | "update-review-loop"
        | "record-completed-phase"
        | "increment-retry";
    }
  >,
): PipelineRunState {
  switch (mutation.kind) {
    case "record-gate":
      return withTimestamp(state, { gateResults: [...state.gateResults, mutation.gateResult] });
    case "record-artifact-evidence":
      return withTimestamp(state, {
        artifactEvidence: [...state.artifactEvidence, mutation.evidence],
      });
    case "update-review-loop":
      return reduceReviewLoop(state, mutation);
    case "record-completed-phase":
      return withTimestamp(state, { completedPhases: [...state.completedPhases, mutation.record] });
    case "increment-retry":
      return reduceIncrementRetry(state, mutation.category);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Specialized Reducers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Reduces a set-status mutation, setting finishedAt for terminal statuses.
 *
 * @param state - Current state.
 * @param status - New pipeline status.
 *
 * @returns New state with updated status and optional finishedAt.
 *
 * @example
 * ```typescript
 * const newState = reduceSetStatus(state, "done");
 * ```
 */
function reduceSetStatus(state: PipelineRunState, status: PipelineStatus): PipelineRunState {
  const now = new Date().toISOString();
  return {
    ...state,
    status,
    updatedAt: now,
    finishedAt: TERMINAL_STATUSES.has(status) ? now : state.finishedAt,
  };
}

/**
 * Reduces an update-dispatch mutation by mapping over the dispatches array.
 *
 * @param state - Current state.
 * @param mutation - The update-dispatch mutation with dispatchId, status, and optional evidence.
 *
 * @returns New state with the matched dispatch record updated.
 *
 * @example
 * ```typescript
 * const newState = reduceUpdateDispatch(state, { kind: "update-dispatch", dispatchId: "d-1", status: "completed" });
 * ```
 */
function reduceUpdateDispatch(
  state: PipelineRunState,
  mutation: Extract<StateMutation, { kind: "update-dispatch" }>,
): PipelineRunState {
  return withTimestamp(state, {
    dispatches: state.dispatches.map((dispatch) =>
      dispatch.dispatchId === mutation.dispatchId
        ? {
            ...dispatch,
            status: mutation.status,
            completionEvidence: mutation.evidence ?? dispatch.completionEvidence,
            resolvedAt: TERMINAL_DISPATCH_STATUSES.has(mutation.status)
              ? new Date().toISOString()
              : dispatch.resolvedAt,
          }
        : dispatch,
    ),
  });
}

/**
 * Reduces an update-child-session mutation by mapping over the sessions array.
 *
 * @param state - Current state.
 * @param mutation - The update-child-session mutation with sessionId and status.
 *
 * @returns New state with the matched session record updated.
 *
 * @example
 * ```typescript
 * const newState = reduceUpdateChildSession(state, { kind: "update-child-session", sessionId: "s-1", status: "active" });
 * ```
 */
function reduceUpdateChildSession(
  state: PipelineRunState,
  mutation: Extract<StateMutation, { kind: "update-child-session" }>,
): PipelineRunState {
  return withTimestamp(state, {
    childSessions: state.childSessions.map((session) =>
      session.sessionId === mutation.sessionId
        ? {
            ...session,
            status: mutation.status,
            terminatedAt: TERMINAL_SESSION_STATUSES.has(mutation.status)
              ? new Date().toISOString()
              : session.terminatedAt,
          }
        : session,
    ),
  });
}

/**
 * Reduces an update-echo-fields mutation to set active workflow, step, and story.
 *
 * @param state - Current state.
 * @param mutation - The update-echo-fields mutation with workflowId, stepId, storyId.
 *
 * @returns New state with echo fields reflecting the active dispatch.
 *
 * @example
 * ```typescript
 * const newState = reduceEchoFields(state, { kind: "update-echo-fields", workflowId: "dev-story", stepId: "s1", storyId: "story-1" });
 * ```
 */
function reduceEchoFields(
  state: PipelineRunState,
  mutation: Extract<StateMutation, { kind: "update-echo-fields" }>,
): PipelineRunState {
  return withTimestamp(state, {
    activeWorkflowId: mutation.workflowId,
    activeStepId: mutation.stepId,
    activeStoryId: mutation.storyId,
  });
}

/**
 * Reduces an increment-retry mutation by adding 1 to the counter for the category.
 *
 * @param state - Current state.
 * @param category - Retry counter category to increment.
 *
 * @returns New state with the named counter incremented by one.
 *
 * @example
 * ```typescript
 * const newState = reduceIncrementRetry(state, "checkpoint-fail");
 * ```
 */
function reduceIncrementRetry(state: PipelineRunState, category: string): PipelineRunState {
  const currentCount = state.retryCounts[category] ?? 0;
  return withTimestamp(state, {
    retryCounts: { ...state.retryCounts, [category]: currentCount + 1 },
  });
}

/**
 * Reduces an update-review-loop mutation into the storyLifecycles map.
 *
 * @param state - Current state.
 * @param mutation - The update-review-loop mutation with storyId and loopState.
 *
 * @returns New state with the story lifecycle record created or updated.
 *
 * @example
 * ```typescript
 * const newState = reduceReviewLoop(state, { kind: "update-review-loop", storyId: "s1", loopState });
 * ```
 */
function reduceReviewLoop(
  state: PipelineRunState,
  mutation: Extract<StateMutation, { kind: "update-review-loop" }>,
): PipelineRunState {
  const existingLifecycle = state.storyLifecycles[mutation.storyId];
  const updatedLifecycle: StoryLifecycleState =
    existingLifecycle !== undefined
      ? {
          ...existingLifecycle,
          reviewLoopbacks: mutation.loopState.loopCount,
          reviewFindings: mutation.loopState.lastReviewFindings,
        }
      : buildDefaultLifecycle(mutation.storyId, mutation.loopState);

  return withTimestamp(state, {
    storyLifecycles: { ...state.storyLifecycles, [mutation.storyId]: updatedLifecycle },
  });
}

/**
 * Builds a default story lifecycle for a review loop entry that has no existing lifecycle.
 *
 * @param storyId - Story identifier for the new lifecycle record.
 * @param loopState - Review loop state providing initial counter values.
 *
 * @returns A default StoryLifecycleState seeded from the loop state.
 *
 * @example
 * ```typescript
 * const lifecycle = buildDefaultLifecycle("story-1", loopState);
 * ```
 */
function buildDefaultLifecycle(
  storyId: string,
  loopState: StoryReviewLoopState,
): StoryLifecycleState {
  return {
    storyId,
    next: "create-story",
    e2eAttemptsInCycle: 0,
    maxE2eAttempts: DEFAULT_MAX_E2E_ATTEMPTS,
    reviewLoopbacks: loopState.loopCount,
    maxReviewLoopbacks: DEFAULT_MAX_REVIEW_LOOPBACKS,
    lastProcessedDispatchId: null,
    lastProcessedWorkflowRunId: null,
    lastSemanticOutcome: null,
    reviewFindings: loopState.lastReviewFindings,
    blockerReason: null,
  };
}
