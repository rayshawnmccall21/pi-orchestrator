/**
 * Tests for result-mapper: HeadlessWorkflowOutput → StoryOutcomeInput.
 */
import { describe, it, expect } from "vitest";
import { mapResultToOutcome } from "../../../src/state/result-mapper.js";
import type { HeadlessWorkflowOutput } from "../../../src/shared/types.js";

function makeOutput(overrides: Partial<HeadlessWorkflowOutput>): HeadlessWorkflowOutput {
  return {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "dev-story",
    returnType: "pi-bmad.workflow.dev-story.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["step-1"],
    failedSteps: [],
    artifacts: {},
    payload: {},
    emittedAt: "2026-01-01T00:00:00Z",
    durationMs: 1000,
    ...overrides,
  };
}

describe("mapResultToOutcome", () => {
  describe("failed workflows always map to ERROR", () => {
    const failedWorkflows = ["create-story", "e2e-plan", "dev-story", "e2e-verify", "code-review"];
    for (const wf of failedWorkflows) {
      it(`${wf} with status=failed → ERROR`, () => {
        const output = makeOutput({ workflow: wf, status: "failed", exitCode: 1, payload: null });
        const result = mapResultToOutcome(output, "d-1", "wr-1");
        expect(result.semanticOutcome).toBe("ERROR");
      });
    }
  });

  describe("create-story", () => {
    it("success → STORY_READY", () => {
      const output = makeOutput({ workflow: "create-story", payload: { storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("STORY_READY");
    });
  });

  describe("e2e-plan", () => {
    it("success → PLAN_READY", () => {
      const output = makeOutput({ workflow: "e2e-plan", payload: { scenarioCount: 4 } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("PLAN_READY");
    });
  });

  describe("dev-story", () => {
    it("success → IMPLEMENTED", () => {
      const output = makeOutput({ workflow: "dev-story", payload: { testsPassed: true } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("IMPLEMENTED");
    });
  });

  describe("e2e-verify — payload.verdict drives branching", () => {
    it("success + verdict=pass → PASS", () => {
      const output = makeOutput({ workflow: "e2e-verify", payload: { verdict: "pass", scenariosPassed: 5, scenariosFailed: 0, storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("PASS");
    });

    it("success + verdict=fail → FAIL (payload wins over status)", () => {
      const output = makeOutput({ workflow: "e2e-verify", payload: { verdict: "fail", scenariosPassed: 3, scenariosFailed: 2, storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("FAIL");
    });

    it("success + null payload → ERROR", () => {
      const output = makeOutput({ workflow: "e2e-verify", payload: null });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("ERROR");
    });
  });

  describe("code-review — payload.verdict and findings drive branching", () => {
    it("success + verdict=approved → APPROVED", () => {
      const output = makeOutput({ workflow: "code-review", payload: { verdict: "approved", findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("APPROVED");
    });

    it("success + verdict=needs-dev → NEEDS_DEV", () => {
      const output = makeOutput({ workflow: "code-review", payload: { verdict: "needs-dev", findingsBySeverity: { critical: 1, high: 0, medium: 0, low: 0 }, storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("NEEDS_DEV");
    });

    it("success + verdict=needs-verify → FIXED_REQUIRES_VERIFY", () => {
      const output = makeOutput({ workflow: "code-review", payload: { verdict: "needs-verify", storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("FIXED_REQUIRES_VERIFY");
    });

    it("success + critical findings with needs-dev → NEEDS_DEV", () => {
      const output = makeOutput({ workflow: "code-review", payload: { verdict: "needs-dev", findingsBySeverity: { critical: 3, high: 1, medium: 0, low: 0 }, storyId: "sh-1" } });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("NEEDS_DEV");
    });

    it("success + null payload → ERROR", () => {
      const output = makeOutput({ workflow: "code-review", payload: null });
      expect(mapResultToOutcome(output, "d-1", "wr-1").semanticOutcome).toBe("ERROR");
    });
  });

  describe("unknown workflow", () => {
    it("throws OrchestratorError for unknown workflow ID", () => {
      const output = makeOutput({ workflow: "unknown-workflow" });
      expect(() => mapResultToOutcome(output, "d-1", "wr-1")).toThrow("Unknown workflow");
    });
  });

  describe("idempotency fields", () => {
    it("passes dispatchId and workflowRunId through to outcome", () => {
      const output = makeOutput({ workflow: "dev-story" });
      const result = mapResultToOutcome(output, "dispatch-42", "run-99");
      expect(result.dispatchId).toBe("dispatch-42");
      expect(result.workflowRunId).toBe("run-99");
    });
  });
});
