/**
 * TypeBox tool parameter schemas for the orchestrate extension tool.
 *
 * Defines the typed parameter schema consumed by `pi.registerTool()`.
 * Schema objects are pure data — no closures, no side effects.
 *
 * @see R-S14 AC-2 for validation behavior
 */

import { Type } from "typebox";

// ═══════════════════════════════════════════════════════════════════════════
// Tool Name Constant
// ═══════════════════════════════════════════════════════════════════════════

/** Stable tool name used for both registration and autocomplete matching. */
export const ORCHESTRATE_TOOL_NAME = "orchestrate" as const;

// ═══════════════════════════════════════════════════════════════════════════
// Tool Parameter Schema
// ═══════════════════════════════════════════════════════════════════════════

/**
 * TypeBox parameter schema for the orchestrate tool.
 *
 * The `action` field is a closed union of the 9 `OrchestratorActions` methods.
 * Optional fields provide context for specific actions (scope, sessionId, etc).
 *
 * @example
 * ```typescript
 * import { Value } from "typebox/value";
 * const isValid = Value.Check(orchestrateToolParameters, { action: "start", scope: "full" });
 * ```
 */
export const orchestrateToolParameters = Type.Object({
  action: Type.Union(
    [
      Type.Literal("start"),
      Type.Literal("status"),
      Type.Literal("list"),
      Type.Literal("steer"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("abort"),
      Type.Literal("escalate"),
      Type.Literal("result"),
    ],
    {
      description: "start | status | list | steer | pause | resume | abort | escalate | result",
    },
  ),
  scope: Type.Optional(
    Type.String({
      description:
        "Pipeline scope for start: analysis | planning | architecture | implementation | full",
    }),
  ),
  sessionId: Type.Optional(
    Type.String({
      description: "Target sessionId for steer action",
    }),
  ),
  message: Type.Optional(
    Type.String({
      description: "Steer message to send to the target worker session",
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: "Optional reason for abort or escalate",
    }),
  ),
});
