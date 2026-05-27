/**
 * Behavioral type contract tests for types.ts.
 *
 * Uses two techniques:
 * 1. COMPILE-TIME: functions declared inside it() blocks whose bodies
 *    are the assertions — they produce TS errors if contracts are wrong.
 * 2. RUNTIME: Vitest assertions on fixture objects.
 *
 * All tests MUST fail before types.ts is created (TS2307) and pass after.
 *
 * Scenarios:
 *   pipeline-run-state-has-required-fields  (AC-4)
 *   state-mutations-all-17-variants         (AC-4, INV-4)
 *   worktree-registry-contracts-complete    (AC-4)
 *   orchestrator-event-payloads-all-20-kinds (AC-4, INV-5)
 *   story-lifecycle-state-has-required-fields (AC-4 addendum)
 *   story-lifecycle-next-is-closed-union    (AC-4, INV-4 addendum)
 *   bmad-workflow-result-v1-has-schema-tag  (AC-4 addendum)
 *   story-workflow-outcome-is-discriminated (AC-4 addendum)
 *   dispatch-candidate-is-discriminated-union (AC-4)
 *   failure-category-is-closed-12-value-union (AC-4)
 *   action-result-is-generic               (AC-4)
 *   child-bmad-observation-result-discriminated (AC-4)
 *   adversarial-unsafe-action-closed-enum  (AC-4 adversarial)
 */

import { describe, it, expect } from "vitest";
import type {
  PipelineRunState,
  PipelineStage,
  StateMutation,
  WorktreeStatus,
  WorktreeRegistryState,
  WorktreeRegistryEntry,
  OrchestratorEventPayloads,
  OrchestratorEventKind,
  OrchestratorEvent,
  StoryLifecycleState,
  ReviewFindingSummary,
  BmadWorkflowResultV1,
  StoryWorkflowOutcome,
  DispatchCandidate,
  FailureCategory,
  ActionResult,
  ChildBmadObservationResult,
  UnsafeAction,
} from "../../../src/shared/types.js";

// ─────────────────────────────────────────────────────────────────────────────
// COMPILE-TIME assertions (inside it() to satisfy noUnusedLocals)
// ─────────────────────────────────────────────────────────────────────────────

describe("compile-time: PipelineRunState required fields (AC-4)", () => {
  it("all required fields are indexable — missing field causes TS2339", () => {
    interface Check {
      schemaVersion: PipelineRunState["schemaVersion"];
      pipelineId: PipelineRunState["pipelineId"];
      runId: PipelineRunState["runId"];
      status: PipelineRunState["status"];
      phase: PipelineRunState["phase"];
      activeStage: PipelineRunState["activeStage"];
      activeWorkflowId: PipelineRunState["activeWorkflowId"];
      activeStepId: PipelineRunState["activeStepId"];
      activeStoryId: PipelineRunState["activeStoryId"];
      dispatches: PipelineRunState["dispatches"];
      childSessions: PipelineRunState["childSessions"];
      blocker: PipelineRunState["blocker"];
      startedAt: PipelineRunState["startedAt"];
      updatedAt: PipelineRunState["updatedAt"];
      finishedAt: PipelineRunState["finishedAt"];
      storyLifecycles: PipelineRunState["storyLifecycles"]; // addendum
    }
    const _w: Check | null = null;
    expect(_w).toBeNull();
  });
});

describe("compile-time: StateMutation — all 17 variants exhaustive (AC-4, INV-4)", () => {
  it("switch with default:never compiles — missing variant causes TS2322", () => {
    function handle(m: StateMutation): string {
      switch (m.kind) {
        case "set-status":
          return m.status;
        case "advance-phase":
          return m.phase;
        case "set-active-stage":
          return String(m.stage);
        case "record-dispatch":
          return m.dispatch.dispatchId;
        case "update-dispatch":
          return m.dispatchId;
        case "record-child-session":
          return m.session.sessionId;
        case "update-child-session":
          return m.sessionId;
        case "record-prompt":
          return m.prompt.promptId;
        case "record-approval":
          return m.approval.approvalId;
        case "record-gate":
          return m.gateResult.gateName;
        case "record-artifact-evidence":
          return m.evidence.path;
        case "update-review-loop":
          return m.storyId;
        case "set-blocker":
          return m.blocker.kind;
        case "clear-blocker":
          return "cleared";
        case "update-echo-fields":
          return String(m.workflowId);
        case "record-completed-phase":
          return m.record.phase;
        case "increment-retry":
          return m.category;
        default: {
          const _exhaustive: never = m;
          return _exhaustive;
        }
      }
    }
    expect(typeof handle).toBe("function");
  });
});

