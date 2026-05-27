/**
 * Orchestrate tool registration for the Pi extension API.
 *
 * Kept inside `extension/` to satisfy the `extension-schemas-private-locality`
 * dependency boundary: only files in `extension/` may import `extension/schemas.ts`.
 *
 * @see R-S14 AC-1 for slash/tool equivalence
 */

import { dispatchAndBuildToolResult, type SlashCommandDeps } from "../slash/commands.js";
import { orchestrateToolParameters, ORCHESTRATE_TOOL_NAME } from "./schemas.js";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal Pi extension API surface for tool registration. */
interface PiToolApi {
  /** Register an LLM-callable tool. */
  registerTool(tool: {
    /** Tool name. */
    name: string;
    /** Display label. */
    label: string;
    /** Tool description. */
    description: string;
    /** TypeBox parameter schema. */
    parameters: unknown;
    /** Tool execute handler. */
    execute: (...args: unknown[]) => Promise<unknown>;
  }): void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool Registration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract tool action parameters from raw tool execute arguments.
 *
 * @param args - Raw arguments passed to tool.execute.
 *
 * @returns Tuple of [actionName, params].
 *
 * @example
 * ```typescript
 * extractToolParams(["call-1", { action: "start", scope: "full" }]);
 * ```
 */
function extractToolParams(args: unknown[]): [string, Record<string, string | undefined>] {
  const rawParams = args[1];
  if (typeof rawParams === "object" && rawParams !== null) {
    const params = rawParams as Record<string, string | undefined>;
    const actionName = params["action"] ?? "status";
    return [actionName, params];
  }
  return ["status", {}];
}

/**
 * Register the orchestrate tool with the Pi extension API.
 *
 * The tool is the programmatic sibling of the slash commands.
 * Both route through the same dispatch pipeline to guarantee equivalence (AC-1).
 *
 * @param piApi - Pi extension API for tool registration.
 * @param deps - Dependencies containing OrchestratorActions.
 *
 * @example
 * ```typescript
 * registerOrchestrateTool(piApi, { actions });
 * ```
 */
export function registerOrchestrateTool(piApi: PiToolApi, deps: SlashCommandDeps): void {
  const { actions } = deps;

  piApi.registerTool({
    name: ORCHESTRATE_TOOL_NAME,
    label: "Pipeline Orchestrator",
    description:
      "Supervise BMAD pipeline runs: start, status, list, steer, pause, resume, abort, escalate, result",
    parameters: orchestrateToolParameters,
    async execute(...args: unknown[]): Promise<{ content: { type: "text"; text: string }[] }> {
      const [actionName, params] = extractToolParams(args);
      return dispatchAndBuildToolResult(actionName, params, actions);
    },
  });
}
