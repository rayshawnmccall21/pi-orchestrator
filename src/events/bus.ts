/**
 * Typed event bus for orchestrator-event.v1 production, subscription, and audit.
 *
 * The bus enforces compile-time payload shape via generic `emit<K>()` — callers
 * cannot mismatch event kind and payload. Every emitted event is simultaneously
 * delivered to subscribers AND written to the JSONL audit log.
 *
 * @see ADR-008 for the two-layer event architecture.
 */

import type {
  OrchestratorEventKind,
  OrchestratorEventPayloads,
  OrchestratorEvent,
} from "../shared/types.js";
import type { JsonlLogWriter } from "../shared/jsonl-log.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Interface
// ═══════════════════════════════════════════════════════════════════════════

/** Subscriber callback receiving typed orchestrator events. */
export type EventSubscriber = (event: OrchestratorEvent) => void;

/** Dispose function returned by `onEvent` to unsubscribe. */
export type DisposeSubscription = () => void;

/**
 * Typed event bus with compile-time payload enforcement, subscriber
 * distribution, and integrated JSONL audit logging.
 */
export interface OrchestratorEventBus {
  /**
   * Emit a typed event. The generic parameter K links kind to its exact
   * payload shape — TypeScript rejects mismatched kind/payload combinations.
   *
   * Events are frozen, distributed to all subscribers (error-isolated),
   * and written to the JSONL audit log.
   *
   * @param kind - The event kind discriminator.
   * @param sessionId - The child session ID or "orchestrator" for parent events.
   * @param payload - Typed payload matching the event kind.
   */
  emit<K extends OrchestratorEventKind>(
    kind: K,
    sessionId: string,
    payload: OrchestratorEventPayloads[K],
  ): void;

  /**
   * Register a subscriber for all emitted events.
   * Returns a dispose function that removes the subscription.
   *
   * @param subscriberCallback - Function called with each emitted event.
   *
   * @returns A dispose function that removes the subscriber when called.
   */
  onEvent(subscriberCallback: EventSubscriber): DisposeSubscription;

