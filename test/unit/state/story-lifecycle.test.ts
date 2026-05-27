/**
 * Unit tests for the private story-lifecycle pure reducer.
 *
 * story-lifecycle.ts is a private module used only by pipeline.ts.
 * All tests exercise the pure FSM transitions, counter semantics,
 * and idempotency rules defined in story-fsm-addendum.md.
 */

import { describe, it, expect } from "vitest";
import {
  applyStoryOutcome,
  createInitialStoryLifecycle,
} from "../../../src/state/story-lifecycle.js";
import type { StoryLifecycleState } from "../../../src/shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function makeLifecycle(overrides: Partial<StoryLifecycleState> = {}): StoryLifecycleState {
  return {
    storyId: "story-1",
    next: "create-story",
    e2eAttemptsInCycle: 0,
    maxE2eAttempts: 3,
    reviewLoopbacks: 0,
    maxReviewLoopbacks: 3,
    lastProcessedDispatchId: null,
    lastProcessedWorkflowRunId: null,
    lastSemanticOutcome: null,
    reviewFindings: null,
    blockerReason: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// createInitialStoryLifecycle
// ═══════════════════════════════════════════════════════════════════════════

describe("story-lifecycle", () => {
  describe("createInitialStoryLifecycle", () => {
    it("creates a lifecycle at create-story with zero counters", () => {
      const lifecycle = createInitialStoryLifecycle("story-42", {
        maxE2eAttempts: 3,
        maxReviewLoopbacks: 3,
      });
      expect(lifecycle.storyId).toBe("story-42");
      expect(lifecycle.next).toBe("create-story");
      expect(lifecycle.e2eAttemptsInCycle).toBe(0);
      expect(lifecycle.reviewLoopbacks).toBe(0);
      expect(lifecycle.lastProcessedDispatchId).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Happy path FSM transitions
  // ═══════════════════════════════════════════════════════════════════════

  describe("applyStoryOutcome", () => {
    describe("create-story → e2e-plan", () => {
      it("transitions on STORY_READY", () => {
        const current = makeLifecycle({ next: "create-story" });
        const result = applyStoryOutcome(current, {
          workflowId: "create-story",
          semanticOutcome: "STORY_READY",
          dispatchId: "d1",
          workflowRunId: "wr1",
        });
        expect(result.next).toBe("e2e-plan");
        expect(result.lastProcessedDispatchId).toBe("d1");
        expect(result.lastProcessedWorkflowRunId).toBe("wr1");
        expect(result.lastSemanticOutcome).toBe("STORY_READY");
      });
    });

    describe("e2e-plan → dev-story", () => {
      it("transitions on PLAN_READY", () => {
        const current = makeLifecycle({ next: "e2e-plan" });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-plan",
          semanticOutcome: "PLAN_READY",
          dispatchId: "d2",
          workflowRunId: "wr2",
        });
        expect(result.next).toBe("dev-story");
      });
    });

    describe("dev-story → e2e-verify", () => {
      it("transitions on IMPLEMENTED", () => {
        const current = makeLifecycle({ next: "dev-story" });
        const result = applyStoryOutcome(current, {
          workflowId: "dev-story",
          semanticOutcome: "IMPLEMENTED",
          dispatchId: "d3",
          workflowRunId: "wr3",
        });
        expect(result.next).toBe("e2e-verify");
      });
    });

    describe("e2e-verify → code-review (PASS)", () => {
      it("transitions to code-review on PASS", () => {
        const current = makeLifecycle({ next: "e2e-verify", e2eAttemptsInCycle: 0 });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "PASS",
          dispatchId: "d4",
          workflowRunId: "wr4",
        });
        expect(result.next).toBe("code-review");
      });

      it("resets e2eAttemptsInCycle to 0 on PASS", () => {
        const current = makeLifecycle({ next: "e2e-verify", e2eAttemptsInCycle: 2 });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "PASS",
          dispatchId: "d4",
          workflowRunId: "wr4",
        });
        expect(result.e2eAttemptsInCycle).toBe(0);
      });
    });

    describe("e2e-verify FAIL below budget", () => {
      it("routes to dev-story and increments e2eAttemptsInCycle", () => {
        const current = makeLifecycle({ next: "e2e-verify", e2eAttemptsInCycle: 0 });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "FAIL",
          dispatchId: "d5",
          workflowRunId: "wr5",
        });
        expect(result.next).toBe("dev-story");
        expect(result.e2eAttemptsInCycle).toBe(1);
      });

      it("routes to dev-story on second failure", () => {
        const current = makeLifecycle({ next: "e2e-verify", e2eAttemptsInCycle: 1 });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "FAIL",
          dispatchId: "d6",
          workflowRunId: "wr6",
        });
        expect(result.next).toBe("dev-story");
        expect(result.e2eAttemptsInCycle).toBe(2);
      });
    });

    describe("e2e-verify FAIL at budget", () => {
      it("escalates when e2eAttemptsInCycle reaches maxE2eAttempts", () => {
        const current = makeLifecycle({
          next: "e2e-verify",
          e2eAttemptsInCycle: 2,
          maxE2eAttempts: 3,
        });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "FAIL",
          dispatchId: "d7",
          workflowRunId: "wr7",
        });
        expect(result.next).toBe("escalated");
      });
    });

    describe("code-review → done (APPROVED)", () => {
      it("transitions to done on APPROVED", () => {
        const current = makeLifecycle({ next: "code-review" });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "APPROVED",
          dispatchId: "d8",
          workflowRunId: "wr8",
        });
        expect(result.next).toBe("done");
      });
    });

    describe("code-review NEEDS_DEV below budget", () => {
      it("routes to dev-story and increments reviewLoopbacks", () => {
        const current = makeLifecycle({ next: "code-review", reviewLoopbacks: 0 });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "NEEDS_DEV",
          dispatchId: "d9",
          workflowRunId: "wr9",
        });
        expect(result.next).toBe("dev-story");
        expect(result.reviewLoopbacks).toBe(1);
      });

      it("resets e2eAttemptsInCycle on loopback to dev-story", () => {
        const current = makeLifecycle({
          next: "code-review",
          reviewLoopbacks: 0,
          e2eAttemptsInCycle: 2,
        });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "NEEDS_DEV",
          dispatchId: "d10",
          workflowRunId: "wr10",
        });
        expect(result.e2eAttemptsInCycle).toBe(0);
      });
    });

    describe("code-review NEEDS_DEV at budget", () => {
      it("escalates when reviewLoopbacks reaches max", () => {
        const current = makeLifecycle({
          next: "code-review",
          reviewLoopbacks: 3,
          maxReviewLoopbacks: 3,
        });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "NEEDS_DEV",
          dispatchId: "d11",
          workflowRunId: "wr11",
        });
        expect(result.next).toBe("escalated");
      });
    });

    describe("code-review FIXED_REQUIRES_VERIFY below budget", () => {
      it("routes to e2e-verify and increments reviewLoopbacks", () => {
        const current = makeLifecycle({ next: "code-review", reviewLoopbacks: 0 });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "FIXED_REQUIRES_VERIFY",
          dispatchId: "d12",
          workflowRunId: "wr12",
        });
        expect(result.next).toBe("e2e-verify");
        expect(result.reviewLoopbacks).toBe(1);
      });

      it("resets e2eAttemptsInCycle on loopback to e2e-verify", () => {
        const current = makeLifecycle({
          next: "code-review",
          reviewLoopbacks: 1,
          e2eAttemptsInCycle: 2,
        });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "FIXED_REQUIRES_VERIFY",
          dispatchId: "d13",
          workflowRunId: "wr13",
        });
        expect(result.e2eAttemptsInCycle).toBe(0);
      });
    });

    describe("code-review FIXED_REQUIRES_VERIFY at budget", () => {
      it("escalates when reviewLoopbacks reaches max", () => {
        const current = makeLifecycle({
          next: "code-review",
          reviewLoopbacks: 3,
          maxReviewLoopbacks: 3,
        });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "FIXED_REQUIRES_VERIFY",
          dispatchId: "d14",
          workflowRunId: "wr14",
        });
        expect(result.next).toBe("escalated");
      });
    });

    // ═════════════════════════════════════════════════════════════════════
    // ERROR outcomes — do not increment counters
    // ═════════════════════════════════════════════════════════════════════

    describe("ERROR outcomes", () => {
      it("returns blocked for create-story ERROR without incrementing counters", () => {
        const current = makeLifecycle({ next: "create-story" });
        const result = applyStoryOutcome(current, {
          workflowId: "create-story",
          semanticOutcome: "ERROR",
          dispatchId: "d15",
          workflowRunId: "wr15",
        });
        expect(result.next).toBe("blocked");
        expect(result.e2eAttemptsInCycle).toBe(0);
        expect(result.reviewLoopbacks).toBe(0);
        expect(result.blockerReason).toContain("create-story");
        expect(result.blockerReason).toContain("ERROR");
      });

      it("returns blocked for e2e-verify ERROR without incrementing e2e counter", () => {
        const current = makeLifecycle({ next: "e2e-verify", e2eAttemptsInCycle: 1 });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-verify",
          semanticOutcome: "ERROR",
          dispatchId: "d16",
          workflowRunId: "wr16",
        });
        expect(result.next).toBe("blocked");
        expect(result.e2eAttemptsInCycle).toBe(1);
        expect(result.blockerReason).toContain("e2e-verify");
        expect(result.blockerReason).toContain("ERROR");
      });

      it("returns blocked for code-review ERROR without incrementing review counter", () => {
        const current = makeLifecycle({ next: "code-review", reviewLoopbacks: 2 });
        const result = applyStoryOutcome(current, {
          workflowId: "code-review",
          semanticOutcome: "ERROR",
          dispatchId: "d17",
          workflowRunId: "wr17",
        });
        expect(result.next).toBe("blocked");
        expect(result.reviewLoopbacks).toBe(2);
        expect(result.blockerReason).toContain("code-review");
        expect(result.blockerReason).toContain("ERROR");
      });
    });

    // ═════════════════════════════════════════════════════════════════════
    // Adversarial / invalid transitions
    // ═════════════════════════════════════════════════════════════════════

    describe("invalid transitions", () => {
      it("throws on workflowId mismatch with current next state", () => {
        const current = makeLifecycle({ next: "create-story" });
        expect(() =>
          applyStoryOutcome(current, {
            workflowId: "dev-story",
            semanticOutcome: "IMPLEMENTED",
            dispatchId: "d-bad",
            workflowRunId: "wr-bad",
          }),
        ).toThrow();
      });

      it("throws on unknown semanticOutcome for known workflowId", () => {
        const current = makeLifecycle({ next: "create-story" });
        expect(() =>
          applyStoryOutcome(current, {
            workflowId: "create-story",
            semanticOutcome: "UNKNOWN_VALUE",
            dispatchId: "d-bad2",
            workflowRunId: "wr-bad2",
          }),
        ).toThrow();
      });

      it("throws when lifecycle is in terminal state done", () => {
        const current = makeLifecycle({ next: "done" });
        expect(() =>
          applyStoryOutcome(current, {
            workflowId: "code-review",
            semanticOutcome: "APPROVED",
            dispatchId: "d-bad3",
            workflowRunId: "wr-bad3",
          }),
        ).toThrow();
      });

      it("throws when lifecycle is in terminal state escalated", () => {
        const current = makeLifecycle({ next: "escalated" });
        expect(() =>
          applyStoryOutcome(current, {
            workflowId: "dev-story",
            semanticOutcome: "IMPLEMENTED",
            dispatchId: "d-bad4",
            workflowRunId: "wr-bad4",
          }),
        ).toThrow();
      });

      it("throws when lifecycle is in blocked state", () => {
        const current = makeLifecycle({ next: "blocked" });
        expect(() =>
          applyStoryOutcome(current, {
            workflowId: "dev-story",
            semanticOutcome: "IMPLEMENTED",
            dispatchId: "d-bad5",
            workflowRunId: "wr-bad5",
          }),
        ).toThrow();
      });
    });

    // ═════════════════════════════════════════════════════════════════════
    // Idempotency
    // ═════════════════════════════════════════════════════════════════════

    describe("idempotency", () => {
      it("is idempotent for same dispatchId + workflowRunId", () => {
        const current = makeLifecycle({
          next: "e2e-plan",
          lastProcessedDispatchId: "d-already",
          lastProcessedWorkflowRunId: "wr-already",
          lastSemanticOutcome: "PLAN_READY",
        });
        const result = applyStoryOutcome(current, {
          workflowId: "e2e-plan",
          semanticOutcome: "PLAN_READY",
          dispatchId: "d-already",
          workflowRunId: "wr-already",
        });
        // Returns unchanged state — no double transition
        expect(result).toEqual(current);
      });
    });

    // ═════════════════════════════════════════════════════════════════════
    // Immutability
    // ═════════════════════════════════════════════════════════════════════

    describe("immutability", () => {
      it("does not mutate the input state object", () => {
        const current = makeLifecycle({ next: "create-story" });
        const frozen = { ...current };
        applyStoryOutcome(current, {
          workflowId: "create-story",
          semanticOutcome: "STORY_READY",
          dispatchId: "d-imm",
          workflowRunId: "wr-imm",
        });
        expect(current).toEqual(frozen);
      });
    });
  });
});
