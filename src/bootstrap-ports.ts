/**
 * Port interfaces for modules not yet implemented.
 * These will be replaced by concrete types when R-S7 through R-S12 land.
 */

/** Port for worktree registry (R-S7). */
export interface WorktreeRegistryPort {
  /** Init. */ initialize(): Promise<void>;
  /** Snapshot. */ snapshot(): unknown;
  /** Register. */ register(entry: unknown): Promise<void>;
  /** Transition. */ transition(
    sessionId: string,
    transition: unknown,
    reason?: string,
  ): Promise<void>;
  /** Heartbeat. */ heartbeat(sessionId: string, observedAt?: string): Promise<void>;
  /** Get entry. */ getEntry(sessionId: string): unknown;
  /** Active entries. */ getActiveEntries(): unknown[];
  /** Removal decision. */ removalDecision(sessionId: string): unknown;
}

/** Port for worker pool (R-S8). */
export interface WorkerPoolPort {
  /** Provision. */ provision(config: unknown): Promise<unknown>;
  /** Steer. */ steer(sessionId: string, message: string): Promise<void>;
  /** Kill. */ kill(sessionId: string): Promise<void>;
  /** Kill all. */ killAll(): Promise<void>;
  /** Active workers. */ getActiveWorkers(): unknown[];
  /** Count. */ getWorkerCount(): number;
  /** On done. */ onWorkerDone(callback: (sessionId: string, exitCode: number) => void): () => void;
  /** On stale. */ onWorkerStale(callback: (sessionId: string) => void): () => void;
  /** Dispose. */ dispose(): void;
}

/** Port for scheduler (R-S9). */
export interface SchedulerPort {
  /** Plan next. */ planNext(evidence: unknown): Promise<unknown>;
}

/** Port for triage engine (R-S10). */
export interface TriageEnginePort {
  /** Decide. */ decideFailureResponse(observation: unknown): unknown;
}

/** Port for run controller (R-S12). */
export interface OrchestratorRunPort {
  /** Start. */ start(scope?: string): Promise<void>;
  /** Pause. */ pause(): void;
  /** Resume. */ resume(): void;
  /** Abort. */ abort(reason?: string): Promise<void>;
  /** Is paused. */ isPaused(): boolean;
  /** Is running. */ isRunning(): boolean;
}
