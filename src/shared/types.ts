/**
 * All package-owned orchestrator domain types.
 *
 * This file is the single source of truth for cross-module contracts within
 * pi-orchestrator. No type in this file is imported from pi-bmad root
 * `src/types.ts` — all contracts are owned and evolved independently.
 *
 * Child BMAD state shapes are structurally observed (duck-typed) rather than
 * imported, to avoid coupling to pi-bmad internals.
 */

/* eslint-disable max-lines -- Centralized cross-module type contract file. */

// ═══════════════════════════════════════════════════════════════════════════
// Phase & Pipeline Status
// ═══════════════════════════════════════════════════════════════════════════

/** The current phase of the BMAD Method lifecycle. */
export type Phase = "analysis" | "planning" | "architecture" | "implementation";

/** Pipeline-level lifecycle status for a supervised BMAD run. */
export type PipelineStatus =
  | "idle"
  | "running"
  | "blocked"
  | "needs-human"
  | "done"
  | "failed"
  | "aborted";

/** High-level stage currently supervised by the pipeline orchestrator. */
export type PipelineStage =
  | "analysis"
  | "planning"
  | "architecture"
  | "sprint-planning"
  | "story-creation"
  | "development"
  | "review"
  | "done";

// ═══════════════════════════════════════════════════════════════════════════
// Story Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

/** Canonical story statuses tracked by review-loop and sprint projections. */
export type StoryStatusValue =
  | "planned"
  | "drafted"
  | "approved"
  | "ready-for-dev"
  | "in-progress"
  | "review"
  | "ready-for-review"
  | "implemented"
  | "done"
  | "blocked";

/**
 * Deterministic story lifecycle FSM state per the story-fsm-addendum.
 *
 * The `next` field identifies which workflow the story needs next. Routing
 * never depends on tmux pane prose, LLM interpretation, or ad-hoc branches.
 *
 * @see story-fsm-addendum.md Section 3
 */
export interface StoryLifecycleState {
  /** Story identifier. */
  storyId: string;
  /**
   * The next workflow the story requires, or a terminal/escalated disposition.
   *
   * Valid values form a closed 8-value union enforced by the FSM reducer.
   */
  next:
    | "create-story"
    | "e2e-plan"
    | "dev-story"
    | "e2e-verify"
    | "code-review"
    | "done"
    | "blocked"
    | "escalated";

  /** Number of e2e-verify attempts in the current cycle (resets on code-review loopback). */
  e2eAttemptsInCycle: number;
  /** Maximum total e2e verification attempts per cycle. Default: 3. */
  maxE2eAttempts: number;

  /** Number of code-review loopback transitions consumed. */
  reviewLoopbacks: number;
  /** Maximum allowed loopback transitions. Default: 3. */
  maxReviewLoopbacks: number;

  /** Last dispatch ID processed for idempotency. */
  lastProcessedDispatchId: string | null;
  /** Last workflow run ID processed for idempotency. */
  lastProcessedWorkflowRunId: string | null;
  /** Last semantic outcome string from the most recent workflow result. */
  lastSemanticOutcome: string | null;
  /** Review findings from the most recent code-review, or null. */
  reviewFindings: ReviewFindingSummary | null;
  /** Human-readable reason when story is blocked. */
  blockerReason: string | null;
}