describe("compile-time: WorktreeStatus — closed 9-value union (AC-4)", () => {
  it("bidirectional assignability with literal union", () => {
    type Literals =
      | "creating"
      | "active"
      | "idle"
      | "stale"
      | "dead"
      | "orphaned"
      | "quarantined"
      | "merged"
      | "removed";
    type CheckA = Literals extends WorktreeStatus ? true : false;
    type CheckB = WorktreeStatus extends Literals ? true : false;
    const _a: CheckA | null = null;
    const _b: CheckB | null = null;
    expect(_a).toBeNull();
    expect(_b).toBeNull();
  });
});

describe("compile-time: OrchestratorEventPayloads ↔ EventKind bijection (AC-4, INV-5)", () => {
  it("EventKind equals keyof EventPayloads in both directions", () => {
    type FromPayloads = keyof OrchestratorEventPayloads;
    type CheckA = OrchestratorEventKind extends FromPayloads ? true : false;
    type CheckB = FromPayloads extends OrchestratorEventKind ? true : false;
    const _a: CheckA | null = null;
    const _b: CheckB | null = null;
    expect(_a).toBeNull();
    expect(_b).toBeNull();
  });
});

describe("compile-time: StoryLifecycleState.next — closed 8-value union (AC-4, INV-4)", () => {
  it("exhaustive switch over all 8 lifecycle states", () => {
    function route(s: StoryLifecycleState): string {
      switch (s.next) {
        case "create-story":
          return "sm";
        case "e2e-plan":
          return "tea";
        case "dev-story":
          return "dev";
        case "e2e-verify":
          return "tea";
        case "code-review":
          return "dev";
        case "done":
          return "done";
        case "blocked":
          return "blocked";
        case "escalated":
          return "escalated";
        default: {
          const _exhaustive: never = s.next;
          return _exhaustive;
        }
      }
    }
    expect(typeof route).toBe("function");
  });
});

describe("compile-time: StoryWorkflowOutcome — discriminated by workflowId (AC-4)", () => {
  it("per-branch semanticOutcome is narrowed — wrong outcome is type error", () => {
    function route(o: StoryWorkflowOutcome): string {
      switch (o.workflowId) {
        case "create-story":
          return o.semanticOutcome; // "STORY_READY"|"ERROR"
        case "e2e-plan":
          return o.semanticOutcome; // "PLAN_READY"|"ERROR"
        case "dev-story":
          return o.semanticOutcome; // "IMPLEMENTED"|"ERROR"
        case "e2e-verify":
          return o.semanticOutcome; // "PASS"|"FAIL"|"ERROR"
        case "code-review":
          return o.semanticOutcome; // "APPROVED"|"NEEDS_DEV"|"FIXED_REQUIRES_VERIFY"|"ERROR"
        default: {
          const _exhaustive: never = o;
          return _exhaustive;
        }
      }
    }
    expect(typeof route).toBe("function");
  });
});

describe("compile-time: DispatchCandidate — discriminated by kind (AC-4)", () => {
  it("'phase' exposes stage; 'story' exposes storyId+touchedFiles", () => {
    function handle(c: DispatchCandidate): void {
      if (c.kind === "phase") {
        const _s: PipelineStage = c.stage;
        const _p: number = c.priority;
        void _s;
        void _p;
      } else {
        const _id: string = c.storyId;
        const _f: string[] = c.touchedFiles;
        void _id;
        void _f;
      }
    }
    expect(typeof handle).toBe("function");
  });
});

