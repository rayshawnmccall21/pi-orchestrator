/**
 * Private validation helpers for PipelineStateManager mutations.
 *
 * Validates that a mutation can be applied to the current state before
 * the pure reducer runs. Throws OrchestratorError on invalid mutations.
 *
 * This module is imported only by `state/pipeline.ts`.
 */

import type { PipelineRunState, StateMutation } from "../shared/types.js";
import { OrchestratorError } from "../shared/errors.js";

/**
 * Validates that a mutation can be applied to the current state.
 * Throws OrchestratorError on mutations that reference missing entities.
 *
 * @param state - Current pipeline state.
 * @param mutation - The mutation to validate.
 *
 * @throws OrchestratorError if the mutation references entities not in state.
 *
 * @example
 * ```typescript
 * validateMutation(currentState, { kind: "update-dispatch", dispatchId: "d1", status: "completed" });
 * ```
 */
export function validateMutation(state: PipelineRunState, mutation: StateMutation): void {
  if (mutation.kind === "update-dispatch") {
    assertDispatchExists(state, mutation.dispatchId);
  }
  if (mutation.kind === "update-child-session") {
    assertSessionExists(state, mutation.sessionId);
  }
}

/**
 * Asserts that a dispatch with the given ID exists in state.
 *
 * @param state - Current pipeline state.
 * @param dispatchId - Dispatch ID to find.
 *
 * @throws OrchestratorError if dispatch not found.
 *
 * @example
 * ```typescript
 * assertDispatchExists(state, "dispatch-1");
 * ```
 */
function assertDispatchExists(state: PipelineRunState, dispatchId: string): void {
  const dispatchExists = state.dispatches.some((dispatch) => dispatch.dispatchId === dispatchId);
  if (!dispatchExists) {
    throw new OrchestratorError(
      `Cannot update dispatch "${dispatchId}": not found in state`,
      "STATE_DISPATCH_NOT_FOUND",
      { dispatchId },
    );
  }
}

/**
 * Asserts that a child session with the given ID exists in state.
 *
 * @param state - Current pipeline state.
 * @param sessionId - Session ID to find.
 *
 * @throws OrchestratorError if session not found.
 *
 * @example
 * ```typescript
 * assertSessionExists(state, "session-1");
 * ```
 */
function assertSessionExists(state: PipelineRunState, sessionId: string): void {
  const sessionExists = state.childSessions.some((session) => session.sessionId === sessionId);
  if (!sessionExists) {
    throw new OrchestratorError(
      `Cannot update child session "${sessionId}": not found in state`,
      "STATE_SESSION_NOT_FOUND",
      { sessionId },
    );
  }
}
