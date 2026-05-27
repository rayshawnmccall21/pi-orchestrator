/**
 * Authorization policy for unsafe orchestrator actions.
 *
 * Evaluates whether an unsafe action may proceed based on explicit human
 * approval records. Used by 3+ callers: run controller, merge path, and
 * action/surface boundary.
 *
 * Design invariants:
 * - Fail-closed: no approval record means denied.
 * - Pure: no I/O, no side effects, no async.
 * - Staleness window: approvals older than 24 hours are rejected.
 * - Exact match: subject === action (no fuzzy/substring matching).
 * - Temporal: when multiple records match, the most recent valid one wins.
 * - requiresUI: true for any unapproved/stale/malformed action (human must
 *   interact via UI to resolve), false only for explicit denial or authorization.
 *
 * @see Section 5.12 of pi-package-refactor-plan.md
 */

import type { ApprovalRecord, UnsafeAction } from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Result of evaluating an unsafe action against approval records. */
export interface AuthorizationDecision {
  /** Whether the action is authorized to proceed. */
  authorized: boolean;
  /** Human-readable reason for the decision. */
  reason: string;
  /** Whether a UI is required to collect approval for this action. */
  requiresUI: boolean;
}

/** Policy that evaluates unsafe actions against approval records. */
export interface AuthorizationPolicy {
  /**
   * Can this unsafe action proceed? Called by run controller, merge, surfaces.
   *
   * @param action - The unsafe action being evaluated.
   * @param approvals - Available approval records to check against.
   * @param mode - Runtime mode; hasUI indicates whether a TUI is available.
   *
   * @returns Authorization decision with reason and requiresUI flag.
   */
  evaluate(
    action: UnsafeAction,
    approvals: ApprovalRecord[],
    mode: { hasUI: boolean },
  ): AuthorizationDecision;
}

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

/** Hours before an approval record becomes stale. */
const APPROVAL_TTL_HOURS = 24;

/** Milliseconds per hour. */
const MS_PER_HOUR = 3_600_000;

/** Approval staleness window in milliseconds. */
const APPROVAL_TTL_MS = APPROVAL_TTL_HOURS * MS_PER_HOUR;

// ═══════════════════════════════════════════════════════════════════════════
// Validation Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check whether an approval record has all required fields populated
 * and its timestamp is parseable.
 *
 * @param record - The approval record to validate.
 *
 * @returns True if all required fields are present and valid.
 *
 * @example
 * ```ts
 * isWellFormedApproval(record); // true when all fields present and valid
 * ```
 *
 */
function isWellFormedApproval(record: ApprovalRecord): boolean {
  if (record.approvalId.length === 0) {
    return false;
  }
  if (record.subject.length === 0) {
    return false;
  }
  if (record.actor.length === 0) {
    return false;
  }
  if (record.timestamp.length === 0) {
    return false;
  }
  return !Number.isNaN(Date.parse(record.timestamp));
}

/**
 * Check whether an approval record's timestamp is within the staleness window.
 * Returns false if the timestamp is in the future or older than the TTL.
 *
 * @param record - The approval record to check freshness for.
 * @param now - Current time in milliseconds since epoch.
 *
 * @returns True if the approval is fresh (not stale, not future).
 *
 * @example
 * ```ts
 * isFreshApproval(record, Date.now()); // true when fresh, false when stale
 * ```
 *
 */
function isFreshApproval(record: ApprovalRecord, now: number): boolean {
  const parsedTime = Date.parse(record.timestamp);
  if (Number.isNaN(parsedTime)) {
    return false;
  }

  // Reject future timestamps.
  if (parsedTime > now) {
    return false;
  }

  // Reject stale timestamps (strictly greater than TTL).
  const ageMs = now - parsedTime;
  return ageMs <= APPROVAL_TTL_MS;
}

/**
 * Sort matching records by timestamp descending (most recent first).
 * Invalid timestamps sort to the end.
 *
 * @param records - Approval records to sort.
 *
 * @returns A new sorted array (does not mutate input).
 *
 * @example
 * ```ts
 * const sorted = sortByTimestampDescending(records);
 * ```
 *
 */
