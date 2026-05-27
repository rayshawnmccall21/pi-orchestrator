/**
 * State authority: single mutation path for `PipelineRunState`.
 *
 * `PipelineStateManager` is the **single mutation authority** for `PipelineRunState`.
 * Every state change flows through `apply()`:
 *
 *   StateMutation → validate → reduce → persist → emit audit → notify subscribers.
 *
 * If validation fails, no state changes, no persistence, no notifications.
 *
 * @see ADR-003 for the reducer-based state management architecture.
 * @see Section 5.8 of the refactor plan for the interface contract.
 */

import { OrchestratorError } from "../shared/errors.js";
import type { AtomicJsonStore, ReadOutcome } from "../shared/atomic-json.js";
import type { OrchestratorEventBus } from "../events/bus.js";
import type { PipelineRunState, PipelineStatus, StateMutation } from "../shared/types.js";
import { validateMutation } from "./pipeline-validate.js";
import { reduceMutation } from "./pipeline-reduce.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Result of state initialization describing recovery outcome. */
export interface RecoveryResult {
  /** Whether the established state was loaded from existing persisted storage. */
  recovered: boolean;
  /** Whether the established state was loaded from persisted storage. */
  fromPersisted: boolean;
  /** Path to quarantined corrupt file, or null. */
  quarantinedPath: string | null;
  /** The run ID of the established state. */
  runId: string;
}

/** Callback receiving a read-only state snapshot on each accepted mutation. */
export type StateChangeCallback = (state: Readonly<PipelineRunState>) => void;

/** Dispose function that removes a subscriber when called. */
export type DisposeStateSubscription = () => void;

/**
 * Single mutation authority for pipeline run state.
 * All state modifications go through `apply()`.
 */
export interface PipelineStateManager {
  /** Current in-memory state (read-only frozen snapshot). Throws before initialization. */
  getState(): Readonly<PipelineRunState>;
  /** Validate → reduce → persist → emit. Single mutation authority. */
  apply(mutation: StateMutation): Promise<void>;
  /** Load persisted state or create fresh. Call once at bootstrap. Throws if called twice. */
  initialize(runId: string, pipelineId: string): Promise<RecoveryResult>;
  /** Subscribe to state changes. Returns dispose function. */
  onStateChange(subscriberCallback: StateChangeCallback): DisposeStateSubscription;
  /** Force persist current state (for shutdown). Throws before initialization. */
  flush(): Promise<void>;
}

