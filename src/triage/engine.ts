/**
 * Triage engine — one `decideFailureResponse()` classifying failures.
 *
 * @see Section 5.11 of pi-package-refactor-plan.md for the interface contract.
 * Stub factory — real implementation in R-S10.
 */

import type { FailureCategory, FailureEvidence, PipelineRunState } from "../shared/types.js";
import type { TriagePolicyConfig } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Observation context for the triage engine. */
export interface TriageObservation {
  /** Structured failure evidence. */
  evidence: FailureEvidence;
  /** Current pipeline state at time of observation. */
  state: PipelineRunState;
  /** Step ID where the failure occurred, if applicable. */
  stepId?: string;
}

/** Decision produced by the triage engine. */
export interface TriageDecision {
  /** Action to take. */
  action: "steer" | "retry" | "block" | "escalate";
  /** Failure category classification. */
  category: FailureCategory;
  /** Human-readable reason for the decision. */
  reason: string;
  /** Steer message for steer actions. */
  message?: string;
  /** Evidence paths for escalate actions. */
  evidenceRefs?: string[];
}

/** Triage engine that classifies failures and decides responses. */
export interface TriageEngine {
  /** Given this failure, what should we do? */
  decideFailureResponse(observation: TriageObservation): TriageDecision;
}

/**
 * Creates a TriageEngine instance.
 * Stub — always blocks. Real implementation in R-S10.
 *
 * @param _config - Triage policy configuration (unused in stub).
 *
 * @returns TriageEngine instance.
 *
 * @example
 * ```typescript
 * const engine = createTriageEngine(config.triage);
 * const decision = engine.decideFailureResponse(observation);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function createTriageEngine(_config: TriagePolicyConfig): TriageEngine {
  return {
    decideFailureResponse: () => ({
      action: "block" as const,
      category: "checkpoint-fail",
      reason: "Triage engine not yet implemented",
    }),
  };
}
