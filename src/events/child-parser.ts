/**
 * Child JSONL stream parser for Pi event translation.
 *
 * Buffers partial lines across chunk boundaries and translates complete
 * Pi-native JSONL events into typed OrchestratorEventBus emissions.
 * Unknown event kinds and malformed JSON produce warn-level bus events
 * without crashing consumers.
 *
 * @see R-S5 AC-3, AC-5.
 */

import type { OrchestratorEventBus } from "./bus.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A session-scoped child parser that translates Pi JSONL into bus events.
 */
export interface ChildParser {
  /** Feed a raw chunk of stdout data. Buffers partial lines. */
  feed(chunk: string): void;
  /** Flush remaining buffer (on child process exit). */
  flush(): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Types
// ═══════════════════════════════════════════════════════════════════════════

/** Shape of a parsed Pi JSONL event line. */
interface ParsedPiEvent {
  type: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  exitCode?: number;
  turnIndex?: number;
  durationMs?: number;
  agentId?: string;
  workflowId?: string;
}

/** Context passed to all routing helpers. */
interface RoutingContext {
  sessionId: string;
  eventBus: OrchestratorEventBus;
}

/** Maximum characters from malformed lines included in error reasons. */
const MALFORMED_LINE_TRUNCATION_LENGTH = 200;

// ═══════════════════════════════════════════════════════════════════════════
// Routing Helpers — one function per Pi event type
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emit an agent_start bus event from parsed Pi data.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event.
 *
 * @example
 * ```typescript
 * emitAgentStart(context, { type: "agent_start", agentId: "dev" });
 * ```
 */
function emitAgentStart(context: RoutingContext, parsed: ParsedPiEvent): void {
  const payload: { agentId?: string; workflowId?: string } = {};
  if (parsed.agentId !== undefined) {
    payload.agentId = parsed.agentId;
  }
  if (parsed.workflowId !== undefined) {
    payload.workflowId = parsed.workflowId;
  }
  context.eventBus.emit("agent_start", context.sessionId, payload);
}

/**
 * Emit an agent_end bus event from parsed Pi data.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event.
 *
 * @example
 * ```typescript
 * emitAgentEnd(context, { type: "agent_end", exitCode: 0 });
 * ```
 */
function emitAgentEnd(context: RoutingContext, parsed: ParsedPiEvent): void {
  const payload: { exitCode: number; durationMs?: number } = {
    exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : 0,
  };
  if (parsed.durationMs !== undefined) {
    payload.durationMs = parsed.durationMs;
  }
  context.eventBus.emit("agent_end", context.sessionId, payload);
}

/**
 * Emit a tool_execution_end bus event, then detect checkpoint results.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event.
 *
 * @example
 * ```typescript
 * emitToolEnd(context, parsed);
 * ```
 */
function emitToolEnd(context: RoutingContext, parsed: ParsedPiEvent): void {
  context.eventBus.emit("tool_execution_end", context.sessionId, {
    toolCallId: parsed.toolCallId ?? "",
    toolName: parsed.toolName ?? "",
    isError: parsed.isError ?? false,
  });
  maybeEmitCheckpointResult(context, parsed);
}

/**
 * Detect and emit a checkpoint_result from a bmad_workflow_step tool end event.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event (tool_execution_end for bmad_workflow_step).
 *
 * @example
 * ```typescript
 * maybeEmitCheckpointResult(context, parsed);
 * ```
 */
function maybeEmitCheckpointResult(context: RoutingContext, parsed: ParsedPiEvent): void {
  if (parsed.toolName !== "bmad_workflow_step") {
    return;
  }
  const result = parsed.result;
  if (result === null || result === undefined || typeof result !== "object") {
    return;
  }
  const checkpointRecord: Record<string, unknown> = Object.fromEntries(Object.entries(result));
  const checkpointName: unknown = checkpointRecord["checkpointName"];
  const passed: unknown = checkpointRecord["passed"];
  const reason: unknown = checkpointRecord["reason"];
  if (
    typeof checkpointName === "string" &&
    typeof passed === "boolean" &&
    typeof reason === "string"
  ) {
    context.eventBus.emit("checkpoint_result", context.sessionId, {
      checkpointName,
      passed,
      reason,
    });
  }
}

/**
 * Emit a turn_end bus event from parsed Pi data.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event.
 *
 * @example
 * ```typescript
 * emitTurnEnd(context, { type: "turn_end", turnIndex: 3 });
 * ```
 */
function emitTurnEnd(context: RoutingContext, parsed: ParsedPiEvent): void {
  context.eventBus.emit("turn_end", context.sessionId, {
    turnIndex: typeof parsed.turnIndex === "number" ? parsed.turnIndex : 0,
  });
}

/**
 * Emit a tool_execution_start bus event from parsed Pi data.
 *
 * @param context - Routing context with sessionId and bus.
 * @param parsed - Parsed Pi event.
 *
 * @example
 * ```typescript
 * emitToolStart(context, { type: "tool_execution_start", toolCallId: "tc-1", toolName: "Read" });
 * ```
 */
function emitToolStart(context: RoutingContext, parsed: ParsedPiEvent): void {
  context.eventBus.emit("tool_execution_start", context.sessionId, {
    toolCallId: parsed.toolCallId ?? "",
    toolName: parsed.toolName ?? "",
    args: parsed.args,
  });
}

/** Dispatch table mapping Pi event types to their routing functions. */
const PI_EVENT_HANDLERS = new Map<string, (context: RoutingContext, parsed: ParsedPiEvent) => void>(
  [
    ["agent_start", emitAgentStart],
    ["agent_end", emitAgentEnd],
    ["turn_end", emitTurnEnd],
    ["tool_execution_start", emitToolStart],
    ["tool_execution_end", emitToolEnd],
  ],
);

/**
 * Route a parsed Pi event to the appropriate bus emission via dispatch table.
 *
 * @param context - Routing context with sessionId and bus.
 * @param eventType - The Pi event type string.
 * @param parsed - Parsed Pi event data.
 *
 * @example
 * ```typescript
 * routePiEvent(context, "agent_start", parsed);
 * ```
 */
function routePiEvent(context: RoutingContext, eventType: string, parsed: ParsedPiEvent): void {
  const handler = PI_EVENT_HANDLERS.get(eventType);
  if (handler) {
    handler(context, parsed);
  } else {
    context.eventBus.emit("worker_state_changed", context.sessionId, {
      sessionId: context.sessionId,
      from: "parsing",
      to: "unknown-event",
      reason: `Unknown Pi event type: ${eventType}`,
    });
  }
}

/**
 * Parse and route a single JSONL line to the bus.
 *
 * @param line - A single JSONL line (may be empty or malformed).
 * @param context - Routing context with sessionId and bus.
 *
 * @example
 * ```typescript
 * processJsonlLine('{"type":"agent_start"}', context);
 * ```
 */
function processJsonlLine(line: string, context: RoutingContext): void {
  const trimmed = line.trim();
  if (trimmed === "") {
    return;
  }

  let parsed: ParsedPiEvent;
  try {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- JSON.parse returns unknown; structural validation follows
    parsed = JSON.parse(trimmed) as ParsedPiEvent;
  } catch {
    context.eventBus.emit("worker_state_changed", context.sessionId, {
      sessionId: context.sessionId,
      from: "parsing",
      to: "parse-error",
      reason: `Malformed JSONL: ${trimmed.slice(0, MALFORMED_LINE_TRUNCATION_LENGTH)}`,
    });
    return;
  }

  const eventType = parsed.type;
  if (typeof eventType !== "string") {
    context.eventBus.emit("worker_state_changed", context.sessionId, {
      sessionId: context.sessionId,
      from: "parsing",
      to: "parse-error",
      reason: `Missing type field in JSONL line`,
    });
    return;
  }

  routePiEvent(context, eventType, parsed);
}

// ═══════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates a session-scoped child parser that translates Pi JSONL events
 * into typed bus emissions.
 *
 * The parser:
 * - Buffers partial lines across feed() calls.
 * - Splits on newlines and JSON-parses each complete line.
 * - Routes known Pi event types to typed bus emissions.
 * - Emits warn-level events for malformed JSON.
 * - Emits info-level events for unknown event kinds.
 * - Never throws from feed() or flush().
 *
 * @param sessionId - The child session ID for event attribution.
 * @param eventBus - The event bus to emit translated events on.
 *
 * @returns A ChildParser with feed() and flush() methods.
 *
 * @example
 * ```typescript
 * const parser = createChildParser("session-1", bus);
 * parser.feed('{"type":"agent_start"}\n');
 * parser.flush();
 * ```
 */
export function createChildParser(sessionId: string, eventBus: OrchestratorEventBus): ChildParser {
  let buffer = "";
  const context: RoutingContext = { sessionId, eventBus };

  return {
    feed(chunk: string): void {
      try {
        buffer += chunk;
        const lines = buffer.split("\n");
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- split always returns at least one element
        buffer = lines.pop()!;
        for (const line of lines) {
          processJsonlLine(line, context);
        }
      } catch {
        // feed() must never throw (INV-1)
      }
    },

    flush(): void {
      try {
        if (buffer.length > 0) {
          const remaining = buffer;
          buffer = "";
          processJsonlLine(remaining, context);
        }
      } catch {
        // flush() must never throw (INV-1)
      }
    },
  };
}
