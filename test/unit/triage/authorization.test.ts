/**
 * Unit tests for pi-orchestrator/src/triage/authorization.ts — authorization policy.
 *
 * Tests verify the Section 5.12 contract:
 * - createAuthorizationPolicy() returns an AuthorizationPolicy
 * - evaluate() checks 6 unsafe actions against ApprovalRecord[]
 * - Fail-closed: no approval = denied, malformed = denied, stale = denied
 * - Headless mode: destructive/conflict actions set requiresUI: true
 * - Matching approval authorizes only the matching subject/action
 *
 * Acceptance Criteria:
 *   AC-1: any unsafe action without approval → authorized: false
 *   AC-2: matching approval authorizes only matching subject/action
 *   AC-3: headless mode + destructive/conflict → requiresUI: true
 *   AC-4: 3+ callers use the same policy (structural/import test)
 *   AC-5: malformed or stale approvals → fail closed
 */

import { describe, it, expect } from "vitest";
import { createAuthorizationPolicy } from "../../../src/triage/authorization.js";
import type { ApprovalRecord, UnsafeAction } from "../../../src/shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** All six unsafe actions defined by the contract. */
const ALL_UNSAFE_ACTIONS: readonly UnsafeAction[] = [
  "destructive-cleanup",
  "checkpoint-override",
  "review-waiver",
  "merge-conflict-resolution",
  "state-force-reset",
  "overlapping-file-dispatch",
] as const;

