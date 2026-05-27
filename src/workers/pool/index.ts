/**
 * Worker pool — provision, steer, and lifecycle management for child sessions.
 *
 * @see Section 5.13 of pi-package-refactor-plan.md for the interface contract.
 * Stub factory — real implementation in R-S8.
 */

import type { OrchestratorConfig } from "../../config.js";
import type { OrchestratorPaths } from "../../shared/paths.js";
import type { GitPort } from "../../shared/git.js";
import type { TmuxPort } from "../../shared/tmux.js";
import type { CommandExecutor } from "../../shared/process.js";
import type { WorktreeRegistry } from "../../state/worktree-registry.js";
import type { OrchestratorEventBus } from "../../events/bus.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for provisioning a new worker. */
export interface WorkerProvisionConfig {
  /** Unique session identifier. */
  sessionId: string;
  /** BMAD agent ID. */
  agent: string;
  /** BMAD workflow ID. */
  workflow: string;
  /** Story ID for implementation-scoped dispatches, or null. */
  storyId: string | null;
  /** Dispatch prompt to send after session starts. */
  dispatchPrompt: string;
  /** Model to configure for the child session. */
  model: string;
  /** Thinking level for the child session. */
  thinkingLevel: string;
}

/** Handle to a provisioned worker. */
export interface WorkerHandle {
  /** Unique session identifier. */
  sessionId: string;
  /** Transport mechanism. */
  transport: "tmux" | "spawn";
  /** Absolute worktree path. */
  worktreePath: string;
  /** Git branch name. */
  branchName: string;
}

/** Manages the lifecycle of child worker sessions. */
export interface WorkerPool {
  /** Provision a new worker session. */
  provision(config: WorkerProvisionConfig): Promise<WorkerHandle>;
  /** Send a diagnostic steer message to a worker. */
  steer(sessionId: string, message: string): Promise<void>;
  /** Kill a specific worker session. */
  kill(sessionId: string): Promise<void>;
  /** Kill all active worker sessions. */
  killAll(): Promise<void>;
  /** Get all active worker handles. */
  getActiveWorkers(): WorkerHandle[];
  /** Get the count of active workers. */
  getWorkerCount(): number;
  /** Subscribe to worker completion events. */
  onWorkerDone(callback: (sessionId: string, exitCode: number) => void): () => void;
  /** Subscribe to worker stale events. */
  onWorkerStale(callback: (sessionId: string) => void): () => void;
  /** Dispose resources. */
  dispose(): void;
}

/** Dependencies for creating a WorkerPool. */
export interface WorkerPoolDeps {
  /** Orchestrator configuration. */
  config: OrchestratorConfig;
  /** Resolved paths. */
  paths: OrchestratorPaths;
  /** Git port. */
  git: GitPort;
  /** Tmux port. */
  tmux: TmuxPort;
  /** Command executor. */
  exec: CommandExecutor;
  /** Worktree registry. */
  registry: WorktreeRegistry;
  /** Event bus. */
  eventBus: OrchestratorEventBus;
}

/**
 * Creates a WorkerPool for managing child sessions.
 * Stub — returns a no-op pool. Real implementation in R-S8.
 *
 * @param _deps - Injected dependencies (unused in stub).
 *
 * @returns WorkerPool instance.
 *
 * @example
 * ```typescript
 * const pool = createWorkerPool(deps);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function createWorkerPool(_deps: WorkerPoolDeps): WorkerPool {
  const noopUnsubscribe = (): (() => void) => {
    return () => {
      /* unsubscribe */
    };
  };
  return {
    provision: () => Promise.reject(new Error("WorkerPool.provision not yet implemented")),
    steer: () => Promise.reject(new Error("WorkerPool.steer not yet implemented")),
    kill: () => Promise.reject(new Error("WorkerPool.kill not yet implemented")),
    killAll: () => Promise.resolve(),
    getActiveWorkers: () => [],
    getWorkerCount: () => 0,
    onWorkerDone: noopUnsubscribe,
    onWorkerStale: noopUnsubscribe,
    dispose: () => {
      /* Stub no-op. */
    },
  };
}
