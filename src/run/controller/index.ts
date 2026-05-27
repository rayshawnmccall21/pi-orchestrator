/**
 * Run controller — start/pause/resume/abort lifecycle for pipeline runs.
 *
 * @see Section 5.14 of pi-package-refactor-plan.md for the interface contract.
 * Stub factory — real implementation in R-S12.
 */

import type { OrchestratorConfig } from "../../config.js";
import type { OrchestratorPaths } from "../../shared/paths.js";
import type { GitPort } from "../../shared/git.js";
import type { PipelineStateManager } from "../../state/pipeline.js";
import type { WorktreeRegistry } from "../../state/worktree-registry.js";
import type { OrchestratorEventBus } from "../../events/bus.js";
import type { WorkerPool } from "../../workers/pool/index.js";
import type { Scheduler } from "../../scheduling/engine.js";
import type { TriageEngine } from "../../triage/engine.js";
import type { AuthorizationPolicy } from "../../triage/authorization.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Scope of a pipeline start request. */
export type StartScope = "analysis" | "planning" | "architecture" | "implementation" | "full";

/** Run lifecycle controller. */
export interface OrchestratorRun {
  /** Start a pipeline run with the given scope. */
  start(scope?: StartScope): Promise<void>;
  /** Pause the running pipeline. */
  pause(): void;
  /** Resume a paused pipeline. */
  resume(): void;
  /** Abort the pipeline with optional reason. */
  abort(reason?: string): Promise<void>;
  /** Whether the pipeline is currently paused. */
  isPaused(): boolean;
  /** Whether the pipeline is currently running. */
  isRunning(): boolean;
}

/** Dependencies for creating a run controller. */
export interface RunControllerDeps {
  /** State manager. */
  stateManager: PipelineStateManager;
  /** Worker pool. */
  workerPool: WorkerPool;
  /** Scheduler. */
  scheduler: Scheduler;
  /** Triage engine. */
  triageEngine: TriageEngine;
  /** Authorization policy. */
  authorization: AuthorizationPolicy;
  /** Event bus. */
  eventBus: OrchestratorEventBus;
  /** Configuration. */
  config: OrchestratorConfig;
  /** Paths. */
  paths: OrchestratorPaths;
  /** Git port. */
  git: GitPort;
  /** Worktree registry. */
  registry: WorktreeRegistry;
}

/**
 * Creates an OrchestratorRun controller.
 * Stub — tracks paused/running state. Real implementation in R-S12.
 *
 * @param _deps - Injected dependencies (unused in stub).
 *
 * @returns OrchestratorRun instance.
 *
 * @example
 * ```typescript
 * const run = createRunController(deps);
 * await run.start("full");
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function createRunController(_deps: RunControllerDeps): OrchestratorRun {
  let paused = false;
  let running = false;

  return {
    start: () => {
      running = true;
      paused = false;
      return Promise.resolve();
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
    },
    abort: () => {
      running = false;
      paused = false;
      return Promise.resolve();
    },
    isPaused: () => paused,
    isRunning: () => running,
  };
}