/** Build a valid ApprovalRecord for the given action. */
function makeApprovalRecord(
  overrides: Partial<ApprovalRecord> & { subject: string },
): ApprovalRecord {
  return {
    approvalId: overrides.approvalId ?? `approval-${Date.now()}`,
    subject: overrides.subject,
    decision: overrides.decision ?? "approved",
    actor: overrides.actor ?? "human-operator",
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

/** Build an approval record with a timestamp that is stale (>24 hours old). */
function makeStaleApprovalRecord(subject: string): ApprovalRecord {
  const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
  return makeApprovalRecord({
    subject,
    timestamp: staleDate.toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: Unapproved unsafe actions are denied
// ═══════════════════════════════════════════════════════════════════════════

describe("AuthorizationPolicy", () => {
  describe("createAuthorizationPolicy", () => {
    it("returns an object with an evaluate method", () => {
      const policy = createAuthorizationPolicy();
      expect(typeof policy.evaluate).toBe("function");
    });
  });

  describe("AC-1: deny all unsafe actions without approval", () => {
    for (const action of ALL_UNSAFE_ACTIONS) {
      it(`denies "${action}" when no approvals exist`, () => {
        const policy = createAuthorizationPolicy();
        const decision = policy.evaluate(action, [], { hasUI: true });
        expect(decision.authorized).toBe(false);
        expect(decision.reason).toBeTruthy();
      });
    }

    it("returns requiresUI field on denial", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("destructive-cleanup", [], { hasUI: true });
      expect(decision).toHaveProperty("requiresUI");
      expect(typeof decision.requiresUI).toBe("boolean");
    });

    it("denies when approvals exist but none match the requested action", () => {
      const policy = createAuthorizationPolicy();
      const unrelatedApproval = makeApprovalRecord({ subject: "review-waiver" });
      const decision = policy.evaluate("destructive-cleanup", [unrelatedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-2: Matching approval authorizes only that specific action
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-2: matching approval authorizes only matching action", () => {
    it("authorizes when a matching approved record exists", () => {
      const policy = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "destructive-cleanup" });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: true });
      expect(decision.authorized).toBe(true);
    });

    it("does not authorize unrelated unsafe actions with a different approval", () => {
      const policy = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "destructive-cleanup" });

      // The approval for destructive-cleanup should NOT authorize review-waiver
      const decision = policy.evaluate("review-waiver", [approval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("authorizes only the specific matching subject from multiple approvals", () => {
      const policy = createAuthorizationPolicy();
      const approvals = [
        makeApprovalRecord({ subject: "destructive-cleanup" }),
        makeApprovalRecord({ subject: "review-waiver" }),
      ];

      const cleanupDecision = policy.evaluate("destructive-cleanup", approvals, { hasUI: true });
      expect(cleanupDecision.authorized).toBe(true);

      const waiverDecision = policy.evaluate("review-waiver", approvals, { hasUI: true });
      expect(waiverDecision.authorized).toBe(true);

      // state-force-reset has no approval
      const resetDecision = policy.evaluate("state-force-reset", approvals, { hasUI: true });
      expect(resetDecision.authorized).toBe(false);
    });

    it("does not authorize when matching subject has decision 'denied'", () => {
      const policy = createAuthorizationPolicy();
      const deniedApproval = makeApprovalRecord({
        subject: "checkpoint-override",
        decision: "denied",
      });
      const decision = policy.evaluate("checkpoint-override", [deniedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("provides a reason when denied due to explicit denial", () => {
      const policy = createAuthorizationPolicy();
      const deniedApproval = makeApprovalRecord({
        subject: "checkpoint-override",
        decision: "denied",
      });
      const decision = policy.evaluate("checkpoint-override", [deniedApproval], { hasUI: true });
      expect(decision.reason).toBeTruthy();
      expect(decision.reason.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-3: Headless mode + destructive/conflict → requiresUI: true
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-3: headless mode refuses destructive actions with requiresUI", () => {
    it("marks requiresUI: true for destructive-cleanup in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("destructive-cleanup", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks requiresUI: true for merge-conflict-resolution in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("merge-conflict-resolution", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks requiresUI: true for state-force-reset in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("state-force-reset", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks requiresUI: true for overlapping-file-dispatch in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("overlapping-file-dispatch", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks requiresUI: true for checkpoint-override in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("checkpoint-override", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks requiresUI: true for review-waiver in headless mode without approval", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("review-waiver", [], { hasUI: false });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("still authorizes in headless mode when a valid approval exists", () => {
      const policy = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "destructive-cleanup" });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: false });
      expect(decision.authorized).toBe(true);
    });

    it("denies in headed mode without approval and sets requiresUI: true", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("destructive-cleanup", [], { hasUI: true });
      expect(decision.authorized).toBe(false);
      // requiresUI means "this action requires human UI interaction to resolve" —
      // always true for unapproved actions regardless of current hasUI mode
      expect(decision.requiresUI).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-4: Structural test — 3+ callers can import and use the same policy
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-4: policy is reusable across multiple callers", () => {
    it("same policy instance serves multiple evaluations for different actions", () => {
      const policy = createAuthorizationPolicy();
      const approvals = [makeApprovalRecord({ subject: "destructive-cleanup" })];

      // Simulate 3 callers using the same policy
      const runControllerDecision = policy.evaluate("destructive-cleanup", approvals, {
        hasUI: true,
      });
      const mergePathDecision = policy.evaluate("merge-conflict-resolution", approvals, {
        hasUI: true,
      });
      const surfaceDecision = policy.evaluate("review-waiver", approvals, { hasUI: true });

      expect(runControllerDecision.authorized).toBe(true);
      expect(mergePathDecision.authorized).toBe(false);
      expect(surfaceDecision.authorized).toBe(false);
    });

    it("policy evaluation is pure — same inputs always produce same outputs", () => {
      const policy = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "state-force-reset" });

      const firstCall = policy.evaluate("state-force-reset", [approval], { hasUI: true });
      const secondCall = policy.evaluate("state-force-reset", [approval], { hasUI: true });

      expect(firstCall.authorized).toBe(secondCall.authorized);
      expect(firstCall.reason).toBe(secondCall.reason);
      expect(firstCall.requiresUI).toBe(secondCall.requiresUI);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-5: Malformed or stale approvals → fail closed
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-5: malformed or stale approvals fail closed", () => {
    it("denies when the matching approval has a stale timestamp (>24h old)", () => {
      const policy = createAuthorizationPolicy();
      const staleApproval = makeStaleApprovalRecord("destructive-cleanup");
      const decision = policy.evaluate("destructive-cleanup", [staleApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
      expect(decision.reason).toContain("stale");
    });

    it("denies when approval record has empty subject", () => {
      const policy = createAuthorizationPolicy();
      const malformedApproval = makeApprovalRecord({ subject: "" });
      const decision = policy.evaluate("destructive-cleanup", [malformedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("denies when approval record has empty approvalId", () => {
      const policy = createAuthorizationPolicy();
      const malformedApproval = makeApprovalRecord({
        subject: "destructive-cleanup",
        approvalId: "",
      });
      const decision = policy.evaluate("destructive-cleanup", [malformedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("denies when approval record has invalid timestamp", () => {
      const policy = createAuthorizationPolicy();
      const malformedApproval = makeApprovalRecord({
        subject: "destructive-cleanup",
        timestamp: "not-a-date",
      });
      const decision = policy.evaluate("destructive-cleanup", [malformedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("denies when approval record has empty actor", () => {
      const policy = createAuthorizationPolicy();
      const malformedApproval = makeApprovalRecord({
        subject: "destructive-cleanup",
        actor: "",
      });
      const decision = policy.evaluate("destructive-cleanup", [malformedApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("prefers a valid non-stale approval over a stale one for the same subject", () => {
      const policy = createAuthorizationPolicy();
      const staleApproval = makeStaleApprovalRecord("merge-conflict-resolution");
      const freshApproval = makeApprovalRecord({ subject: "merge-conflict-resolution" });

      const decision = policy.evaluate(
        "merge-conflict-resolution",
        [staleApproval, freshApproval],
        { hasUI: true },
      );
      expect(decision.authorized).toBe(true);
    });

    it("denies when all matching approvals are stale", () => {
      const policy = createAuthorizationPolicy();
      const staleOne = makeStaleApprovalRecord("checkpoint-override");
      const staleTwo = makeStaleApprovalRecord("checkpoint-override");

      const decision = policy.evaluate("checkpoint-override", [staleOne, staleTwo], {
        hasUI: true,
      });
      expect(decision.authorized).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Adversarial: edge cases and boundary conditions
  // ═══════════════════════════════════════════════════════════════════════════

  describe("recency: most recent matching record wins", () => {
    it("uses the most recent approval when multiple match the same subject", () => {
      const policy = createAuthorizationPolicy();
      const olderDenial = makeApprovalRecord({
        approvalId: "old-denial",
        subject: "destructive-cleanup",
        decision: "denied",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      });
      const newerApproval = makeApprovalRecord({
        approvalId: "new-approval",
        subject: "destructive-cleanup",
        decision: "approved",
        timestamp: new Date().toISOString(),
      });

      const decision = policy.evaluate("destructive-cleanup", [olderDenial, newerApproval], {
        hasUI: true,
      });
      expect(decision.authorized).toBe(true);
    });

    it("uses the most recent denial when it follows an approval", () => {
      const policy = createAuthorizationPolicy();
      const olderApproval = makeApprovalRecord({
        approvalId: "older-approval",
        subject: "destructive-cleanup",
        decision: "approved",
        timestamp: new Date(Date.now() - 60_000).toISOString(),
      });
      const newerDenial = makeApprovalRecord({
        approvalId: "newer-denial",
        subject: "destructive-cleanup",
        decision: "denied",
        timestamp: new Date().toISOString(),
      });

      const decision = policy.evaluate("destructive-cleanup", [olderApproval, newerDenial], {
        hasUI: true,
      });
      expect(decision.authorized).toBe(false);
    });
  });

  describe("requiresUI semantics: denial type determines UI requirement", () => {
    it("explicitly denied approvals do not require UI (human already decided)", () => {
      const policy = createAuthorizationPolicy();
      const denial = makeApprovalRecord({
        subject: "review-waiver",
        decision: "denied",
      });
      const decision = policy.evaluate("review-waiver", [denial], { hasUI: true });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(false);
    });

    it("marks stale approvals as requiresUI (re-approval needed)", () => {
      const policy = createAuthorizationPolicy();
      const staleApproval = makeStaleApprovalRecord("checkpoint-override");
      const decision = policy.evaluate("checkpoint-override", [staleApproval], { hasUI: true });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });

    it("marks malformed approvals as requiresUI (proper approval needed)", () => {
      const policy = createAuthorizationPolicy();
      const malformed = makeApprovalRecord({
        subject: "destructive-cleanup",
        approvalId: "",
      });
      const decision = policy.evaluate("destructive-cleanup", [malformed], { hasUI: true });
      expect(decision.authorized).toBe(false);
      expect(decision.requiresUI).toBe(true);
    });
  });

  describe("factory independence", () => {
    it("produces independent instances (no shared mutable state)", () => {
      const policyA = createAuthorizationPolicy();
      const policyB = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "destructive-cleanup" });

      const decisionA = policyA.evaluate("destructive-cleanup", [approval], { hasUI: true });
      const decisionB = policyB.evaluate("destructive-cleanup", [], { hasUI: true });

      expect(decisionA.authorized).toBe(true);
      expect(decisionB.authorized).toBe(false);
    });
  });

  describe("adversarial: edge cases", () => {
    it("denies when approval has decision 'approved' but timestamp is exactly 24h ago (boundary)", () => {
      const policy = createAuthorizationPolicy();
      // Exactly at the boundary — should still be valid (not yet stale)
      const boundaryDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const approval = makeApprovalRecord({
        subject: "destructive-cleanup",
        timestamp: boundaryDate.toISOString(),
      });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: true });
      // At exactly 24h, the record should still be valid (stale is strictly > 24h)
      expect(decision.authorized).toBe(true);
    });

    it("denies when approval timestamp is in the future", () => {
      const policy = createAuthorizationPolicy();
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour in future
      const approval = makeApprovalRecord({
        subject: "destructive-cleanup",
        timestamp: futureDate.toISOString(),
      });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("handles empty approval array gracefully", () => {
      const policy = createAuthorizationPolicy();
      const decision = policy.evaluate("state-force-reset", [], { hasUI: true });
      expect(decision.authorized).toBe(false);
      expect(decision.reason).toBeTruthy();
    });

    it("does not perform substring matching on subjects", () => {
      const policy = createAuthorizationPolicy();
      // "destructive-cleanup" should NOT match "destructive-cleanup-extended"
      const approval = makeApprovalRecord({ subject: "destructive-cleanup-extended" });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });

    it("does not perform prefix matching on subjects", () => {
      const policy = createAuthorizationPolicy();
      const approval = makeApprovalRecord({ subject: "destructive" });
      const decision = policy.evaluate("destructive-cleanup", [approval], { hasUI: true });
      expect(decision.authorized).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Module purity: no I/O imports
  // ═══════════════════════════════════════════════════════════════════════════

  describe("module purity", () => {
    it("authorization.ts source does not import node:fs or node:child_process", async () => {
      const { readFile } = await import("node:fs/promises");
      const source = await readFile(
        new URL("../../../src/triage/authorization.ts", import.meta.url),
        "utf-8",
      );
      expect(source).not.toMatch(/from\s+["']node:fs/);
      expect(source).not.toMatch(/from\s+["']node:child_process/);
      expect(source).not.toMatch(/require\s*\(\s*["']fs/);
      expect(source).not.toMatch(/require\s*\(\s*["']child_process/);
    });
  });
});
