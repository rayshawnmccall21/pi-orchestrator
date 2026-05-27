/**
 * Private pure reducer for story lifecycle phase transitions and retry counters.
 *
 * This module is imported ONLY by `state/pipeline.ts`. It implements the
 * deterministic FSM defined in story-fsm-addendum.md — routing decisions
 * never depend on tmux pane prose, LLM interpretation, or ad-hoc branches.
 *
 * All functions are pure: no I/O, no side effects, no thrown errors for
 * expected business logic (throws OrchestratorError only for programming
 * errors like invalid transitions).
 *
 * @see story-fsm-addendum.md Section 3 for the FSM state diagram.
 * @see story-fsm-addendum.md Section 4 for counter semantics.
 */

import type { StoryLifecycleState } from "../shared/types.js";
import { OrchestratorError } from "../shared/errors.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Interface
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for initial story lifecycle creation. */
export interface StoryLifecycleConfig {
  /** Maximum total e2e verification attempts per cycle. */
  maxE2eAttempts: number;
  /** Maximum allowed loopback transitions. */
  maxReviewLoopbacks: number;
}

/** Input for applying a workflow outcome to a story lifecycle. */
export interface StoryOutcomeInput {
  /** The BMAD workflow ID that completed. */
  workflowId: string;
  /** The semantic outcome string from the workflow result. */
  semanticOutcome: string;
  /** Dispatch ID for idempotency tracking. */
  dispatchId: string;
  /** Workflow run ID for idempotency tracking. */
  workflowRunId: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Terminal / non-dispatchable lifecycle states. */
const TERMINAL_STATES: ReadonlySet<StoryLifecycleState["next"]> = new Set([
  "done",
  "escalated",
  "blocked",
]);

/**
 * Maps each workflow ID to the lifecycle `next` value that must be current
 * for the workflow result to be valid.
 */
const WORKFLOW_TO_EXPECTED_NEXT: Readonly<Record<string, StoryLifecycleState["next"]>> = {
  "create-story": "create-story",
  "e2e-plan": "e2e-plan",
  "dev-story": "dev-story",
  "e2e-verify": "e2e-verify",
  "code-review": "code-review",
};

/** Valid semantic outcomes per workflow ID. */
const VALID_OUTCOMES: Readonly<Record<string, ReadonlySet<string>>> = {
  "create-story": new Set(["STORY_READY", "ERROR"]),
  "e2e-plan": new Set(["PLAN_READY", "ERROR"]),
  "dev-story": new Set(["IMPLEMENTED", "ERROR"]),
  "e2e-verify": new Set(["PASS", "FAIL", "ERROR"]),
  "code-review": new Set(["APPROVED", "NEEDS_DEV", "FIXED_REQUIRES_VERIFY", "ERROR"]),
};

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates an initial story lifecycle state at `create-story` with zero counters.
 *
 * @param storyId - The story identifier.
 * @param config - Configuration for retry budgets.
 *
 * @returns A fresh StoryLifecycleState.
 *
 * @example
 * ```typescript
 * const lifecycle = createInitialStoryLifecycle("story-42", { maxE2eAttempts: 3, maxReviewLoopbacks: 3 });
 * ```
 */
export function createInitialStoryLifecycle(
  storyId: string,
  config: StoryLifecycleConfig,
): StoryLifecycleState {
  return {
    storyId,
    next: "create-story",
    e2eAttemptsInCycle: 0,
    maxE2eAttempts: config.maxE2eAttempts,
    reviewLoopbacks: 0,
    maxReviewLoopbacks: config.maxReviewLoopbacks,
    lastProcessedDispatchId: null,
    lastProcessedWorkflowRunId: null,
    lastSemanticOutcome: null,
    reviewFindings: null,
    blockerReason: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Pure Reducer
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Applies a workflow outcome to a story lifecycle state, producing a new state.
 *
 * This is a pure function: it never mutates the input, never performs I/O,
 * and throws only for programming errors (invalid transitions, unknown outcomes).
 *
 * @param currentLifecycle - The current story lifecycle state (not mutated).
 * @param outcome - The workflow outcome to apply.
 *
 * @returns A new StoryLifecycleState reflecting the transition.
 *
 * @throws OrchestratorError when the transition is invalid (wrong workflow,
 *   unknown outcome, terminal state, or blocked state).
 *
 * @example
 * ```typescript
 * const newLifecycle = applyStoryOutcome(currentLifecycle, {
 *   workflowId: "create-story",
 *   semanticOutcome: "STORY_READY",
 *   dispatchId: "d1",
 *   workflowRunId: "wr1",
 * });
 * ```
 */
export function applyStoryOutcome(
  currentLifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
): StoryLifecycleState {
  if (isIdempotentDuplicate(currentLifecycle, outcome)) {
    return currentLifecycle;
  }

  assertNotTerminal(currentLifecycle);
  assertWorkflowMatchesExpectedState(currentLifecycle, outcome);
  assertValidOutcome(currentLifecycle, outcome);

  const baseUpdate = {
    lastProcessedDispatchId: outcome.dispatchId,
    lastProcessedWorkflowRunId: outcome.workflowRunId,
    lastSemanticOutcome: outcome.semanticOutcome,
  };

  if (outcome.semanticOutcome === "ERROR") {
    return {
      ...currentLifecycle,
      ...baseUpdate,
      next: "blocked",
      blockerReason: `Workflow "${outcome.workflowId}" returned ERROR`,
    };
  }

  return routeOutcome(currentLifecycle, outcome, baseUpdate);
}

// ═══════════════════════════════════════════════════════════════════════════
// Guard Checks
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checks if this outcome was already processed (idempotency).
 *
 * @param lifecycle - Current lifecycle state.
 * @param outcome - Outcome to check.
 *
 * @returns True if this dispatch+run pair was already processed.
 *
 * @example
 * ```typescript
 * if (isIdempotentDuplicate(lifecycle, outcome)) return lifecycle;
 * ```
 */
function isIdempotentDuplicate(
  lifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
): boolean {
  return (
    lifecycle.lastProcessedDispatchId === outcome.dispatchId &&
    lifecycle.lastProcessedWorkflowRunId === outcome.workflowRunId
  );
}

/**
 * Asserts that the lifecycle is not in a terminal state.
 *
 * @param lifecycle - Current lifecycle state to check.
 *
 * @throws OrchestratorError if the lifecycle is in a terminal state.
 *
 * @example
 * ```typescript
 * assertNotTerminal(lifecycle);
 * ```
 */
function assertNotTerminal(lifecycle: StoryLifecycleState): void {
  if (TERMINAL_STATES.has(lifecycle.next)) {
    throw new OrchestratorError(
      `Cannot apply outcome to story "${lifecycle.storyId}" in terminal state "${lifecycle.next}"`,
      "STORY_LIFECYCLE_TERMINAL",
      { storyId: lifecycle.storyId, currentNext: lifecycle.next },
    );
  }
}

/**
 * Asserts that the workflow matches the expected lifecycle state.
 *
 * @param lifecycle - Current lifecycle state.
 * @param outcome - Outcome with the workflow to validate.
 *
 * @throws OrchestratorError if the workflow does not match.
 *
 * @example
 * ```typescript
 * assertWorkflowMatchesExpectedState(lifecycle, outcome);
 * ```
 */
function assertWorkflowMatchesExpectedState(
  lifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
): void {
  const expectedNext = WORKFLOW_TO_EXPECTED_NEXT[outcome.workflowId];
  if (expectedNext === undefined) {
    throw new OrchestratorError(
      `Unknown workflow ID "${outcome.workflowId}" for story "${lifecycle.storyId}"`,
      "STORY_LIFECYCLE_UNKNOWN_WORKFLOW",
      { storyId: lifecycle.storyId, workflowId: outcome.workflowId },
    );
  }

  if (lifecycle.next !== expectedNext) {
    throw new OrchestratorError(
      `Workflow "${outcome.workflowId}" does not match expected state "${lifecycle.next}" for story "${lifecycle.storyId}"`,
      "STORY_LIFECYCLE_WORKFLOW_MISMATCH",
      {
        storyId: lifecycle.storyId,
        currentNext: lifecycle.next,
        workflowId: outcome.workflowId,
        expectedNext,
      },
    );
  }
}

/**
 * Asserts that the semantic outcome is valid for the workflow.
 *
 * @param lifecycle - Current lifecycle state for error context.
 * @param outcome - Outcome with the semantic value to validate.
 *
 * @throws OrchestratorError if the outcome is unknown.
 *
 * @example
 * ```typescript
 * assertValidOutcome(lifecycle, outcome);
 * ```
 */
function assertValidOutcome(lifecycle: StoryLifecycleState, outcome: StoryOutcomeInput): void {
  const validOutcomes = VALID_OUTCOMES[outcome.workflowId];
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- explicit undefined check required by strict-boolean-expressions
  if (validOutcomes === undefined || !validOutcomes.has(outcome.semanticOutcome)) {
    throw new OrchestratorError(
      `Unknown semantic outcome "${outcome.semanticOutcome}" for workflow "${outcome.workflowId}"`,
      "STORY_LIFECYCLE_UNKNOWN_OUTCOME",
      {
        storyId: lifecycle.storyId,
        workflowId: outcome.workflowId,
        semanticOutcome: outcome.semanticOutcome,
      },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Private Routing
// ═══════════════════════════════════════════════════════════════════════════

/** Common fields produced by every transition. */
interface BaseUpdateFields {
  /** Last processed dispatch ID. */
  lastProcessedDispatchId: string;
  /** Last processed workflow run ID. */
  lastProcessedWorkflowRunId: string;
  /** Last semantic outcome. */
  lastSemanticOutcome: string;
}

/**
 * Route a non-ERROR outcome to the correct next state.
 *
 * @param currentLifecycle - Current lifecycle state.
 * @param outcome - The workflow outcome being applied.
 * @param baseUpdate - Common fields to merge into the result.
 *
 * @returns New lifecycle state after transition.
 *
 * @throws OrchestratorError for unhandled workflow IDs (unreachable in practice).
 *
 * @example
 * ```typescript
 * const newLifecycle = routeOutcome(lifecycle, outcome, baseUpdate);
 * ```
 */
function routeOutcome(
  currentLifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
  baseUpdate: BaseUpdateFields,
): StoryLifecycleState {
  switch (outcome.workflowId) {
    case "create-story":
      return { ...currentLifecycle, ...baseUpdate, next: "e2e-plan" };
    case "e2e-plan":
      return { ...currentLifecycle, ...baseUpdate, next: "dev-story" };
    case "dev-story":
      return { ...currentLifecycle, ...baseUpdate, next: "e2e-verify" };
    case "e2e-verify":
      return routeE2eVerifyOutcome(currentLifecycle, outcome, baseUpdate);
    case "code-review":
      return routeCodeReviewOutcome(currentLifecycle, outcome, baseUpdate);
    default:
      throw new OrchestratorError(
        `Unhandled workflow "${outcome.workflowId}"`,
        "STORY_LIFECYCLE_INTERNAL_ERROR",
        { workflowId: outcome.workflowId },
      );
  }
}

/**
 * Route e2e-verify outcomes: PASS resets and advances, FAIL increments or escalates.
 *
 * @param currentLifecycle - Story lifecycle state before this transition.
 * @param outcome - Workflow result containing semanticOutcome (PASS or FAIL).
 * @param baseUpdate - Tracking fields (dispatchId, workflowRunId, semanticOutcome) to merge.
 *
 * @returns Transitioned lifecycle with updated e2e counters or escalation.
 *
 * @example
 * ```typescript
 * const newLifecycle = routeE2eVerifyOutcome(lifecycle, outcome, baseUpdate);
 * ```
 */
function routeE2eVerifyOutcome(
  currentLifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
  baseUpdate: BaseUpdateFields,
): StoryLifecycleState {
  if (outcome.semanticOutcome === "PASS") {
    return { ...currentLifecycle, ...baseUpdate, next: "code-review", e2eAttemptsInCycle: 0 };
  }

  const nextAttempts = currentLifecycle.e2eAttemptsInCycle + 1;
  if (nextAttempts >= currentLifecycle.maxE2eAttempts) {
    return {
      ...currentLifecycle,
      ...baseUpdate,
      next: "escalated",
      e2eAttemptsInCycle: nextAttempts,
    };
  }

  return {
    ...currentLifecycle,
    ...baseUpdate,
    next: "dev-story",
    e2eAttemptsInCycle: nextAttempts,
  };
}

/**
 * Route code-review outcomes: APPROVED → done, NEEDS_DEV/FIXED_REQUIRES_VERIFY
 * increment loopback or escalate.
 *
 * @param currentLifecycle - Story lifecycle state before this transition.
 * @param outcome - Workflow result containing semanticOutcome (APPROVED, NEEDS_DEV, or FIXED_REQUIRES_VERIFY).
 * @param baseUpdate - Tracking fields (dispatchId, workflowRunId, semanticOutcome) to merge.
 *
 * @returns Transitioned lifecycle with loopback counter updates or escalation.
 *
 * @example
 * ```typescript
 * const newLifecycle = routeCodeReviewOutcome(lifecycle, outcome, baseUpdate);
 * ```
 */
function routeCodeReviewOutcome(
  currentLifecycle: StoryLifecycleState,
  outcome: StoryOutcomeInput,
  baseUpdate: BaseUpdateFields,
): StoryLifecycleState {
  if (outcome.semanticOutcome === "APPROVED") {
    return { ...currentLifecycle, ...baseUpdate, next: "done" };
  }

  if (currentLifecycle.reviewLoopbacks >= currentLifecycle.maxReviewLoopbacks) {
    return { ...currentLifecycle, ...baseUpdate, next: "escalated" };
  }

  const nextLoopbacks = currentLifecycle.reviewLoopbacks + 1;
  const targetNext = outcome.semanticOutcome === "NEEDS_DEV" ? "dev-story" : "e2e-verify";

  return {
    ...currentLifecycle,
    ...baseUpdate,
    next: targetNext,
    reviewLoopbacks: nextLoopbacks,
    e2eAttemptsInCycle: 0,
  };
}
