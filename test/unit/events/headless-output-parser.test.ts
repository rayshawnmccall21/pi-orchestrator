/**
 * Tests for HeadlessWorkflowOutput parser.
 */
import { describe, it, expect } from "vitest";
import { parseHeadlessOutput } from "../../../src/events/headless-output-parser.js";

const VALID_OUTPUT = JSON.stringify({
  schemaVersion: "pi-bmad.headless-workflow-result.v1",
  workflow: "dev-story",
  returnType: "pi-bmad.workflow.dev-story.result.v1",
  status: "success",
  exitCode: 0,
  completedSteps: ["load-story", "red-phase", "green-phase"],
  failedSteps: [],
  artifacts: { story: ".pi/artifacts/implementation/stories/test.md" },
  payload: { storyId: "sh-1", testsPassed: true, typecheckPassed: true, lintPassed: true, testsAdded: 3, filesChanged: ["src/foo.ts"] },
  emittedAt: "2026-05-27T00:00:00Z",
  durationMs: 5000,
});

describe("parseHeadlessOutput", () => {
  it("parses valid HeadlessWorkflowOutput from stdout", () => {
    const result = parseHeadlessOutput(VALID_OUTPUT);
    expect(result.kind).toBe("parsed");
    if (result.kind === "parsed") {
      expect(result.output.workflow).toBe("dev-story");
      expect(result.output.status).toBe("success");
      expect(result.output.exitCode).toBe(0);
      expect(result.output.completedSteps).toHaveLength(3);
      expect(result.output.payload).toBeTruthy();
    }
  });

  it("extracts output from mixed stdout with non-JSON lines", () => {
    const mixed = `Loading pi-bmad extension...\nStarting workflow dev-story\n${VALID_OUTPUT}\nDone.`;
    const result = parseHeadlessOutput(mixed);
    expect(result.kind).toBe("parsed");
  });

  it("takes the last matching JSON object when multiple exist", () => {
    const first = JSON.stringify({ schemaVersion: "pi-bmad.headless-workflow-result.v1", workflow: "dev-story", returnType: "x", status: "failed", exitCode: 1, completedSteps: [], failedSteps: [], artifacts: {}, payload: null, emittedAt: "2026-01-01T00:00:00Z", durationMs: 100 });
    const combined = `${first}\n${VALID_OUTPUT}`;
    const result = parseHeadlessOutput(combined);
    expect(result.kind).toBe("parsed");
    if (result.kind === "parsed") {
      expect(result.output.status).toBe("success"); // Last one wins
    }
  });

  it("returns no-output for empty stdout", () => {
    const result = parseHeadlessOutput("");
    expect(result.kind).toBe("no-output");
  });

  it("returns no-output for stdout with no JSON", () => {
    const result = parseHeadlessOutput("just some text\nmore text\n");
    expect(result.kind).toBe("no-output");
  });

  it("returns no-output when JSON exists but has wrong schemaVersion", () => {
    const wrong = JSON.stringify({ schemaVersion: "wrong-version", workflow: "dev-story" });
    const result = parseHeadlessOutput(wrong);
    expect(result.kind).toBe("no-output");
  });

  it("returns invalid-schema for correct schemaVersion but missing fields", () => {
    const incomplete = JSON.stringify({ schemaVersion: "pi-bmad.headless-workflow-result.v1", workflow: "dev-story" });
    const result = parseHeadlessOutput(incomplete);
    expect(result.kind).toBe("invalid-schema");
  });

  it("parses failed workflow output with null payload", () => {
    const failed = JSON.stringify({
      schemaVersion: "pi-bmad.headless-workflow-result.v1",
      workflow: "dev-story",
      returnType: "pi-bmad.workflow.dev-story.result.v1",
      status: "failed",
      exitCode: 1,
      completedSteps: ["load-story"],
      failedSteps: [{ step: "red-phase", reason: "Tests did not fail" }],
      artifacts: {},
      payload: null,
      emittedAt: "2026-05-27T00:00:00Z",
      durationMs: 3000,
    });
    const result = parseHeadlessOutput(failed);
    expect(result.kind).toBe("parsed");
    if (result.kind === "parsed") {
      expect(result.output.status).toBe("failed");
      expect(result.output.payload).toBeNull();
      expect(result.output.failedSteps).toHaveLength(1);
    }
  });

  it("parses partial workflow output", () => {
    const partial = JSON.stringify({
      schemaVersion: "pi-bmad.headless-workflow-result.v1",
      workflow: "dev-story",
      returnType: "pi-bmad.workflow.dev-story.result.v1",
      status: "partial",
      exitCode: 2,
      completedSteps: ["load-story", "red-phase"],
      failedSteps: [{ step: "green-phase", reason: "Skipped" }],
      artifacts: {},
      payload: { storyId: "sh-1", testsPassed: false, typecheckPassed: false, lintPassed: false, testsAdded: 2, filesChanged: [] },
      emittedAt: "2026-05-27T00:00:00Z",
      durationMs: 4000,
    });
    const result = parseHeadlessOutput(partial);
    expect(result.kind).toBe("parsed");
    if (result.kind === "parsed") {
      expect(result.output.exitCode).toBe(2);
    }
  });

  it("parses all 8 content workflow return types", () => {
    const workflows = [
      { id: "create-prd", payload: { prdPath: "prd.md", epicCount: 3, storyCount: 10 } },
      { id: "architecture-design", payload: { architecturePath: "arch.md", moduleCount: 5, decisions: [] } },
      { id: "sprint-planning", payload: { sprintId: "s1", storyIds: ["sh-1"], totalPoints: 8 } },
      { id: "create-story", payload: { storyId: "sh-1", storyPath: "story.md", acceptanceCriteriaCount: 5 } },
      { id: "e2e-plan", payload: { storyId: "sh-1", scenarioCount: 4, coverageComplete: true } },
      { id: "dev-story", payload: { storyId: "sh-1", testsAdded: 3, filesChanged: ["f.ts"], testsPassed: true, typecheckPassed: true, lintPassed: true } },
      { id: "e2e-verify", payload: { storyId: "sh-1", scenariosPassed: 4, scenariosFailed: 0, verdict: "pass" } },
      { id: "code-review", payload: { storyId: "sh-1", verdict: "approved", findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0 }, autoFixed: false } },
    ];

    for (const wf of workflows) {
      const output = JSON.stringify({
        schemaVersion: "pi-bmad.headless-workflow-result.v1",
        workflow: wf.id,
        returnType: `pi-bmad.workflow.${wf.id}.result.v1`,
        status: "success",
        exitCode: 0,
        completedSteps: ["step-1"],
        failedSteps: [],
        artifacts: {},
        payload: wf.payload,
        emittedAt: "2026-05-27T00:00:00Z",
        durationMs: 1000,
      });
      const result = parseHeadlessOutput(output);
      expect(result.kind, `Failed for workflow ${wf.id}`).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.output.workflow).toBe(wf.id);
        expect(result.output.payload).toEqual(wf.payload);
      }
    }
  });
});