function sortByTimestampDescending(records: ApprovalRecord[]): ApprovalRecord[] {
  return [...records].sort((recordA, recordB) => {
    const timeA = Date.parse(recordA.timestamp);
    const timeB = Date.parse(recordB.timestamp);
    if (Number.isNaN(timeA) && Number.isNaN(timeB)) {
      return 0;
    }
    if (Number.isNaN(timeA)) {
      return 1;
    }
    if (Number.isNaN(timeB)) {
      return -1;
    }
    return timeB - timeA;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Decision builders
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build an authorized decision.
 *
 * @param action - The unsafe action that was authorized.
 * @param approvalId - The ID of the approval record that authorized it.
 *
 * @returns An authorized decision.
 *
 * @example
 * ```ts
 * buildAuthorized("destructive-cleanup", "approval-001");
 * ```
 *
 */
function buildAuthorized(action: UnsafeAction, approvalId: string): AuthorizationDecision {
  return {
    authorized: true,
    reason: `Action "${action}" authorized by approval ${approvalId}`,
    requiresUI: false,
  };
}

/**
 * Build a denied decision that requires UI to resolve.
 *
 * @param reason - Human-readable denial reason.
 *
 * @returns A denied decision with requiresUI: true.
 *
 * @example
 * ```ts
 * deniedRequiresUI("No approval found");
 * ```
 *
 */
function deniedRequiresUI(reason: string): AuthorizationDecision {
  return { authorized: false, reason, requiresUI: true };
}

/**
 * Build a denied decision that does NOT require UI (human already decided).
 *
 * @param reason - Human-readable denial reason.
 *
 * @returns A denied decision with requiresUI: false.
 *
 * @example
 * ```ts
 * deniedNoUI("Action was explicitly denied");
 * ```
 *
 */
function deniedNoUI(reason: string): AuthorizationDecision {
  return { authorized: false, reason, requiresUI: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// Core evaluation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate matching approval records using temporal ordering.
 * The most recent well-formed, fresh record wins.
 *
 * @param action - The unsafe action being evaluated.
 * @param matchingRecords - Records whose subject matches the action.
 *
 * @returns Authorization decision based on the best matching record.
 *
 * @example
 * ```ts
 * evaluateMatchingRecords("destructive-cleanup", matchingRecords);
 * ```
 *
 */
function evaluateMatchingRecords(
  action: UnsafeAction,
  matchingRecords: ApprovalRecord[],
): AuthorizationDecision {
  const now = Date.now();
  const sorted = sortByTimestampDescending(matchingRecords);

  // Find the most recent well-formed, fresh record — its decision wins.
  for (const record of sorted) {
    if (!isWellFormedApproval(record)) {
      continue;
    }
    if (!isFreshApproval(record, now)) {
      continue;
    }
    if (record.decision === "approved") {
      return buildAuthorized(action, record.approvalId);
    }
    return deniedNoUI(`Action "${action}" was explicitly denied`);
  }

  // No valid record found — classify the failure reason.
  return classifyFailureReason(action, sorted, now);
}

/**
 * Classify why all matching records failed validation.
 *
 * @param action - The unsafe action being evaluated.
 * @param sorted - Sorted matching records (all invalid).
 * @param now - Current timestamp in ms.
 *
 * @returns A denial decision with the most specific reason.
 *
 * @example
 * ```ts
 * classifyFailureReason("destructive-cleanup", sorted, Date.now());
 * ```
 *
 */
function classifyFailureReason(
  action: UnsafeAction,
  sorted: ApprovalRecord[],
  now: number,
): AuthorizationDecision {
  let hasStale = false;

  for (const record of sorted) {
    if (!isWellFormedApproval(record)) {
      return deniedRequiresUI(`Approval record for action "${action}" is malformed`);
    }
    if (!isFreshApproval(record, now)) {
      hasStale = true;
    }
  }

  if (hasStale) {
    return deniedRequiresUI(
      `Approval record for action "${action}" is stale (older than 24 hours)`,
    );
  }

  return deniedRequiresUI(`No valid approval found for action "${action}"`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create an authorization policy instance.
 *
 * Intended callers:
 * - Run controller: checks before dispatching destructive actions.
 * - Merge path: checks for merge-conflict-resolution and checkpoint-override.
 * - Action/surface boundary: checks for review-waiver and state-force-reset.
 *
 * @returns An AuthorizationPolicy instance with an evaluate method.
 *
 * @example
 * ```ts
 * const policy = createAuthorizationPolicy();
 * const decision = policy.evaluate("destructive-cleanup", approvals, { hasUI: true });
 * ```
 *
 */
export function createAuthorizationPolicy(): AuthorizationPolicy {
  return {
    evaluate(
      action: UnsafeAction,
      approvals: ApprovalRecord[],
      mode: { hasUI: boolean },
    ): AuthorizationDecision {
      // Mode is part of the interface contract for future headless-specific
      // policy branches. Currently all denials use action-level semantics.
      void mode;

      const matchingRecords = approvals.filter((record) => record.subject === action);

      if (matchingRecords.length === 0) {
        return deniedRequiresUI(`No approval record found for action "${action}"`);
      }

      return evaluateMatchingRecords(action, matchingRecords);
    },
  };
}
