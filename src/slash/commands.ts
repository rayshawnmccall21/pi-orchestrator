/**
 * Slash command and tool registration for the pipeline orchestrator.
 *
 * All commands route through `OrchestratorActions` — the single typed
 * surface boundary. No command imports state, workers, or run internals.
 *
 * @see R-S14 AC-1 for slash/tool equivalence
 */

import type { OrchestratorActions, StartScope } from "../actions.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public Types
// ═══════════════════════════════════════════════════════════════════════════

/** Dependencies for slash command registration. */
export interface SlashCommandDeps {
  /** OrchestratorActions — the single surface boundary. */
  actions: OrchestratorActions;
}

/** Minimal Pi extension API surface for command registration. */
interface PiCommandApi {
  /** Register a slash command. */
  registerCommand(
    name: string,
    options: {
      /** Command description. */
      description?: string;
      /** Command handler. */
      handler: (args: string, ctx: unknown) => Promise<void>;
    },
  ): void;
}

/** Tool execution result content block. */
interface ToolContentBlock {
  /** Content type. */
  type: "text";
  /** Content text. */
  text: string;
}

/** Structured result from command/tool dispatch. */
interface CommandResult {
  /** Whether the action succeeded. */
  success: boolean;
  /** Human-readable outcome message. */
  message: string;
  /** Typed data payload. */
  data: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// Argument Parsing
// ═══════════════════════════════════════════════════════════════════════════

/** Maximum number of parts when splitting steer arguments. */
const STEER_PARTS_LIMIT = 2;

/**
 * Parse a raw slash command argument string into subcommand and remainder.
 *
 * @param rawArgs - Raw argument string from the slash command handler.
 *
 * @returns Tuple of [subcommand, remainder].
 *
 * @example
 * ```typescript
 * parseSlashArgs("start full"); // ["start", "full"]
 * ```
 */
function parseSlashArgs(rawArgs: string): [string, string] {
  const trimmed = rawArgs.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return [trimmed, ""];
  }
  return [trimmed.slice(0, spaceIndex), trimmed.slice(spaceIndex + 1).trim()];
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared Action Dispatcher
// ═══════════════════════════════════════════════════════════════════════════

/** Valid start scopes. */
const VALID_SCOPES = new Set<string>([
  "analysis",
  "planning",
  "architecture",
  "implementation",
  "full",
]);

/**
 * Validate and coerce a scope string to a StartScope.
 *
 * @param rawScope - The raw scope string from user input.
 *
 * @returns A validated StartScope value.
 *
 * @example
 * ```typescript
 * validateScope("full"); // "full"
 * validateScope("invalid"); // "full"
 * ```
 */
function validateScope(rawScope: string | undefined): StartScope {
  const scope = rawScope ?? "full";
  if (VALID_SCOPES.has(scope)) {
    // Safe narrowing: VALID_SCOPES contains exactly the StartScope values.
    return scope as StartScope; // eslint-disable-line @typescript-eslint/consistent-type-assertions -- Safe narrowing after Set.has() guard.
  }
  return "full";
}

/**
 * Dispatch a start action with validated scope.
 *
 * @param params - Parsed parameters containing optional scope.
 * @param actions - OrchestratorActions boundary.
 *
 * @returns A structured CommandResult.
 *
 * @example
 * ```typescript
 * await dispatchStartAction({ scope: "full" }, actions);
 * ```
 */
async function dispatchStartAction(
  params: Record<string, string | undefined>,
  actions: OrchestratorActions,
): Promise<CommandResult> {
  return actions.start(validateScope(params["scope"]));
}

/**
 * Dispatch a steer action with session and message parameters.
 *
 * @param params - Parsed parameters containing sessionId and message.
 * @param actions - OrchestratorActions boundary.
 *
 * @returns A structured CommandResult.
 *
 * @example
 * ```typescript
 * await dispatchSteerAction({ sessionId: "s1", message: "hello" }, actions);
 * ```
 */
async function dispatchSteerAction(
  params: Record<string, string | undefined>,
  actions: OrchestratorActions,
): Promise<CommandResult> {
  const sessionId = params["sessionId"] ?? "";
  const message = params["message"] ?? "";
  return actions.steer(sessionId, message);
}

/**
 * Dispatch a lifecycle action (pause/resume/abort/escalate).
 *
 * @param actionName - One of pause, resume, abort, or escalate.
 * @param params - Parsed parameters.
 * @param actions - OrchestratorActions boundary.
 *
 * @returns A structured CommandResult.
 *
 * @example
 * ```typescript
 * await dispatchLifecycleAction("pause", {}, actions);
 * ```
 */
async function dispatchLifecycleAction(
  actionName: string,
  params: Record<string, string | undefined>,
  actions: OrchestratorActions,
): Promise<CommandResult> {
  switch (actionName) {
    case "pause": {
      return actions.pause();
    }
    case "resume": {
      return actions.resume();
    }
    case "abort": {
      return actions.abort(params["reason"]);
    }
    case "escalate": {
      return actions.escalate(params["reason"]);
    }
    default: {
      return { success: false, message: `Unknown lifecycle action: ${actionName}`, data: {} };
    }
  }
}

/** Set of lifecycle action names that delegate to dispatchLifecycleAction. */
const LIFECYCLE_ACTIONS = new Set<string>(["pause", "resume", "abort", "escalate"]);

/**
 * Dispatch an action to the appropriate OrchestratorActions method.
 *
 * Shared by both slash commands and tool execution to guarantee
 * equivalent behavior (AC-1).
 *
 * @param actionName - The action to perform.
 * @param params - Parsed parameters.
 * @param actions - OrchestratorActions boundary.
 *
 * @returns A structured CommandResult.
 *
 * @example
 * ```typescript
 * await dispatchAction("status", {}, actions);
 * ```
 */
async function dispatchAction(
  actionName: string,
  params: Record<string, string | undefined>,
  actions: OrchestratorActions,
): Promise<CommandResult> {
  if (actionName === "start") {
    return dispatchStartAction(params, actions);
  }
  if (actionName === "status") {
    return actions.status();
  }
  if (actionName === "list") {
    return actions.list();
  }
  if (actionName === "steer") {
    return dispatchSteerAction(params, actions);
  }
  if (LIFECYCLE_ACTIONS.has(actionName)) {
    return dispatchLifecycleAction(actionName, params, actions);
  }
  if (actionName === "result") {
    return { success: true, message: "Pipeline result", data: actions.result() };
  }
  return { success: false, message: `Unknown action: ${actionName}`, data: {} };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Result Builder
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build tool-compatible result from command result.
 *
 * @param commandResult - The structured result from action dispatch.
 *
 * @returns Tool execution result with content blocks.
 *
 * @example
 * ```typescript
 * buildToolResult({ success: true, message: "ok", data: {} });
 * ```
 */
function buildToolResult(commandResult: CommandResult): {
  content: ToolContentBlock[];
} {
  const prefix = commandResult.success ? "✓" : "✗";
  return {
    content: [{ type: "text" as const, text: `${prefix} ${commandResult.message}` }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Slash Command Argument Extraction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build parameters map for scope-bearing commands.
 *
 * @param actionName - Parsed subcommand.
 * @param remainder - Remaining argument text.
 * @param params - Mutable parameters record.
 *
 * @example
 * ```typescript
 * addScopeParam("start", "full", {});
 * ```
 */
function addScopeParam(
  actionName: string,
  remainder: string,
  params: Record<string, string | undefined>,
): void {
  if (actionName === "start" && remainder.length > 0) {
    params["scope"] = remainder;
  }
}

/**
 * Build parameters map for reason-bearing commands.
 *
 * @param actionName - Parsed subcommand.
 * @param remainder - Remaining argument text.
 * @param params - Mutable parameters record.
 *
 * @example
 * ```typescript
 * addReasonParam("abort", "manual stop", {});
 * ```
 */
function addReasonParam(
  actionName: string,
  remainder: string,
  params: Record<string, string | undefined>,
): void {
  if ((actionName === "abort" || actionName === "escalate") && remainder.length > 0) {
    params["reason"] = remainder;
  }
}

/**
 * Build parameters map for steer commands.
 *
 * @param actionName - Parsed subcommand.
 * @param remainder - Remaining argument text.
 * @param params - Mutable parameters record.
 *
 * @example
 * ```typescript
 * addSteerParams("steer", "sess-1 hello", {});
 * ```
 */
function addSteerParams(
  actionName: string,
  remainder: string,
  params: Record<string, string | undefined>,
): void {
  if (actionName === "steer") {
    const steerParts = remainder.split(/\s+/, STEER_PARTS_LIMIT);
    params["sessionId"] = steerParts[0] ?? "";
    params["message"] =
      steerParts.length > 1 ? remainder.slice((steerParts[0] ?? "").length).trim() : "";
  }
}

/**
 * Build parameters map from a slash command subcommand and remainder.
 *
 * @param actionName - Parsed subcommand.
 * @param remainder - Remaining argument text after subcommand.
 *
 * @returns Parameters record for dispatch.
 *
 * @example
 * ```typescript
 * buildSlashParams("start", "full"); // { scope: "full" }
 * ```
 */
function buildSlashParams(
  actionName: string,
  remainder: string,
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  addScopeParam(actionName, remainder, params);
  addReasonParam(actionName, remainder, params);
  addSteerParams(actionName, remainder, params);
  return params;
}

// ═══════════════════════════════════════════════════════════════════════════
// Slash Command Registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register all orchestrator slash commands with the Pi extension API.
 *
 * Commands delegate to `OrchestratorActions` methods — the single
 * surface boundary. No command directly mutates state or worker pool.
 *
 * @param piApi - Pi extension API for command registration.
 * @param deps - Dependencies containing OrchestratorActions.
 *
 * @example
 * ```typescript
 * registerSlashCommands(piApi, { actions });
 * ```
 */
export function registerSlashCommands(piApi: PiCommandApi, deps: SlashCommandDeps): void {
  const { actions } = deps;

  piApi.registerCommand("pipeline", {
    description:
      "Pipeline orchestrator: start | status | list | steer | pause | resume | abort | escalate | result",
    handler: async (rawArgs: string): Promise<void> => {
      const [subcommand, remainder] = parseSlashArgs(rawArgs);
      const actionName = subcommand.length > 0 ? subcommand : "status";
      const params = buildSlashParams(actionName, remainder);
      await dispatchAction(actionName, params, actions);
    },
  });
}

/**
 * Dispatch an action and build a tool result — shared entry for tool registration.
 *
 * @param actionName - The action to dispatch.
 * @param params - Parameters for the action.
 * @param actions - OrchestratorActions boundary.
 *
 * @returns Tool-formatted result with content blocks.
 *
 * @example
 * ```typescript
 * await dispatchAndBuildToolResult("status", {}, actions);
 * ```
 */
export async function dispatchAndBuildToolResult(
  actionName: string,
  params: Record<string, string | undefined>,
  actions: OrchestratorActions,
): Promise<{ content: { type: "text"; text: string }[] }> {
  const commandResult = await dispatchAction(actionName, params, actions);
  return buildToolResult(commandResult);
}
