/**
 * Maps HeadlessWorkflowOutput from pi-bmad child workers to StoryOutcomeInput
 * for the deterministic story lifecycle FSM.
 *
 * This is the bridge between what pi-bmad produces and what pi-orchestrator's
 * story FSM consumes. The typed payload drives routing — not generic status alone.
 *
 * @see story-lifecycle.ts for the FSM that consumes these outcomes.
 */

import { OrchestratorError } from "../shared/errors.js";
import type { HeadlessWorkflowOutput } from "../shared/types.js";
import type { StoryOutcomeInput } from "./story-lifecycle.js";

/** Payload shape for e2e-verify results. */
interface E2eVerifyPayload {
  verdict: "pass" | "fail";
}

/** Payload shape for code-review results. */
interface CodeReviewPayload {
  verdict: "approved" | "needs-dev" | "needs-verify";
  findingsBySeverity?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

/**
 * Map a HeadlessWorkflowOutput to a StoryOutcomeInput for FSM consumption.
 *
 * The mapping is deterministic — given the same output, the same outcome is
 * produced every time. Payload fields drive branching for e2e-verify and
 * code-review workflows.
 *
 * @param output - The parsed HeadlessWorkflowOutput from a child worker.
 * @param dispatchId - The dispatch ID for idempotency tracking.
 * @param workflowRunId - The workflow run ID for idempotency tracking.
 *
 * @returns A StoryOutcomeInput ready for applyStoryOutcome().
 *
 * @throws OrchestratorError for unknown workflow IDs or invalid payload states.
 *
 * @example
 * ```typescript
 * const outcome = mapResultToOutcome(output, "d-1", "wr-1");
 * const newState = applyStoryOutcome(currentState, outcome);
 * ```
 */
export function mapResultToOutcome(
  output: HeadlessWorkflowOutput,
  dispatchId: string,
  workflowRunId: string,
): StoryOutcomeInput {
  const baseInput = {
    workflowId: output.workflow,
    dispatchId,
    workflowRunId,
  };

  // Failed workflows always map to ERROR regardless of payload
  if (output.status === "failed") {
    return { ...baseInput, semanticOutcome: "ERROR" };
  }

  switch (output.workflow) {
    case "create-story":
      return { ...baseInput, semanticOutcome: "STORY_READY" };

    case "e2e-plan":
      return { ...baseInput, semanticOutcome: "PLAN_READY" };

    case "dev-story":
      return { ...baseInput, semanticOutcome: "IMPLEMENTED" };

    case "e2e-verify":
      return mapE2eVerifyOutcome(output, baseInput);

    case "code-review":
      return mapCodeReviewOutcome(output, baseInput);

    default:
      throw new OrchestratorError(
        `Unknown workflow "${output.workflow}" in result mapper`,
        "RESULT_MAPPER_UNKNOWN_WORKFLOW",
        { workflow: output.workflow },
      );
  }
}

/**
 * Map e2e-verify output using payload.verdict for branching.
 * Payload wins over generic status: success + verdict=fail → FAIL.
 */
function mapE2eVerifyOutcome(
  output: HeadlessWorkflowOutput,
  baseInput: { workflowId: string; dispatchId: string; workflowRunId: string },
): StoryOutcomeInput {
  const payload = output.payload as E2eVerifyPayload | null;
  if (payload === null || payload === undefined) {
    return { ...baseInput, semanticOutcome: "ERROR" };
  }
  if (payload.verdict === "pass") {
    return { ...baseInput, semanticOutcome: "PASS" };
  }
  return { ...baseInput, semanticOutcome: "FAIL" };
}

/**
 * Map code-review output using payload.verdict and findings severity.
 * Payload wins: success + critical findings → NEEDS_DEV.
 */
function mapCodeReviewOutcome(
  output: HeadlessWorkflowOutput,
  baseInput: { workflowId: string; dispatchId: string; workflowRunId: string },
): StoryOutcomeInput {
  const payload = output.payload as CodeReviewPayload | null;
  if (payload === null || payload === undefined) {
    return { ...baseInput, semanticOutcome: "ERROR" };
  }
  if (payload.verdict === "approved") {
    return { ...baseInput, semanticOutcome: "APPROVED" };
  }
  if (payload.verdict === "needs-verify") {
    return { ...baseInput, semanticOutcome: "FIXED_REQUIRES_VERIFY" };
  }
  // needs-dev or critical findings
  if (payload.findingsBySeverity !== undefined && payload.findingsBySeverity.critical > 0) {
    return { ...baseInput, semanticOutcome: "NEEDS_DEV" };
  }
  return { ...baseInput, semanticOutcome: "NEEDS_DEV" };
}