/** Counts and identifiers for review findings. */
export interface ReviewFindingSummary {
  /** Critical finding count. */
  critical: number;
  /** High finding count. */
  high: number;
  /** Medium finding count. */
  medium: number;
  /** Low finding count. */
  low: number;
  /** Informational finding count. */
  info: number;
  /** Finding IDs included in the summary. */
  findingIds: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Pi-BMAD Workflow Result Contract (emitted by Pi-BMAD child workers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structured terminal workflow result emitted by Pi-BMAD.
 * Pi-BMAD emits facts only — it does not decide retryability or escalation.
 *
 * @see story-fsm-addendum.md Section 6
 */
export interface BmadWorkflowResultV1 {
  /** Schema version tag — always the literal `"bmad-workflow-result.v1"`. */
  schema: "bmad-workflow-result.v1";
  /** Unique workflow run identifier. */
  workflowRunId: string;
  /** ISO-8601 timestamp when the result was emitted. */
  emittedAt: string;

  /** BMAD workflow ID that was executed. */
  workflowId: string;
  /** BMAD agent ID that ran the workflow. */
  agentId: string;
  /** Execution status of the workflow run. */
  executionStatus: "completed" | "blocked" | "failed" | "interrupted";
  /** Semantic outcome string — validated by StoryWorkflowOutcome. */
  semanticOutcome: string;

  /** Story ID for implementation-scoped workflows, or null for phase work. */
  storyId: string | null;
  /** Dispatch ID — required for automatic orchestrator routing. */
  dispatchId?: string;
  /** Orchestrator run ID for correlation. */
  orchestratorRunId?: string;

  /** Paths to evidence files produced during the run. */
  evidenceRefs: string[];
  /** Human-readable summary of the workflow outcome. */
  summary: string;
  /** Optional structured diagnostic data. */
  diagnostics?: Record<string, unknown>;
}

/**
 * Validated `workflowId + semanticOutcome` combinations.
 * Unknown combinations are deterministic validation failures.
 *
 * @see story-fsm-addendum.md Section 7
 */
export type StoryWorkflowOutcome =
  | { workflowId: "create-story"; semanticOutcome: "STORY_READY" | "ERROR" }
  | { workflowId: "e2e-plan"; semanticOutcome: "PLAN_READY" | "ERROR" }
  | { workflowId: "dev-story"; semanticOutcome: "IMPLEMENTED" | "ERROR" }
  | { workflowId: "e2e-verify"; semanticOutcome: "PASS" | "FAIL" | "ERROR" }
  | {
      workflowId: "code-review";
      semanticOutcome: "APPROVED" | "NEEDS_DEV" | "FIXED_REQUIRES_VERIFY" | "ERROR";
    };

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Run State
// ═══════════════════════════════════════════════════════════════════════════

/** Durable state for one supervised end-to-end BMAD pipeline run. */
export interface PipelineRunState {
  /** Schema version for persisted pipeline state. */
  schemaVersion: "pipeline-run-state.v1";
  /** Stable pipeline identifier. */
  pipelineId: string;
  /** Stable run identifier for this pipeline execution. */
  runId: string;
  /** Current pipeline lifecycle status. */
  status: PipelineStatus;
  /** Current BMAD lifecycle phase. */
  phase: Phase;
  /** Active pipeline stage, or null before dispatch starts. */
  activeStage: PipelineStage | null;
  /** Active child workflow ID, when a workflow is running. */
  activeWorkflowId: string | null;
  /** Active child workflow step ID, when a workflow is running. */
  activeStepId: string | null;
  /** Active implementation story ID, when story-scoped work is running. */
  activeStoryId: string | null;
  /** Workflow dispatch audit records. */
  dispatches: WorkflowDispatchRecord[];
  /** Child session lifecycle records. */
  childSessions: ChildSessionRecord[];
  /** Prompt decisions observed during the run. */
  prompts: PromptRecord[];
  /** Human approval decisions recorded during the run. */
  approvals: ApprovalRecord[];
  /** Gate results evaluated during the run. */
  gateResults: GateResultRecord[];
  /** Artifact evidence gathered during gate checks. */
  artifactEvidence: ArtifactEvidenceRecord[];
  /** Per-story lifecycle state keyed by story ID. */
  storyLifecycles: Record<string, StoryLifecycleState>;
  /** Retry counters by category. */
  retryCounts: Record<string, number>;
  /** Bounded append-only event log. */
  events: PipelineEvent[];
  /** Current unresolved blocker, if any. */
  blocker: BlockerRecord | null;
  /** Pipeline start timestamp. */
  startedAt: string;
  /** Last mutation timestamp. */
  updatedAt: string;
  /** Pipeline finish timestamp, when terminal. */
  finishedAt: string | null;
  /** Completed phases with gate evidence. */
  completedPhases: CompletedPhaseRecord[];
}

// ═══════════════════════════════════════════════════════════════════════════
// State Mutations — 17 discriminated variants
// ═══════════════════════════════════════════════════════════════════════════

/** Mutation that changes pipeline lifecycle status. */
export interface SetStatusMutation {
  /** Mutation discriminator. */
  kind: "set-status";
  /** New pipeline status. */
  status: PipelineStatus;
  /** Human-readable reason for the status change. */
  reason: string;
}

/** Mutation that advances the active BMAD phase and pipeline stage. */
export interface AdvancePhaseMutation {
  /** Mutation discriminator. */
  kind: "advance-phase";
  /** New active BMAD phase. */
  phase: Phase;
  /** New active pipeline stage. */
  stage: PipelineStage;
}

/** Mutation that sets or clears the active pipeline stage. */
export interface SetActiveStageMutation {
  /** Mutation discriminator. */
  kind: "set-active-stage";
  /** Active stage, or null when no stage is active. */
  stage: PipelineStage | null;
}

/** Mutation that appends a workflow dispatch audit record. */
export interface RecordDispatchMutation {
  /** Mutation discriminator. */
  kind: "record-dispatch";
  /** Dispatch record to append. */
  dispatch: WorkflowDispatchRecord;
}

/** Mutation that updates an existing workflow dispatch status. */
export interface UpdateDispatchMutation {
  /** Mutation discriminator. */
  kind: "update-dispatch";
  /** Dispatch ID to update. */
  dispatchId: string;
  /** New dispatch status. */
  status: WorkflowDispatchRecord["status"];
  /** Optional completion or failure evidence. */
  evidence?: string;
}

/** Mutation that appends a child session lifecycle record. */
export interface RecordChildSessionMutation {
  /** Mutation discriminator. */
  kind: "record-child-session";
  /** Child session record to append. */
  session: ChildSessionRecord;
}

/** Mutation that updates an existing child session status. */
export interface UpdateChildSessionMutation {
  /** Mutation discriminator. */
  kind: "update-child-session";
  /** Child session ID to update. */
  sessionId: string;
  /** New child session status. */
  status: ChildSessionRecord["status"];
}

/** Mutation that records a prompt decision. */
export interface RecordPromptMutation {
  /** Mutation discriminator. */
  kind: "record-prompt";
  /** Prompt decision record to append. */
  prompt: PromptRecord;
}

/** Mutation that records a human approval decision. */
export interface RecordApprovalMutation {
  /** Mutation discriminator. */
  kind: "record-approval";
  /** Approval record to append. */
  approval: ApprovalRecord;
}

/** Mutation that records a gate evaluation result. */
export interface RecordGateMutation {
  /** Mutation discriminator. */
  kind: "record-gate";
  /** Gate result to append. */
  gateResult: GateResultRecord;
}

/** Mutation that records artifact evidence gathered for a gate. */
export interface RecordArtifactEvidenceMutation {
  /** Mutation discriminator. */
  kind: "record-artifact-evidence";
  /** Artifact evidence record to append. */
  evidence: ArtifactEvidenceRecord;
}

/** Mutation that updates per-story review-loop state. */
export interface UpdateReviewLoopMutation {
  /** Mutation discriminator. */
  kind: "update-review-loop";
  /** Story ID whose review-loop state changed. */
  storyId: string;
  /** New review-loop state for the story. */
  loopState: StoryReviewLoopState;
}

/** Mutation that sets the active blocker. */
export interface SetBlockerMutation {
  /** Mutation discriminator. */
  kind: "set-blocker";
  /** Blocker record to set as active. */
  blocker: BlockerRecord;
}

/** Mutation that clears the active blocker. */
export interface ClearBlockerMutation {
  /** Mutation discriminator. */
  kind: "clear-blocker";
}

/** Mutation that synchronizes legacy echo fields for display and resume. */
export interface UpdateEchoFieldsMutation {
  /** Mutation discriminator. */
  kind: "update-echo-fields";
  /** Active workflow ID, or null when idle. */
  workflowId: string | null;
  /** Active step ID, or null when idle. */
  stepId: string | null;
  /** Active story ID, or null when not story-scoped. */
  storyId: string | null;
}

/** Mutation that records completion evidence for a pipeline phase. */
export interface RecordCompletedPhaseMutation {
  /** Mutation discriminator. */
  kind: "record-completed-phase";
  /** Completed phase record to append. */
  record: CompletedPhaseRecord;
}

/** Mutation that increments a retry counter category. */
export interface IncrementRetryMutation {
  /** Mutation discriminator. */
  kind: "increment-retry";
  /** Retry counter category to increment. */
  category: string;
}

/** A typed state mutation accepted by the pipeline state manager. */
export type StateMutation =
  | SetStatusMutation
  | AdvancePhaseMutation
  | SetActiveStageMutation
  | RecordDispatchMutation
  | UpdateDispatchMutation
  | RecordChildSessionMutation
  | UpdateChildSessionMutation
  | RecordPromptMutation
  | RecordApprovalMutation
  | RecordGateMutation
  | RecordArtifactEvidenceMutation
  | UpdateReviewLoopMutation
  | SetBlockerMutation
  | ClearBlockerMutation
  | UpdateEchoFieldsMutation
  | RecordCompletedPhaseMutation
  | IncrementRetryMutation;

// ═══════════════════════════════════════════════════════════════════════════
// Child Session Records
// ═══════════════════════════════════════════════════════════════════════════

/** Record describing a headed child Pi session. */
export interface ChildSessionRecord {
  /** Unique child session ID. */
  sessionId: string;
  /** Tmux session name. */
  tmuxSessionName: string;
  /** Working directory for the child session. */
  workdir: string;
  /** Full launch command used for the session. */
  launchCommand: string;
  /** Target BMAD agent ID. */
  targetAgent: string;
  /** Target BMAD workflow ID. */
  targetWorkflow: string;
  /** Child BMAD state file path. */
  childStatePath: string;
  /** Child session lifecycle status. */
  status: "creating" | "launching" | "active" | "idle" | "stale" | "dead" | "killed";
  /** Last observation timestamp. */
  lastObservedAt: string;
  /** Session creation timestamp. */
  createdAt: string;
  /** Session termination timestamp, when known. */
  terminatedAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Workflow Dispatch Records
// ═══════════════════════════════════════════════════════════════════════════

/** Audit record for a workflow dispatched to a child session. */
export interface WorkflowDispatchRecord {
  /** Unique dispatch ID. */
  dispatchId: string;
  /** Target child session ID. */
  sessionId: string;
  /** BMAD phase for this dispatch. */
  phase: Phase;
  /** Pipeline stage for this dispatch. */
  stage: PipelineStage;
  /** BMAD agent ID to activate. */
  agent: string;
  /** BMAD workflow ID to start. */
  workflowId: string;
  /** Story ID for implementation-stage dispatches. */
  storyId: string | null;
  /** Prompt IDs sent as part of this dispatch. */
  promptIds: string[];
  /** Dispatch lifecycle status. */
  status: "sent" | "confirmed" | "completed" | "failed" | "abandoned";
  /** Dispatch timestamp. */
  dispatchedAt: string;
  /** Resolution timestamp, when terminal. */
  resolvedAt: string | null;
  /** Completion evidence summary or path. */
  completionEvidence: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Prompt / Approval / Gate Records
// ═══════════════════════════════════════════════════════════════════════════

/** Audit record for a prompt observed in a child pane. */
export interface PromptRecord {
  /** Unique prompt ID. */
  promptId: string;
  /** Prompt text or sanitized hash. */
  textOrHash: string;
  /** Answer sent, or null when escalated. */
  answer: string | null;
  /** Actor that decided the prompt answer. */
  actor: "auto-policy" | "human";
  /** Policy rule ID used by automation. */
  policyRuleId: string | null;
  /** Target tmux session name. */
  sessionName: string;
  /** Active workflow when the prompt appeared. */
  workflowId: string | null;
  /** Pane capture evidence path. */
  paneCaptureRef: string | null;
  /** Prompt observation timestamp. */
  timestamp: string;
}

/** Audit record for an explicit human approval decision. */
export interface ApprovalRecord {
  /** Unique approval ID. */
  approvalId: string;
  /** Subject that was approved or denied. */
  subject: string;
  /** Approval decision. */
  decision: "approved" | "denied";
  /** Actor who made the decision. */
  actor: string;
  /** Decision timestamp. */
  timestamp: string;
}

/** Gate boundary names evaluated by the orchestrator. */
export type GateBoundary =
  | "analysis-to-planning"
  | "planning-to-architecture"
  | "architecture-to-implementation"
  | "sprint-to-story-creation"
  | "story-to-dev"
  | "dev-to-review"
  | "review-to-done"
  | "pipeline-complete";

/** Evidence source category for an orchestrator gate check. */
export type GateEvidenceSource =
  | "child-observation"
  | "corroborative-verification"
  | "orchestrator-record"
  | "independent";

/** One atomic check within a gate result. */
export interface GateCheck {
  /** Gate check name, prefixed with gate:. */
  name: string;
  /** Whether this check passed. */
  pass: boolean;
  /** Human-readable detail for this check. */
  detail: string;
  /** Source category for this check's evidence. */
  evidenceSource: GateEvidenceSource;
}

/** Recorded result of evaluating a gate boundary. */
export interface GateResultRecord {
  /** Gate boundary that was evaluated. */
  gateName: GateBoundary;
  /** Gate evaluation status. */
  status: "pass" | "fail" | "blocked" | "skipped";
  /** Human-readable gate result reason. */
  reason: string;
  /** Checks evaluated for this gate. */
  checks: GateCheck[];
  /** Gate evaluation timestamp. */
  evaluatedAt: string;
  /** Associated dispatch, phase, or story ID. */
  contextId: string | null;
}

/** Evidence gathered about an artifact during gate evaluation. */
export interface ArtifactEvidenceRecord {
  /** Artifact path. */
  path: string;
  /** Whether the child state registered the artifact. */
  registered: boolean;
  /** Whether the artifact exists on disk. */
  existsOnDisk: boolean;
  /** Whether the artifact file is non-empty. */
  nonEmpty: boolean;
  /** Artifact registry freshness status. */
  registryStatus: "current" | "stale" | "missing";
  /** Required semantic sections found in the file. */
  sectionsPresent: string[];
  /** Required semantic sections missing from the file. */
  sectionsMissing: string[];
  /** File modification time, when available. */
  mtime: string | null;
  /** Evidence check timestamp. */
  checkedAt: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Review Loop State
// ═══════════════════════════════════════════════════════════════════════════

/** Per-story review-loop tracking state. */
export interface StoryReviewLoopState {
  /** Story identifier. */
  storyId: string;
  /** Current story status. */
  status: StoryStatusValue;
  /** Number of review loop-backs. */
  loopCount: number;
  /** Summary of the latest review findings. */
  lastReviewFindings: ReviewFindingSummary | null;
  /** Timestamp of the latest review. */
  lastReviewTimestamp: string | null;
  /** Whether this story has reached escalation threshold. */
  escalated: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blocker Records
// ═══════════════════════════════════════════════════════════════════════════

/** Current blocker that prevents pipeline progress. */
export interface BlockerRecord {
  /** Blocker classification. */
  kind:
    | "prompt"
    | "stuck"
    | "crash"
    | "gate-fail"
    | "state-drift"
    | "retry-exhausted"
    | "review-escalation"
    | "git-failure"
    | "validation-failure";
  /** Human-readable blocker reason. */
  reason: string;
  /** Affected child session ID. */
  sessionId: string | null;
  /** Affected pipeline stage. */
  stage: PipelineStage | null;
  /** Evidence paths for the blocker. */
  evidenceRefs: string[];
  /** Blocker detection timestamp. */
  detectedAt: string;
  /** Blocker resolution timestamp, when resolved. */
  resolvedAt: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Completed Phase Records
// ═══════════════════════════════════════════════════════════════════════════

/** Completed phase evidence record. */
export interface CompletedPhaseRecord {
  /** Completed BMAD phase. */
  phase: Phase;
  /** Completed pipeline stage. */
  stage: PipelineStage;
  /** Workflow ID completed for the phase. */
  workflowId: string;
  /** Dispatch ID that produced this phase. */
  dispatchId: string;
  /** Gate result that allowed completion. */
  gateResult: GateResultRecord;
  /** Artifacts associated with the phase. */
  artifacts: string[];
  /** Phase start timestamp. */
  startedAt: string;
  /** Phase completion timestamp. */
  completedAt: string;
  /** Phase duration in milliseconds. */
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Events
// ═══════════════════════════════════════════════════════════════════════════

/** Kinds of events appended to the pipeline event log. */
export type PipelineEventKind =
  | "pipeline:started"
  | "pipeline:completed"
  | "pipeline:failed"
  | "pipeline:aborted"
  | "workflow:started"
  | "workflow:completed"
  | "workflow:failed"
  | "step:advanced"
  | "gate:passed"
  | "gate:failed"
  | "prompt:detected"
  | "prompt:answered"
  | "step:blocked"
  | "review:loopback"
  | "agent:switched"
  | "child:created"
  | "child:stale"
  | "child:killed"
  | "recovery:started"
  | "recovery:completed";

/** Append-only event emitted by the pipeline orchestrator. */
export interface PipelineEvent {
  /** Monotonic event sequence number. */
  sequence: number;
  /** Event timestamp. */
  timestamp: string;
  /** Pipeline ID associated with the event. */
  pipelineId: string;
  /** Run ID associated with the event. */
  runId: string;
  /** Event kind. */
  kind: PipelineEventKind;
  /** Event severity. */
  severity: "info" | "warn" | "error";
  /** Human-readable event message. */
  message: string;
  /** Associated phase ID, when relevant. */
  phaseId: string | null;
  /** Associated workflow ID, when relevant. */
  workflowId: string | null;
  /** Associated step ID, when relevant. */
  stepId: string | null;
  /** Associated story ID, when relevant. */
  storyId: string | null;
  /** Associated child session ID, when relevant. */
  sessionId: string | null;
  /** Evidence path associated with the event. */
  evidenceRef: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator Events (JSONL envelope — 20 kinds)
// ═══════════════════════════════════════════════════════════════════════════

/** Typed payload map — matches PRD/ADR-008 orchestrator-event.v1 kinds exactly. */
export interface OrchestratorEventPayloads {
  /** Agent activation event. */
  agent_start: { agentId?: string; workflowId?: string };
  /** Agent deactivation event. */
  agent_end: { exitCode: number; durationMs?: number };
  /** Tool call initiation. */
  tool_execution_start: { toolCallId: string; toolName: string; args?: unknown };
  /** Tool call completion. */
  tool_execution_end: { toolCallId: string; toolName: string; isError: boolean };
  /** Conversation turn boundary. */
  turn_end: { turnIndex: number };
  /** Checkpoint evaluation outcome. */
  checkpoint_result: { checkpointName: string; passed: boolean; reason: string };
  /** Workflow dispatch sent to a child worker. */
  dispatch_sent: { dispatchId: string; agent: string; workflow: string; storyId: string | null };
  /** Workflow dispatch confirmed by child session. */
  dispatch_confirmed: { dispatchId: string; sessionId: string };
  /** Workflow dispatch completed by child worker. */
  dispatch_completed: { dispatchId: string; outcome: "success" | "failure" };
  /** Workflow dispatch failed in child worker. */
  dispatch_failed: { dispatchId: string; category: FailureCategory; reason: string };
  /** Diagnostic steer message sent to a worker. */
  steer_sent: { messageRef: string; attempt: number };
  /** Git merge initiated. */
  merge_start: { branch: string; into: string };
  /** Git merge completed successfully. */
  merge_complete: { branch: string; mergedFiles: string[] };
  /** Git merge conflict detected. */
  merge_conflict: { branch: string; conflictFiles: string[] };
  /** Interactive prompt observed in child pane. */
  prompt_observed: { promptTextRef: string };
  /** Human approval requested for an unsafe action. */
  approval_requested: { subject: string; context: string };
  /** Human approval resolved. */
  approval_resolved: { subject: string; approved: boolean };
  /** Failure escalated to human operator. */
  escalation_triggered: { category: string; reason: string; evidenceRefs: string[] };
  /** Worker lifecycle state transition. */
  worker_state_changed: { sessionId: string; from: string; to: string; reason?: string };
  /** Pipeline-level status transition. */
  pipeline_status_changed: { from: PipelineStatus; to: PipelineStatus };
}

/** Discriminated event kind — `keyof OrchestratorEventPayloads`. */
export type OrchestratorEventKind = keyof OrchestratorEventPayloads;

/**
 * External JSONL event envelope emitted by the orchestrator for audit logs
 * and headless consumers. Distinct from PipelineEvent (bounded in-memory log).
 *
 * Every event carries the schema version tag for forward compatibility.
 * Consumers MUST ignore unknown kind values without crashing.
 *
 * @see ADR-008 for the two-layer event architecture.
 */
/**
 * Typed event envelope linking kind to its specific payload at compile time.
 * Generic parameter K ensures callers cannot mismatch kind and payload.
 */
export interface OrchestratorEventOf<K extends OrchestratorEventKind = OrchestratorEventKind> {
  /** Schema version tag — always "orchestrator-event.v1". */
  schema: "orchestrator-event.v1";
  /** ISO-8601 event timestamp. */
  timestamp: string;
  /** Pipeline run ID this event belongs to. */
  runId: string;
  /** Child session ID or "orchestrator" for parent-originated events. */
  sessionId: string;
  /** Event severity level. */
  level: "info" | "warn" | "error" | "debug";
  /** Discriminated event kind. */
  kind: K;
  /** Typed payload enforced by the kind parameter. */
  payload: OrchestratorEventPayloads[K];
}

/**
 * External JSONL event envelope emitted by the orchestrator for audit logs
 * and headless consumers. Distinct from PipelineEvent (bounded in-memory log).
 *
 * Every event carries the schema version tag for forward compatibility.
 * Consumers MUST ignore unknown kind values without crashing.
 *
 * When the specific kind is unknown (e.g., deserialized from JSONL), use this
 * unparameterized alias. For typed construction, use OrchestratorEventOf<K>.
 *
 * @see ADR-008 for the two-layer event architecture.
 */
export type OrchestratorEvent = OrchestratorEventOf;

// ═══════════════════════════════════════════════════════════════════════════
// Worktree Registry
// ═══════════════════════════════════════════════════════════════════════════

/** Lifecycle status of a managed worktree in the orchestrator registry. */
export type WorktreeStatus =
  | "creating"
  | "active"
  | "idle"
  | "stale"
  | "dead"
  | "orphaned"
  | "quarantined"
  | "merged"
  | "removed";

/** A single entry in the worktree registry tracking one managed worktree. */
export interface WorktreeRegistryEntry {
  /** Unique session identifier — used as the registry key. */
  sessionId: string;
  /** Git branch name (worker/<sessionId> convention). */
  branchName: string;
  /** Absolute path to the git worktree directory. */
  worktreePath: string;
  /** Tmux session name, or null for headless/spawn transport. */
  tmuxSession: string | null;
  /** BMAD agent ID assigned to this worker. */
  agentId: string;
  /** BMAD workflow ID being executed by this worker. */
  workflowId: string;
  /** Story ID for implementation-scoped dispatches, or null for phase work. */
  storyId: string | null;
  /** ISO-8601 timestamp when the worktree was created. */
  createdAt: string;
  /** ISO-8601 timestamp of the last heartbeat or observation. */
  lastHeartbeat: string;
  /** Current lifecycle status of this worktree. */
  status: WorktreeStatus;
  /** Human-readable reason for the current status, or null. */
  statusReason: string | null;
}

/** Central worktree registry state persisted to worktree-registry.json. */
export interface WorktreeRegistryState {
  /** Schema version tag — always "worktree-registry.v1". */
  schemaVersion: "worktree-registry.v1";
  /** Map of sessionId to registry entry. */
  entries: Record<string, WorktreeRegistryEntry>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Failure Taxonomy & Triage
// ═══════════════════════════════════════════════════════════════════════════

/** Source that detected or produced the failure evidence. */
export type FailureSource =
  | "checkpoint"
  | "process-exit"
  | "heartbeat"
  | "reconciliation"
  | "merge"
  | "gate"
  | "startup"
  | "config"
  | "prompt";

/**
 * Structured evidence gathered by the caller before triage classification.
 * Fields are optional because different failure sources populate different
 * subsets. The `source` field is always required.
 */
export interface FailureEvidence {
  /** Child session that experienced the failure. */
  sessionId: string;
  /** ISO-8601 timestamp when the failure was detected. */
  timestamp: string;
  /** Detection source — determines which fields are relevant. */
  source: FailureSource;

  // ── Checkpoint fields ──
  /** Checkpoint name that failed or blocked. */
  checkpointName?: string;
  /** Human-readable reason for checkpoint failure. */
  checkpointReason?: string;
  /** Whether the checkpoint evaluation passed. */
  checkpointPass?: boolean;
  /** Whether the checkpoint was blocked (gate refused) vs simply failed. */
  checkpointBlocked?: boolean;
  /** Workflow step ID where the failure occurred. */
  stepId?: string;

  // ── Process fields ──
  /** Exit code of the crashed worker process. */
  processExitCode?: number;
  /** Signal that terminated the worker process. */
  processSignal?: string;

  // ── Heartbeat / staleness fields ──
  /** Milliseconds since last heartbeat. */
  lastHeartbeatMs?: number;
  /** Whether the worker process is still alive. */
  processAlive?: boolean;

  // ── Worktree / reconciliation fields ──
  /** Whether the worktree directory exists on disk. */
  worktreeExists?: boolean;
  /** Whether the worker branch exists in git. */
  branchExists?: boolean;

  // ── Merge fields ──
  /** File paths with merge conflicts. */
  conflictFiles?: string[];

  // ── Gate / dependency fields ──
  /** Artifact paths missing for gate evaluation. */
  missingArtifacts?: string[];

  // ── Startup / tool fields ──
  /** Tool names that failed availability check. */
  missingTools?: string[];

  // ── Config fields ──
  /** Config field that is invalid. */
  configField?: string;
  /** Config validation error message. */
  configError?: string;

  // ── State divergence fields ──
  /** Detail describing the state divergence. */
  divergenceDetail?: string;

  // ── Evidence references ──
  /** Paths to evidence files or log entries. */
  evidenceRefs?: string[];

  // ── Generic ──
  /** Raw error message for unstructured failures. */
  rawError?: string;
}

/**
 * Closed failure taxonomy for the orchestrator triage system.
 * Every observed failure MUST classify into exactly one category.
 */
export type FailureCategory =
  | "checkpoint-fail"
  | "worker-crash"
  | "worker-timeout"
  | "stale-session"
  | "orphaned-worktree"
  | "merge-conflict"
  | "checkpoint-block"
  | "prompt-block"
  | "upstream-missing"
  | "tool-missing"
  | "config-error"
  | "state-divergence";

// ═══════════════════════════════════════════════════════════════════════════
// Scheduling & Dispatch
// ═══════════════════════════════════════════════════════════════════════════

/** Dispatch candidates: either phase work or story work. */
export type DispatchCandidate =
  | {
      kind: "phase";
      stage: PipelineStage;
      agent: string;
      workflow: string;
      dispatchPrompt: string;
      priority: number;
    }
  | {
      kind: "story";
      storyId: string;
      agent: string;
      workflow: string;
      dispatchPrompt: string;
      priority: number;
      touchedFiles: string[];
    };

// ═══════════════════════════════════════════════════════════════════════════
// Authorization & Unsafe Actions
// ═══════════════════════════════════════════════════════════════════════════

/** Actions requiring explicit human authorization before proceeding. */
export type UnsafeAction =
  | "destructive-cleanup"
  | "checkpoint-override"
  | "review-waiver"
  | "merge-conflict-resolution"
  | "state-force-reset"
  | "overlapping-file-dispatch";

// ═══════════════════════════════════════════════════════════════════════════
// Action Results (Generic)
// ═══════════════════════════════════════════════════════════════════════════

/** Typed result returned by OrchestratorActions methods. */
export interface ActionResult<T = void> {
  /** Whether the action succeeded. */
  success: boolean;
  /** Human-readable message describing the outcome. */
  message: string;
  /** Typed data payload — generic parameter. */
  data: T;
}

// ═══════════════════════════════════════════════════════════════════════════
// Child BMAD Observation (structural — not imported from pi-bmad)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structurally observed child BMAD state. The orchestrator duck-types this
 * from the child's state file — it does not import BmadState from pi-bmad.
 * Unknown extra fields are gracefully ignored.
 */
export interface ChildBmadObservation {
  /** Active agent ID observed in child state. */
  activeAgent: string | null;
  /** Active workflow ID observed in child state. */
  activeWorkflow: string | null;
  /** Active step ID observed in child state. */
  activeStep: string | null;
  /** BMAD lifecycle phase observed in child state. */
  phase: string | null;
  /** Step IDs completed in the child workflow run. */
  completedSteps: string[];
  /** Checkpoint IDs that passed in the child session. */
  completedCheckpoints: string[];
  /** Artifact paths registered in the child state. */
  artifactPaths: string[];
  /** Last update timestamp from the child state file. */
  lastUpdated: string | null;
}

/** Discriminated result of reading and validating child BMAD state. */
export type ChildBmadObservationResult =
  | { kind: "snapshot"; snapshot: ChildBmadObservation }
  | { kind: "not-found"; path: string }
  | { kind: "corrupt-json"; path: string; rawError: string }
  | { kind: "invalid-schema"; path: string; validationDetail: string }
  | { kind: "read-failed"; path: string; rawError: string };

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Result
// ═══════════════════════════════════════════════════════════════════════════

/** Terminal result of a completed, failed, or aborted pipeline run. */
export interface PipelineResult {
  /** Terminal pipeline status. */
  status: "done" | "failed" | "aborted";
  /** Stable run identifier. */
  runId: string;
  /** Process exit code: 0 = success, 1 = failure, 2 = aborted, 3 = system-failure. */
  exitCode: 0 | 1 | 2 | 3; // eslint-disable-line @typescript-eslint/no-magic-numbers -- exit code enum
  /** Human-readable summary message. */
  message: string;
  /** Evidence file paths gathered during the run. */
  evidenceRefs: string[];
  /** ISO-8601 timestamp when the result was produced. */
  finishedAt: string;
  /** Run duration in milliseconds. */
  durationMs: number;
}
