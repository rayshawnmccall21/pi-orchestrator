/**
 * Tests for builder tools: workflow, agent, and checkpoint CRUD.
 */
import { describe, it, expect } from "vitest";
import {
  validateWorkflowBuilderParams,
  validateAgentBuilderParams,
  validateCheckpointBuilderParams,
  buildDispatchCommand,
  buildListResult,
  WORKFLOW_ACTION_MAP,
  AGENT_ACTION_MAP,
} from "../../../src/builder/builder-tool.js";

describe("validateWorkflowBuilderParams", () => {
  it("returns null for valid create-workflow", () => {
    expect(validateWorkflowBuilderParams({ action: "create-workflow", name: "my-wf" })).toBeNull();
  });

  it("returns error when name missing for create-workflow", () => {
    expect(validateWorkflowBuilderParams({ action: "create-workflow" })).toContain("name is required");
  });

  it("returns null for valid edit-workflow", () => {
    expect(validateWorkflowBuilderParams({ action: "edit-workflow", workflowId: "dev-story" })).toBeNull();
  });

  it("returns error when workflowId missing for edit-workflow", () => {
    expect(validateWorkflowBuilderParams({ action: "edit-workflow" })).toContain("workflowId is required");
  });

  it("returns null for list-workflows (no params needed)", () => {
    expect(validateWorkflowBuilderParams({ action: "list-workflows" })).toBeNull();
  });
});

describe("validateAgentBuilderParams", () => {
  it("returns null for valid create-agent", () => {
    expect(validateAgentBuilderParams({ action: "create-agent", name: "my-agent" })).toBeNull();
  });

  it("returns error when name missing for create-agent", () => {
    expect(validateAgentBuilderParams({ action: "create-agent" })).toContain("name is required");
  });

  it("returns null for valid edit-agent", () => {
    expect(validateAgentBuilderParams({ action: "edit-agent", agentId: "dev" })).toBeNull();
  });

  it("returns error when agentId missing for edit-agent", () => {
    expect(validateAgentBuilderParams({ action: "edit-agent" })).toContain("agentId is required");
  });
});

describe("validateCheckpointBuilderParams", () => {
  it("returns null for valid create-handler", () => {
    expect(validateCheckpointBuilderParams({ action: "create-handler", name: "my-check" })).toBeNull();
  });

  it("returns error when name missing for create-handler", () => {
    expect(validateCheckpointBuilderParams({ action: "create-handler" })).toContain("name is required");
  });

  it("returns null for valid edit-handler", () => {
    expect(validateCheckpointBuilderParams({ action: "edit-handler", handlerId: "green-gate" })).toBeNull();
  });

  it("returns error when handlerId missing for edit-handler", () => {
    expect(validateCheckpointBuilderParams({ action: "edit-handler" })).toContain("handlerId is required");
  });
});

describe("WORKFLOW_ACTION_MAP", () => {
  it("maps create-workflow to scaffold-workflow", () => {
    expect(WORKFLOW_ACTION_MAP["create-workflow"]).toBe("scaffold-workflow");
  });

  it("maps edit-workflow to plan-workflow-content", () => {
    expect(WORKFLOW_ACTION_MAP["edit-workflow"]).toBe("plan-workflow-content");
  });

  it("maps create-agent to plan-agent-content", () => {
    expect(WORKFLOW_ACTION_MAP["create-agent"]).toBe("plan-agent-content");
  });

  it("maps create-handler to scaffold-handler", () => {
    expect(WORKFLOW_ACTION_MAP["create-handler"]).toBe("scaffold-handler");
  });
});

describe("AGENT_ACTION_MAP", () => {
  it("maps all builder actions to orchestrator-developer", () => {
    for (const agentId of Object.values(AGENT_ACTION_MAP)) {
      expect(agentId).toBe("orchestrator-developer");
    }
  });
});

describe("buildDispatchCommand", () => {
  it("builds argv array with correct flags", () => {
    const argv = buildDispatchCommand("scaffold-workflow", "orchestrator-developer", "/home/user/.pi/agent", "/project/builder/pi-bmad-builder.ts");
    expect(argv[0]).toBe("pi");
    expect(argv).toContain("--no-extensions");
    expect(argv).toContain("--no-skills");
    expect(argv).toContain("-p");
    expect(argv).toContain("--bmad-workflow");
    expect(argv).toContain("scaffold-workflow");
    expect(argv).toContain("--bmad-agent");
    expect(argv).toContain("orchestrator-developer");
  });

  it("includes pi-pi.ts extension path", () => {
    const argv = buildDispatchCommand("scaffold-workflow", "orchestrator-developer", "/home/.pi/agent", "/ext.ts");
    const piPiIndex = argv.indexOf("/home/.pi/agent/extensions/pi-pi.ts");
    expect(piPiIndex).toBeGreaterThan(-1);
    expect(argv[piPiIndex - 1]).toBe("-e");
  });

  it("includes pi-bmad builder extension path", () => {
    const argv = buildDispatchCommand("scaffold-workflow", "orchestrator-developer", "/home/.pi/agent", "/project/builder.ts");
    expect(argv).toContain("/project/builder.ts");
  });

  it("uses no raw shell interpolation — all argv elements are strings", () => {
    const argv = buildDispatchCommand("test", "test-agent", "/path", "/ext");
    for (const arg of argv) {
      expect(typeof arg).toBe("string");
      // No shell metacharacters
      expect(arg).not.toMatch(/[;|&$`]/);
    }
  });
});

describe("buildListResult", () => {
  it("builds a success result with item count", () => {
    const result = buildListResult("workflows", ["dev-story", "create-prd"]);
    expect(result.success).toBe(true);
    expect(result.message).toContain("2");
    expect(result.message).toContain("workflows");
    expect(result.data.items).toHaveLength(2);
  });

  it("handles empty list", () => {
    const result = buildListResult("agents", []);
    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(0);
  });
});