/** Dependencies for creating a PipelineStateManager. */
export interface PipelineStateManagerDeps {
  /** Atomic JSON store for durable persistence. */
  store: AtomicJsonStore<PipelineRunState>;
  /** Event bus for audit event emission. */
  eventBus: OrchestratorEventBus;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fresh State Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a fresh initial pipeline run state.
 *
 * @param runId - Stable run identifier.
 * @param pipelineId - Stable pipeline identifier.
 *
 * @returns A new PipelineRunState at idle status.
 *
 * @example
 * ```typescript
 * const state = createFreshState("run-1", "pipeline-1");
 * ```
 */
function createFreshState(runId: string, pipelineId: string): PipelineRunState {
  const now = new Date().toISOString();
  return {
    schemaVersion: "pipeline-run-state.v1",
    pipelineId,
    runId,
    status: "idle",
    phase: "analysis",
    activeStage: null,
    activeWorkflowId: null,
    activeStepId: null,
    activeStoryId: null,
    dispatches: [],
    childSessions: [],
    prompts: [],
    approvals: [],
    gateResults: [],
    artifactEvidence: [],
    storyLifecycles: {},
    retryCounts: {},
    events: [],
    blocker: null,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    completedPhases: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Emission
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emit audit events for status-changing mutations via the event bus.
 * Called only after persistence succeeds. Errors are swallowed.
 *
 * @param eventBus - The event bus for audit emission.
 * @param previousStatus - The pipeline status before the mutation.
 * @param mutation - The mutation that was applied.
 *
 * @example
 * ```typescript
 * emitMutationEvent(bus, "idle", { kind: "set-status", status: "running", reason: "go" });
 * ```
 */
function emitMutationEvent(
  eventBus: OrchestratorEventBus,
  previousStatus: PipelineStatus,
  mutation: StateMutation,
): void {
  try {
    if (mutation.kind === "set-status" && previousStatus !== mutation.status) {
      eventBus.emit("pipeline_status_changed", "orchestrator", {
        from: previousStatus,
        to: mutation.status,
      });
    }
  } catch {
    // Audit emission errors must never crash the state manager.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Subscriber Notification
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notify all subscribers with a frozen read-only state snapshot.
 * Errors from individual subscribers are swallowed.
 *
 * @param subscribers - Current subscriber list.
 * @param stateSnapshot - The frozen state snapshot to deliver.
 *
 * @example
 * ```typescript
 * notifySubscribers(subscribers, Object.freeze(state));
 * ```
 */
function notifySubscribers(
  subscribers: StateChangeCallback[],
  stateSnapshot: Readonly<PipelineRunState>,
): void {
  const subscriberSnapshot = [...subscribers];
  for (const subscriberCallback of subscriberSnapshot) {
    try {
      subscriberCallback(stateSnapshot);
    } catch {
      // Subscriber errors must not crash the state manager.
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal State Container
// ═══════════════════════════════════════════════════════════════════════════

/** Mutable internal state container for the manager closure. */
interface ManagerInternalState {
  /** Current pipeline state, or undefined before initialization. */
  currentState: PipelineRunState | undefined;
  /** Re-entrancy guard — true while apply() is in progress. */
  applying: boolean;
  /** Subscriber callback list. */
  subscribers: StateChangeCallback[];
}

/**
 * Assert state is initialized or throw.
 *
 * @param internal - Internal state container.
 *
 * @returns The current pipeline state.
 *
 * @throws OrchestratorError if state is not initialized.
 *
 * @example
 * ```typescript
 * const state = requireInitialized(internalState);
 * ```
 */
function requireInitialized(internal: ManagerInternalState): PipelineRunState {
  if (internal.currentState === undefined) {
    throw new OrchestratorError(
      "Pipeline state not initialized — call initialize() first",
      "STATE_NOT_INITIALIZED",
    );
  }
  return internal.currentState;
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a PipelineStateManager — the single mutation authority.
 *
 * @param deps - Dependencies including the atomic store and event bus.
 *
 * @returns A PipelineStateManager instance.
 *
 * @example
 * ```typescript
 * const stateManager = createPipelineStateManager({ store, eventBus });
 * await stateManager.initialize("run-1", "pipeline-1");
 * await stateManager.apply({ kind: "set-status", status: "running", reason: "go" });
 * ```
 */
export function createPipelineStateManager(deps: PipelineStateManagerDeps): PipelineStateManager {
  const internal: ManagerInternalState = {
    currentState: undefined,
    applying: false,
    subscribers: [],
  };

  return {
    getState: () => Object.freeze({ ...requireInitialized(internal) }),
    apply: (mutation) => applyMutation(deps, internal, mutation),
    initialize: (runId, pipelineId) => initializeState({ deps, internal, runId, pipelineId }),
    onStateChange: (cb) => addSubscriber(internal, cb),
    flush: () => flushState(deps, internal),
  };
}

/**
 * Apply a single mutation through the validate → reduce → persist → emit → notify pipeline.
 *
 * @param deps - Manager dependencies.
 * @param internal - Mutable internal state.
 * @param mutation - The mutation to apply.
 *
 * @throws OrchestratorError on validation failure or recursive mutation.
 *
 * @example
 * ```typescript
 * await applyMutation(deps, internal, { kind: "set-status", status: "running", reason: "go" });
 * ```
 */
async function applyMutation(
  deps: PipelineStateManagerDeps,
  internal: ManagerInternalState,
  mutation: StateMutation,
): Promise<void> {
  const state = requireInitialized(internal);
  if (internal.applying) {
    throw new OrchestratorError(
      "State mutation rejected — another apply() is in progress or a subscriber attempted recursive mutation",
      "RECURSIVE_MUTATION",
    );
  }
  internal.applying = true;
  try {
    validateMutation(state, mutation);
    const previousStatus = state.status;
    const newState = reduceMutation(state, mutation);
    await deps.store.write(newState);
    internal.currentState = newState;
    const frozenSnapshot = Object.freeze({ ...internal.currentState });
    emitMutationEvent(deps.eventBus, previousStatus, mutation);
    notifySubscribers(internal.subscribers, frozenSnapshot);
  } finally {
    internal.applying = false;
  }
}

/**
 * Read from the store using readWithOutcome if available, falling back to read().
 *
 * @param store - The atomic JSON store to read from.
 *
 * @returns A ReadOutcome with data and quarantine tracking.
 *
 * @example
 * ```typescript
 * const outcome = await readStoreWithOutcome(store);
 * ```
 */
async function readStoreWithOutcome(
  store: AtomicJsonStore<PipelineRunState>,
): Promise<ReadOutcome<PipelineRunState>> {
  if (store.readWithOutcome !== undefined) {
    return store.readWithOutcome();
  }
  return { data: await store.read(), quarantinedPath: null };
}

/** Parameters for state initialization. */
interface InitializeParams {
  /** Manager dependencies. */
  deps: PipelineStateManagerDeps;
  /** Mutable internal state container. */
  internal: ManagerInternalState;
  /** Pipeline run identifier. */
  runId: string;
  /** Stable pipeline identifier. */
  pipelineId: string;
}

/**
 * Initialize state from persistence or create fresh.
 *
 * @param params - Initialization parameters bundled to satisfy max-params.
 *
 * @returns A RecoveryResult describing the initialization outcome.
 *
 * @throws OrchestratorError if already initialized.
 *
 * @example
 * ```typescript
 * const result = await initializeState({ deps, internal, runId: "run-1", pipelineId: "pipeline-1" });
 * ```
 */
async function initializeState(params: InitializeParams): Promise<RecoveryResult> {
  const { deps, internal, runId, pipelineId } = params;
  if (internal.currentState !== undefined) {
    throw new OrchestratorError(
      "Pipeline state already initialized — initialize() cannot be called twice",
      "STATE_ALREADY_INITIALIZED",
    );
  }
  const readOutcome = await readStoreWithOutcome(deps.store);
  if (readOutcome.data !== undefined) {
    internal.currentState = readOutcome.data;
    return {
      recovered: true,
      fromPersisted: true,
      quarantinedPath: null,
      runId: readOutcome.data.runId,
    };
  }
  const freshState = createFreshState(runId, pipelineId);
  await deps.store.write(freshState);
  internal.currentState = freshState;
  return {
    recovered: false,
    fromPersisted: false,
    quarantinedPath: readOutcome.quarantinedPath,
    runId,
  };
}

/**
 * Add a state change subscriber and return a dispose function.
 *
 * @param internal - Mutable internal state.
 * @param subscriberCallback - Function to call on state changes.
 *
 * @returns A dispose function that removes the subscriber.
 *
 * @example
 * ```typescript
 * const dispose = addSubscriber(internal, (state) => console.log(state.status));
 * ```
 */
function addSubscriber(
  internal: ManagerInternalState,
  subscriberCallback: StateChangeCallback,
): DisposeStateSubscription {
  internal.subscribers.push(subscriberCallback);
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const index = internal.subscribers.indexOf(subscriberCallback);
    if (index !== -1) {
      internal.subscribers.splice(index, 1);
    }
  };
}

/**
 * Force persist the current in-memory state.
 *
 * @param deps - Manager dependencies.
 * @param internal - Mutable internal state.
 *
 * @throws OrchestratorError if not initialized.
 *
 * @example
 * ```typescript
 * await flushState(deps, internal);
 * ```
 */
async function flushState(
  deps: PipelineStateManagerDeps,
  internal: ManagerInternalState,
): Promise<void> {
  await deps.store.write(requireInitialized(internal));
}
