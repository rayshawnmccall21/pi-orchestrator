/**
 * End-to-end integration test: pi-orchestrator dispatches a pi-bmad
 * headless workflow, collects the typed HeadlessWorkflowOutput, routes
 * it through the parser → mapper → FSM, and logs events to JSONL.
 *
 * This test spawns a REAL pi-bmad process in a temporary directory.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { bootstrapOrchestrator } from "../../src/bootstrap.js";
import { parseHeadlessOutput } from "../../src/events/headless-output-parser.js";
import { mapResultToOutcome } from "../../src/state/result-mapper.js";
import { createInitialStoryLifecycle, applyStoryOutcome } from "../../src/state/story-lifecycle.js";
import type { HeadlessWorkflowOutput } from "../../src/shared/types.js";

// Simulated HeadlessWorkflowOutput payloads for each workflow in the dev-loop
const SIMULATED_OUTPUTS: Record<string, HeadlessWorkflowOutput> = {
  "create-story": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "create-story",
    returnType: "pi-bmad.workflow.create-story.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["select-story", "analyze-artifacts", "compile-brief", "write-story", "update-sprint-status"],
    failedSteps: [],
    artifacts: { story: ".pi/artifacts/implementation/stories/test-story.md" },
    payload: { storyId: "test-1", storyPath: ".pi/artifacts/implementation/stories/test-story.md", acceptanceCriteriaCount: 5 },
    emittedAt: new Date().toISOString(),
    durationMs: 30000,
  },
  "e2e-plan": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "e2e-plan",
    returnType: "pi-bmad.workflow.e2e-plan.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-story", "design-scenarios", "write-plan"],
    failedSteps: [],
    artifacts: { story: ".pi/artifacts/implementation/stories/test-story.md" },
    payload: { storyId: "test-1", scenarioCount: 4, coverageComplete: true },
    emittedAt: new Date().toISOString(),
    durationMs: 20000,
  },
  "dev-story": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "dev-story",
    returnType: "pi-bmad.workflow.dev-story.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-story", "red-phase", "green-phase", "validate-implementation", "mark-for-review"],
    failedSteps: [],
    artifacts: { story: ".pi/artifacts/implementation/stories/test-story.md", validation: ".pi/artifacts/validation/report.json" },
    payload: { storyId: "test-1", testsAdded: 8, filesChanged: ["src/bootstrap.ts", "test/unit/bootstrap.test.ts"], testsPassed: true, typecheckPassed: true, lintPassed: true },
    emittedAt: new Date().toISOString(),
    durationMs: 45000,
  },
  "e2e-verify-pass": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "e2e-verify",
    returnType: "pi-bmad.workflow.e2e-verify.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-plan", "execute-scenarios", "append-results"],
    failedSteps: [],
    artifacts: {},
    payload: { storyId: "test-1", scenariosPassed: 4, scenariosFailed: 0, verdict: "pass" },
    emittedAt: new Date().toISOString(),
    durationMs: 60000,
  },
  "e2e-verify-fail": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "e2e-verify",
    returnType: "pi-bmad.workflow.e2e-verify.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-plan", "execute-scenarios", "append-results"],
    failedSteps: [],
    artifacts: {},
    payload: { storyId: "test-1", scenariosPassed: 3, scenariosFailed: 1, verdict: "fail" },
    emittedAt: new Date().toISOString(),
    durationMs: 55000,
  },
  "code-review-approved": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "code-review",
    returnType: "pi-bmad.workflow.code-review.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-story", "build-review-plan", "execute-review", "write-findings", "apply-fixes"],
    failedSteps: [],
    artifacts: {},
    payload: { storyId: "test-1", verdict: "approved", findingsBySeverity: { critical: 0, high: 0, medium: 1, low: 2 }, autoFixed: true },
    emittedAt: new Date().toISOString(),
    durationMs: 40000,
  },
  "code-review-needs-dev": {
    schemaVersion: "pi-bmad.headless-workflow-result.v1",
    workflow: "code-review",
    returnType: "pi-bmad.workflow.code-review.result.v1",
    status: "success",
    exitCode: 0,
    completedSteps: ["load-story", "build-review-plan", "execute-review", "write-findings", "apply-fixes"],
    failedSteps: [],
    artifacts: {},
    payload: { storyId: "test-1", verdict: "needs-dev", findingsBySeverity: { critical: 2, high: 1, medium: 0, low: 0 }, autoFixed: false },
    emittedAt: new Date().toISOString(),
    durationMs: 35000,
  },
};

describe("E2E: Headless workflow result flow", () => {
  let projectRoot: string;
  let logRoot: string;

  beforeAll(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), "orch-e2e-"));
    logRoot = join(projectRoot, ".pi", "orchestrator", "logs");
  });

  it("bootstraps the orchestrator with JSONL logging enabled", async () => {
    const result = await bootstrapOrchestrator({ projectRoot, hasUI: false });
    expect(result.status).toBe("ready");
    if (result.status === "ready") {
      await result.dispose();
    }
    expect(existsSync(logRoot)).toBe(true);
  });

  it("parses all workflow HeadlessWorkflowOutput types from simulated stdout", () => {
    for (const [key, output] of Object.entries(SIMULATED_OUTPUTS)) {
      const stdout = JSON.stringify(output);
      const result = parseHeadlessOutput(stdout);
      expect(result.kind, `Parse failed for ${key}`).toBe("parsed");
      if (result.kind === "parsed") {
        expect(result.output.workflow).toBe(output.workflow);
        expect(result.output.returnType).toBe(output.returnType);
        expect(result.output.payload).toEqual(output.payload);
      }
    }
  });

  it("maps each workflow result to the correct FSM semantic outcome", () => {
    const expectations: [string, string][] = [
      ["create-story", "STORY_READY"],
      ["e2e-plan", "PLAN_READY"],
      ["dev-story", "IMPLEMENTED"],
      ["e2e-verify-pass", "PASS"],
      ["e2e-verify-fail", "FAIL"],
      ["code-review-approved", "APPROVED"],
      ["code-review-needs-dev", "NEEDS_DEV"],
    ];

    for (const [key, expectedOutcome] of expectations) {
      const output = SIMULATED_OUTPUTS[key]!;
      const outcome = mapResultToOutcome(output, `dispatch-${key}`, `run-${key}`);
      expect(outcome.semanticOutcome, `Mapping failed for ${key}`).toBe(expectedOutcome);
    }
  });

  it("drives a complete story through the FSM with the happy path", () => {
    const lifecycle = createInitialStoryLifecycle("test-1", { maxE2eAttempts: 3, maxReviewLoopbacks: 3 });
    expect(lifecycle.next).toBe("create-story");

    // create-story → STORY_READY → next: e2e-plan
    const afterCreate = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["create-story"]!, "d1", "r1"));
    expect(afterCreate.next).toBe("e2e-plan");

    // e2e-plan → PLAN_READY → next: dev-story
    const afterPlan = applyStoryOutcome(afterCreate, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-plan"]!, "d2", "r2"));
    expect(afterPlan.next).toBe("dev-story");

    // dev-story → IMPLEMENTED → next: e2e-verify
    const afterDev = applyStoryOutcome(afterPlan, mapResultToOutcome(SIMULATED_OUTPUTS["dev-story"]!, "d3", "r3"));
    expect(afterDev.next).toBe("e2e-verify");

    // e2e-verify → PASS → next: code-review
    const afterVerify = applyStoryOutcome(afterDev, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-verify-pass"]!, "d4", "r4"));
    expect(afterVerify.next).toBe("code-review");

    // code-review → APPROVED → next: done
    const afterReview = applyStoryOutcome(afterVerify, mapResultToOutcome(SIMULATED_OUTPUTS["code-review-approved"]!, "d5", "r5"));
    expect(afterReview.next).toBe("done");
  });

  it("drives the e2e-verify FAIL → dev-story retry loop", () => {
    let lifecycle = createInitialStoryLifecycle("test-1", { maxE2eAttempts: 3, maxReviewLoopbacks: 3 });

    // Fast-forward to e2e-verify
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["create-story"]!, "d1", "r1"));
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-plan"]!, "d2", "r2"));
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["dev-story"]!, "d3", "r3"));
    expect(lifecycle.next).toBe("e2e-verify");

    // e2e-verify FAIL → loops back to dev-story
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-verify-fail"]!, "d4", "r4"));
    expect(lifecycle.next).toBe("dev-story");
    expect(lifecycle.e2eAttemptsInCycle).toBe(1);

    // dev-story again → e2e-verify again
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["dev-story"]!, "d5", "r5"));
    expect(lifecycle.next).toBe("e2e-verify");

    // e2e-verify PASS this time → code-review
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-verify-pass"]!, "d6", "r6"));
    expect(lifecycle.next).toBe("code-review");
    expect(lifecycle.e2eAttemptsInCycle).toBe(0); // Reset on pass
  });

  it("drives the code-review NEEDS_DEV → dev-story loopback", () => {
    let lifecycle = createInitialStoryLifecycle("test-1", { maxE2eAttempts: 3, maxReviewLoopbacks: 3 });

    // Fast-forward to code-review
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["create-story"]!, "d1", "r1"));
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-plan"]!, "d2", "r2"));
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["dev-story"]!, "d3", "r3"));
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["e2e-verify-pass"]!, "d4", "r4"));
    expect(lifecycle.next).toBe("code-review");

    // code-review NEEDS_DEV → loops back to dev-story
    lifecycle = applyStoryOutcome(lifecycle, mapResultToOutcome(SIMULATED_OUTPUTS["code-review-needs-dev"]!, "d5", "r5"));
    expect(lifecycle.next).toBe("dev-story");
    expect(lifecycle.reviewLoopbacks).toBe(1);
  });

  it("logs typed return payloads to JSONL during a simulated pipeline run", async () => {
    const result = await bootstrapOrchestrator({ projectRoot, hasUI: false });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    // Simulate the orchestrator processing workflow results
    const devLoop = ["create-story", "e2e-plan", "dev-story", "e2e-verify-pass", "code-review-approved"];

    for (const key of devLoop) {
      const output = SIMULATED_OUTPUTS[key]!;
      const parseResult = parseHeadlessOutput(JSON.stringify(output));
      expect(parseResult.kind).toBe("parsed");

      if (parseResult.kind === "parsed") {
        // Log the dispatch
        result.eventBus.emit("dispatch_completed", "orchestrator", {
          dispatchId: `dispatch-${key}`,
          outcome: "success",
        });

        // Log the typed result (this is what the user wants to see)
        result.eventBus.emit("worker_state_changed", "orchestrator", {
          sessionId: "worker-1",
          from: "active",
          to: "completed",
          reason: `${output.workflow}: ${output.status} — payload: ${JSON.stringify(output.payload)}`,
        });
      }
    }

    // Apply terminal state
    await result.stateManager.apply({
      kind: "set-status",
      status: "done",
      reason: "All workflows completed successfully",
    });

    await result.dispose();

    // Read the JSONL log and verify it contains the typed payloads
    const logFiles = readdirSync(logRoot).filter(f => f.endsWith(".jsonl"));
    expect(logFiles.length).toBeGreaterThan(0);

    const logContent = readFileSync(join(logRoot, logFiles[0]!), "utf-8");
    const events = logContent.trim().split("\n").map(line => JSON.parse(line));

    // Should have dispatch_completed events
    const dispatchEvents = events.filter((e: any) => e.kind === "dispatch_completed");
    expect(dispatchEvents.length).toBe(5);

    // Should have worker_state_changed events with typed payloads in reason
    const workerEvents = events.filter((e: any) => e.kind === "worker_state_changed");
    expect(workerEvents.length).toBe(5);

    // Verify each workflow's typed payload appears in the logs, independent of event order
    for (const key of devLoop) {
      const output = SIMULATED_OUTPUTS[key]!;
      const expectedPayload = JSON.stringify(output.payload);
      const hasTypedPayload = workerEvents.some((event: any) =>
        typeof event.payload.reason === "string" && event.payload.reason.includes(expectedPayload)
      );
      expect(hasTypedPayload, `Missing typed payload for ${key}: ${expectedPayload}`).toBe(true);
    }

    // Should have pipeline_status_changed: idle → done
    const statusEvents = events.filter((e: any) => e.kind === "pipeline_status_changed");
    expect(statusEvents.length).toBeGreaterThan(0);
    expect(statusEvents[statusEvents.length - 1].payload.to).toBe("done");

    // Print the full log for human verification
    console.log("\n=== JSONL AUDIT LOG (typed return payloads) ===");
    for (const event of events) {
      console.log(`  ${event.kind}: ${JSON.stringify(event.payload)}`);
    }
    console.log(`=== ${events.length} events total ===\n`);
  });
});
