/**
 * Worktree registry — invariant-preserving FSM for managed worktrees.
 *
 * @see Section 5.9 of pi-package-refactor-plan.md for the interface contract.
 * Stub factory — real implementation in R-S7.
 */

import type {
  WorktreeRegistryEntry,
  WorktreeRegistryState,
  WorktreeStatus,
} from "../shared/types.js";
import type { AtomicJsonStore } from "../shared/atomic-json.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Validated FSM transition between worktree statuses. */
export interface WorktreeTransition {
  /** Target status. */
  to: WorktreeStatus;
  /** Source status. */
  from: WorktreeStatus;
}

/** Decision on whether a worktree can be physically removed. */
export type RemovalDecision =
  | { allowed: true; reason: string; currentStatus: WorktreeStatus }
  | { allowed: false; reason: string; currentStatus: WorktreeStatus | "unknown" };

/** Safety authority for managed worktrees. */
export interface WorktreeRegistry {
  /** Load from disk or create fresh. Call once. */
  initialize(): Promise<void>;
  /** Read-only snapshot. Never mutates. */
  snapshot(): Readonly<WorktreeRegistryState>;
  /** Register a new worktree entry. Throws on duplicate. */
  register(entry: WorktreeRegistryEntry): Promise<void>;
  /** Transition via validated FSM. Throws on illegal transition. */
  transition(sessionId: string, transition: WorktreeTransition, reason?: string): Promise<void>;
  /** Update heartbeat timestamp. Throws on terminal entries. */
  heartbeat(sessionId: string, observedAt?: string): Promise<void>;
  /** Read one entry. Undefined if not found. */
  getEntry(sessionId: string): WorktreeRegistryEntry | undefined;
  /** All non-terminal entries. */
  getActiveEntries(): WorktreeRegistryEntry[];
  /** Can this worktree be physically removed? */
  removalDecision(sessionId: string): RemovalDecision;
}

/** Dependencies for creating a WorktreeRegistry. */
export interface WorktreeRegistryDeps {
  /** Atomic JSON store for the registry file. */
  store: AtomicJsonStore<WorktreeRegistryState>;
}

/**
 * Creates a WorktreeRegistry — the safety authority for managed worktrees.
 * Stub — returns a minimal empty registry. Real implementation in R-S7.
 *
 * @param _deps - Injected dependencies (unused in stub).
 *
 * @returns WorktreeRegistry instance.
 *
 * @example
 * ```typescript
 * const registry = createWorktreeRegistry(\{ store \});
 * await registry.initialize();
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function createWorktreeRegistry(_deps: WorktreeRegistryDeps): WorktreeRegistry {
  const emptyState: WorktreeRegistryState = { schemaVersion: "worktree-registry.v1", entries: {} };

  return {
    initialize: async () => {
      /* Stub — R-S7 will load from disk. */
    },
    snapshot: () => Object.freeze({ ...emptyState }),
    register: () => Promise.reject(new Error("WorktreeRegistry.register not yet implemented")),
    transition: () => Promise.reject(new Error("WorktreeRegistry.transition not yet implemented")),
    heartbeat: () => Promise.reject(new Error("WorktreeRegistry.heartbeat not yet implemented")),
    getEntry: () => undefined,
    getActiveEntries: () => [],
    removalDecision: () => ({
      allowed: false,
      reason: "unknown session",
      currentStatus: "unknown" as const,
    }),
  };
}
