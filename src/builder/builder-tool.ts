/**
 * Builder tools for creating/editing pi-bmad workflows, agents, and checkpoints.
 *
 * These tools dispatch builder workflows to child workers, collect typed
 * HeadlessWorkflowOutput results, and merge completed work back to main.
 *
 * @see C1: orchestrate_builder (workflows)
 * @see C2: orchestrate_agent (agents)
 * @see C3: orchestrate_checkpoint (checkpoints)
 */

import type { ActionResult } from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Builder Tool Types
// ═══════════════════════════════════════════════════════════════════════════

/** Parameters for the orchestrate_builder tool (workflow CRUD). */
export interface WorkflowBuilderParams {
  /** Action to perform. */
  action: "create-workflow" | "edit-workflow" | "list-workflows";
  /** Workflow ID for edit operations. */
  workflowId?: string;
  /** Name for new workflow creation. */
  name?: string;
  /** Description for new workflow. */
  description?: string;
  /** Step name hints for new workflow. */
  steps?: string[];
  /** Owning agent for new workflow. */
  agent?: string;
  /** BMAD phase for new workflow. */
  phase?: string;
}

/** Parameters for the orchestrate_agent tool (agent CRUD). */
export interface AgentBuilderParams {
  /** Action to perform. */
  action: "create-agent" | "edit-agent" | "list-agents";
  /** Agent ID for edit operations. */
  agentId?: string;
  /** Name for new agent. */
  name?: string;
  /** Description for new agent. */
  description?: string;
  /** Domain areas for new agent. */
  expertise?: string[];
  /** Artifact paths owned by new agent. */
  ownedArtifacts?: string[];
}

/** Parameters for the orchestrate_checkpoint tool (checkpoint CRUD). */
export interface CheckpointBuilderParams {
  /** Action to perform. */
  action: "create-handler" | "edit-handler" | "list-handlers";
  /** Handler ID for edit operations. */
  handlerId?: string;
  /** Name for new handler. */
  name?: string;
  /** Description for new handler. */
  description?: string;
  /** What the handler validates. */
  validates?: string[];
}

/** Mapping from builder action to the pi-bmad builder workflow to dispatch. */
export const WORKFLOW_ACTION_MAP: Readonly<Record<string, string>> = {
  "create-workflow": "scaffold-workflow",
  "edit-workflow": "plan-workflow-content",
  "create-agent": "plan-agent-content",
  "edit-agent": "plan-agent-content",
  "create-handler": "scaffold-handler",
  "edit-handler": "scaffold-handler",
};

/** Mapping from builder action to the pi-bmad agent to activate. */
export const AGENT_ACTION_MAP: Readonly<Record<string, string>> = {
  "create-workflow": "orchestrator-developer",
  "edit-workflow": "orchestrator-developer",
  "create-agent": "orchestrator-developer",
  "edit-agent": "orchestrator-developer",
  "create-handler": "orchestrator-developer",
  "edit-handler": "orchestrator-developer",
};

// ═══════════════════════════════════════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate workflow builder parameters.
 *
 * @param params - The parameters to validate.
 *
 * @returns Error message if invalid, null if valid.
 */
export function validateWorkflowBuilderParams(params: WorkflowBuilderParams): string | null {
  if (params.action === "create-workflow" && (!params.name || params.name.trim() === "")) {
    return "name is required for create-workflow";
  }
  if (params.action === "edit-workflow" && (!params.workflowId || params.workflowId.trim() === "")) {
    return "workflowId is required for edit-workflow";
  }
  return null;
}

/**
 * Validate agent builder parameters.
 *
 * @param params - The parameters to validate.
 *
 * @returns Error message if invalid, null if valid.
 */
export function validateAgentBuilderParams(params: AgentBuilderParams): string | null {
  if (params.action === "create-agent" && (!params.name || params.name.trim() === "")) {
    return "name is required for create-agent";
  }
  if (params.action === "edit-agent" && (!params.agentId || params.agentId.trim() === "")) {
    return "agentId is required for edit-agent";
  }
  return null;
}

/**
 * Validate checkpoint builder parameters.
 *
 * @param params - The parameters to validate.
 *
 * @returns Error message if invalid, null if valid.
 */
export function validateCheckpointBuilderParams(params: CheckpointBuilderParams): string | null {
  if (params.action === "create-handler" && (!params.name || params.name.trim() === "")) {
    return "name is required for create-handler";
  }
  if (params.action === "edit-handler" && (!params.handlerId || params.handlerId.trim() === "")) {
    return "handlerId is required for edit-handler";
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Builder Command Construction
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the CLI command for dispatching a builder workflow to a child worker.
 *
 * @param builderWorkflowId - The pi-bmad builder workflow to run.
 * @param builderAgentId - The pi-bmad agent to activate.
 * @param piCodingAgentDir - Path to the Pi coding agent installation.
 * @param piBmadExtensionPath - Path to the pi-bmad builder extension.
 *
 * @returns Argv array for spawning the child process.
 *
 * @example
 * ```typescript
 * const argv = buildDispatchCommand("scaffold-workflow", "orchestrator-developer", "~/.pi/agent", "./builder/pi-bmad-builder.ts");
 * ```
 */
export function buildDispatchCommand(
  builderWorkflowId: string,
  builderAgentId: string,
  piCodingAgentDir: string,
  piBmadExtensionPath: string,
): string[] {
  return [
    "pi",
    "--no-extensions",
    "--no-skills",
    "-e",
    `${piCodingAgentDir}/extensions/pi-pi.ts`,
    "-e",
    piBmadExtensionPath,
    "--model",
    "openai-codex/gpt-5.5",
    "--thinking",
    "xhigh",
    "-p",
    "--bmad-workflow",
    builderWorkflowId,
    "--bmad-agent",
    builderAgentId,
  ];
}

/**
 * Build a list action result from discovered files.
 *
 * @param category - "workflows", "agents", or "handlers".
 * @param items - Discovered item names.
 *
 * @returns ActionResult with the list.
 */
export function buildListResult(
  category: string,
  items: string[],
): ActionResult<{ items: string[] }> {
  return {
    success: true,
    message: `Found ${String(items.length)} ${category}`,
    data: { items },
  };
}