  /**
   * Close the bus: flush the audit log writer and reject further emissions.
   * Idempotent — calling close() multiple times is safe.
   *
   * @returns A promise that resolves when the log writer is closed.
   */
  close(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for creating an OrchestratorEventBus. */
export interface EventBusConfig {
  /** Pipeline run ID stamped on every emitted event. */
  runId: string;
  /** Optional JSONL log writer for audit persistence. When omitted, events are distributed to subscribers only. */
  logWriter?: JsonlLogWriter | undefined;
  /** Optional error handler for subscriber/log failures (default: swallow). */
  onInternalError?: ((error: unknown, context: string) => void) | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// Level Mapping
// ═══════════════════════════════════════════════════════════════════════════

/** Severity level lookup — avoids switch complexity for 20-member exhaustive match. */
const LEVEL_BY_KIND: Record<OrchestratorEventKind, OrchestratorEvent["level"]> = {
  dispatch_failed: "error",
  escalation_triggered: "error",
  merge_conflict: "warn",
  prompt_observed: "warn",
  agent_start: "info",
  agent_end: "info",
  tool_execution_start: "info",
  tool_execution_end: "info",
  turn_end: "info",
  checkpoint_result: "info",
  dispatch_sent: "info",
  dispatch_confirmed: "info",
  dispatch_completed: "info",
  steer_sent: "info",
  merge_start: "info",
  merge_complete: "info",
  approval_requested: "info",
  approval_resolved: "info",
  worker_state_changed: "info",
  pipeline_status_changed: "info",
};

/**
 * Maps an OrchestratorEventKind to its default severity level.
 *
 * @param kind - The event kind to determine level for.
 *
 * @returns The severity level: "error", "warn", or "info".
 *
 * @example
 * ```typescript
 * levelForKind("dispatch_failed") // => "error"
 * levelForKind("merge_conflict")  // => "warn"
 * levelForKind("agent_start")     // => "info"
 * ```
 */
export function levelForKind(kind: OrchestratorEventKind): OrchestratorEvent["level"] {
  return LEVEL_BY_KIND[kind];
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Safely invoke an internal error handler without re-throwing.
 *
 * @param handler - The error handler, or undefined.
 * @param error - The error to report.
 * @param context - Description of where the error occurred.
 *
 * @example
 * ```typescript
 * safeReportError(handler, new Error("boom"), "subscriber:agent_start");
 * ```
 */
function safeReportError(
  handler: ((error: unknown, context: string) => void) | undefined,
  error: unknown,
  context: string,
): void {
  if (handler !== undefined) {
    try {
      handler(error, context);
    } catch {
      // Meta-error handler must never crash
    }
  }
}

/** Parameters for building an event envelope. */
interface EnvelopeParams<K extends OrchestratorEventKind> {
  /** Pipeline run identifier. */
  runId: string;
  /** Event kind discriminator. */
  kind: K;
  /** Session identifier for attribution. */
  sessionId: string;
  /** Typed event payload. */
  payload: OrchestratorEventPayloads[K];
}

/**
 * Build a frozen event envelope from the given parameters.
 *
 * @param params - Envelope construction parameters.
 *
 * @returns A frozen OrchestratorEvent.
 *
 * @example
 * ```typescript
 * const event = buildEventEnvelope({ runId: "run-1", kind: "agent_start", sessionId: "s1", payload: {} });
 * ```
 */
function buildEventEnvelope<K extends OrchestratorEventKind>(
  params: EnvelopeParams<K>,
): OrchestratorEvent {
  const frozenPayload = Object.freeze({ ...params.payload });
  return Object.freeze({
    schema: "orchestrator-event.v1" as const,
    timestamp: new Date().toISOString(),
    runId: params.runId,
    sessionId: params.sessionId,
    level: levelForKind(params.kind),
    kind: params.kind,
    payload: frozenPayload,
  });
}

/** Parameters for distributing an event to subscribers. */
interface DistributionParams {
  /** Current subscriber list. */
  subscriberList: EventSubscriber[];
  /** The frozen event to distribute. */
  event: OrchestratorEvent;
  /** Event kind for error context labeling. */
  kind: OrchestratorEventKind;
  /** Optional internal error handler. */
  errorHandler: ((error: unknown, context: string) => void) | undefined;
}

/**
 * Distribute an event to all subscribers with error isolation.
 *
 * @param params - Distribution parameters including subscribers, event, and error handler.
 *
 * @example
 * ```typescript
 * distributeToSubscribers({ subscriberList: subs, event, kind: "agent_start", errorHandler: handler });
 * ```
 */
function distributeToSubscribers(params: DistributionParams): void {
  const subscriberSnapshot = [...params.subscriberList];
  for (const subscriberCallback of subscriberSnapshot) {
    try {
      subscriberCallback(params.event);
    } catch (subscriberError: unknown) {
      safeReportError(params.errorHandler, subscriberError, `subscriber:${params.kind}`);
    }
  }
}

/**
 * Create a dispose function for removing a subscriber from a list.
 *
 * @param subscriberList - The mutable subscriber array.
 * @param subscriberCallback - The callback to remove on dispose.
 *
 * @returns An idempotent dispose function.
 *
 * @example
 * ```typescript
 * const dispose = createDisposeFn(subscribers, callback);
 * dispose(); // removes callback from subscribers
 * ```
 */
function createDisposeFn(
  subscriberList: EventSubscriber[],
  subscriberCallback: EventSubscriber,
): DisposeSubscription {
  let disposed = false;
  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    const subscriberIndex = subscriberList.indexOf(subscriberCallback);
    if (subscriberIndex !== -1) {
      subscriberList.splice(subscriberIndex, 1);
    }
  };
}

/** Parameters for writing an event to the audit log. */
interface AuditLogParams {
  /** Optional JSONL log writer for persistence. */
  logWriter: JsonlLogWriter | undefined;
  /** The frozen event to persist. */
  event: OrchestratorEvent;
  /** Error context label for log write failures. */
  errorContext: string;
  /** Optional internal error handler. */
  errorHandler: ((error: unknown, context: string) => void) | undefined;
}

/**
 * Write a frozen event to the JSONL audit log (fire-and-forget).
 *
 * @param params - Audit log write parameters.
 *
 * @example
 * ```typescript
 * writeToAuditLog({ logWriter, event, errorContext: "audit-log:agent_start", errorHandler: handler });
 * ```
 */
function writeToAuditLog(params: AuditLogParams): void {
  if (!params.logWriter) {
    return;
  }
  const logRecord: Record<string, unknown> = {
    schema: params.event.schema,
    timestamp: params.event.timestamp,
    runId: params.event.runId,
    sessionId: params.event.sessionId,
    level: params.event.level,
    kind: params.event.kind,
    payload: params.event.payload,
  };
  params.logWriter.append(logRecord).catch((logError: unknown) => {
    safeReportError(params.errorHandler, logError, params.errorContext);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a typed OrchestratorEventBus bound to the given configuration.
 *
 * Every emitted event is:
 * 1. Constructed as a frozen `orchestrator-event.v1` envelope.
 * 2. Delivered to all registered subscribers (error-isolated).
 * 3. Written to the JSONL audit log (fire-and-forget, error-isolated).
 *
 * @param config - Bus configuration including runId and optional log writer.
 *
 * @returns An OrchestratorEventBus instance.
 *
 * @example
 * ```typescript
 * const bus = createEventBus({ runId: "run-1", logWriter });
 * bus.onEvent((event) => console.log(event.kind));
 * bus.emit("agent_start", "session-1", { agentId: "dev" });
 * await bus.close();
 * ```
 */
export function createEventBus(config: EventBusConfig): OrchestratorEventBus {
  const { runId, logWriter, onInternalError } = config;
  const subscribers: EventSubscriber[] = [];
  let closed = false;

  return {
    emit<K extends OrchestratorEventKind>(
      kind: K,
      sessionId: string,
      payload: OrchestratorEventPayloads[K],
    ): void {
      if (closed) {
        return;
      }

      const event = buildEventEnvelope({ runId, kind, sessionId, payload });
      distributeToSubscribers({
        subscriberList: subscribers,
        event,
        kind,
        errorHandler: onInternalError,
      });
      writeToAuditLog({
        logWriter,
        event,
        errorContext: `audit-log:${kind}`,
        errorHandler: onInternalError,
      });
    },

    onEvent(subscriberCallback: EventSubscriber): DisposeSubscription {
      subscribers.push(subscriberCallback);
      return createDisposeFn(subscribers, subscriberCallback);
    },

    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      if (logWriter) {
        await logWriter.close();
      }
    },
  };
}