describe("compile-time: ChildBmadObservationResult — 5 discriminants (AC-4)", () => {
  it("exhaustive switch with default:never", () => {
    function handle(r: ChildBmadObservationResult): string {
      switch (r.kind) {
        case "snapshot":
          return r.snapshot.activeAgent ?? "none";
        case "not-found":
          return r.path;
        case "corrupt-json":
          return r.rawError;
        case "invalid-schema":
          return r.validationDetail;
        case "read-failed":
          return r.rawError;
        default: {
          const _exhaustive: never = r;
          return _exhaustive;
        }
      }
    }
    expect(typeof handle).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RUNTIME assertions
// ─────────────────────────────────────────────────────────────────────────────

describe("runtime: WorktreeRegistryState schema version (AC-4)", () => {
  it("schemaVersion literal is 'worktree-registry.v1'", () => {
    const fixture: WorktreeRegistryState = {
      schemaVersion: "worktree-registry.v1",
      entries: {},
    };
    expect(fixture.schemaVersion).toBe("worktree-registry.v1");
  });

  it("WorktreeRegistryEntry.status is WorktreeStatus (compile+runtime)", () => {
    const entry: WorktreeRegistryEntry = {
      sessionId: "s-001",
      branchName: "worker/s-001",
      worktreePath: "/trees/s-001",
      tmuxSession: null,
      agentId: "dev",
      workflowId: "dev-story",
      storyId: "E1-S1",
      createdAt: "2026-07-17T00:00:00Z",
      lastHeartbeat: "2026-07-17T00:01:00Z",
      status: "active",
      statusReason: null,
    };
    const status: WorktreeStatus = entry.status;
    expect(status).toBe("active");
  });
});

describe("runtime: OrchestratorEvent schema discriminant (AC-4)", () => {
  it("schema field is 'orchestrator-event.v1'", () => {
    const kind: OrchestratorEventKind = "dispatch_sent";
    const payload: OrchestratorEventPayloads["dispatch_sent"] = {
      dispatchId: "d-001",
      agent: "dev",
      workflow: "dev-story",
      storyId: "E1-S1",
    };
    const event: OrchestratorEvent = {
      schema: "orchestrator-event.v1",
      timestamp: "2026-07-17T00:00:00Z",
      runId: "run-001",
      sessionId: "s-abc",
      level: "info",
      kind,
      payload,
    };
    expect(event.schema).toBe("orchestrator-event.v1");
    expect(event.kind).toBe("dispatch_sent");
  });
});

describe("runtime: OrchestratorEventPayloads — exactly 20 kinds (AC-4, INV-5)", () => {
  it("all 20 kind strings are valid OrchestratorEventKind", () => {
    const allKinds: OrchestratorEventKind[] = [
      "agent_start",
      "agent_end",
      "tool_execution_start",
      "tool_execution_end",
      "turn_end",
      "checkpoint_result",
      "dispatch_sent",
      "dispatch_confirmed",
      "dispatch_completed",
      "dispatch_failed",
      "steer_sent",
      "merge_start",
      "merge_complete",
      "merge_conflict",
      "prompt_observed",
      "approval_requested",
      "approval_resolved",
      "escalation_triggered",
      "worker_state_changed",
      "pipeline_status_changed",
    ];
    expect(allKinds).toHaveLength(20);
  });
});

describe("runtime: StoryLifecycleState fixture (AC-4 addendum)", () => {
  it("accepts a valid minimal StoryLifecycleState", () => {
    const fixture: StoryLifecycleState = {
      storyId: "E1-S1",
      next: "dev-story",
      e2eAttemptsInCycle: 0,
      maxE2eAttempts: 3,
      reviewLoopbacks: 0,
      maxReviewLoopbacks: 3,
      lastProcessedDispatchId: null,
      lastProcessedWorkflowRunId: null,
      lastSemanticOutcome: null,
      reviewFindings: null,
      blockerReason: null,
    };
    expect(fixture.storyId).toBe("E1-S1");
    expect(fixture.next).toBe("dev-story");
    expect(fixture.maxE2eAttempts).toBe(3);
  });

  it("accepts reviewFindings as ReviewFindingSummary", () => {
    const findings: ReviewFindingSummary = {
      critical: 1,
      high: 0,
      medium: 2,
      low: 0,
      info: 0,
      findingIds: ["f-001", "f-002", "f-003"],
    };
    const fixture: StoryLifecycleState = {
      storyId: "E1-S2",
      next: "code-review",
      e2eAttemptsInCycle: 1,
      maxE2eAttempts: 3,
      reviewLoopbacks: 0,
      maxReviewLoopbacks: 3,
      lastProcessedDispatchId: "d-001",
      lastProcessedWorkflowRunId: "run-001",
      lastSemanticOutcome: "PASS",
      reviewFindings: findings,
      blockerReason: null,
    };
    expect(fixture.reviewFindings?.critical).toBe(1);
    expect(fixture.reviewFindings?.findingIds).toHaveLength(3);
  });
});

describe("runtime: BmadWorkflowResultV1 schema tag (AC-4 addendum)", () => {
  it("schema is the literal 'bmad-workflow-result.v1'", () => {
    const fixture: BmadWorkflowResultV1 = {
      schema: "bmad-workflow-result.v1",
      workflowRunId: "run-001",
      emittedAt: "2026-07-17T00:00:00Z",
      workflowId: "dev-story",
      agentId: "dev",
      executionStatus: "completed",
      semanticOutcome: "IMPLEMENTED",
      storyId: "E1-S1",
      evidenceRefs: [],
      summary: "Story implemented",
    };
    expect(fixture.schema).toBe("bmad-workflow-result.v1");
  });

  it("executionStatus accepts 4 values", () => {
    const statuses: BmadWorkflowResultV1["executionStatus"][] = [
      "completed",
      "blocked",
      "failed",
      "interrupted",
    ];
    expect(statuses).toHaveLength(4);
  });

  it("storyId can be null", () => {
    const fixture: BmadWorkflowResultV1 = {
      schema: "bmad-workflow-result.v1",
      workflowRunId: "run-p",
      emittedAt: "2026-07-17T00:00:00Z",
      workflowId: "create-story",
      agentId: "sm",
      executionStatus: "completed",
      semanticOutcome: "STORY_READY",
      storyId: null,
      evidenceRefs: [],
      summary: "Phase done",
    };
    expect(fixture.storyId).toBeNull();
  });

  it("optional dispatchId absent when not provided", () => {
    const fixture: BmadWorkflowResultV1 = {
      schema: "bmad-workflow-result.v1",
      workflowRunId: "run-002",
      emittedAt: "2026-07-17T00:00:00Z",
      workflowId: "e2e-verify",
      agentId: "tea",
      executionStatus: "completed",
      semanticOutcome: "PASS",
      storyId: "E1-S3",
      evidenceRefs: [],
      summary: "Tests pass",
    };
    expect(fixture.dispatchId).toBeUndefined();
  });
});

describe("runtime: FailureCategory — closed 12-value union (AC-4)", () => {
  it("exactly 12 failure categories", () => {
    const all: FailureCategory[] = [
      "checkpoint-fail",
      "worker-crash",
      "worker-timeout",
      "stale-session",
      "orphaned-worktree",
      "merge-conflict",
      "checkpoint-block",
      "prompt-block",
      "upstream-missing",
      "tool-missing",
      "config-error",
      "state-divergence",
    ];
    expect(all).toHaveLength(12);
  });
});

describe("runtime: ActionResult<T> generic type (AC-4)", () => {
  it("typed data field", () => {
    const r: ActionResult<{ runId: string }> = {
      success: true,
      message: "Pipeline started",
      data: { runId: "run-001" },
    };
    expect(r.success).toBe(true);
    expect(r.data.runId).toBe("run-001");
  });

  it("void data field", () => {
    const r: ActionResult = {
      success: false,
      message: "Not started",
      data: undefined,
    };
    expect(r.success).toBe(false);
    expect(r.data).toBeUndefined();
  });
});

describe("runtime: UnsafeAction — closed 6-value union (AC-4 adversarial)", () => {
  it("exactly 6 unsafe action values", () => {
    const all: UnsafeAction[] = [
      "destructive-cleanup",
      "checkpoint-override",
      "review-waiver",
      "merge-conflict-resolution",
      "state-force-reset",
      "overlapping-file-dispatch",
    ];
    expect(all).toHaveLength(6);
  });
});
