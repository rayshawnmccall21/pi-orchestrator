/**
 * pi-orchestrator Pi extension entry point.
 *
 * Registered via pi.extensions in package.json.
 *
 * @see AC-4 of R-S15
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BootstrapResult, BootstrapReady } from "../bootstrap.js";

/** Minimal Pi ExtensionAPI surface consumed by the orchestrator. */
interface PiExtensionAPI {
  /** Register a lifecycle hook. */
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  /** Register a slash command. */
  registerCommand(
    name: string,
    options: {
      /** Desc. */ description?: string;
      /** Handler. */ handler: (args: string, ctx: unknown) => Promise<void>;
    },
  ): void;
  /** Register an LLM-callable tool. */
  registerTool(tool: {
    /** Name. */ name: string;
    /** Label. */ label: string;
    /** Desc. */ description: string;
    /** Schema. */ parameters: unknown;
    /** Execute. */ execute: (...args: unknown[]) => Promise<unknown>;
  }): void;
}

/** Content block returned by tool execution. */
interface ToolContent {
  /** Type. */ type: string;
  /** Text. */ text: string;
}

/** Resolve package root from module location. */
function resolvePackageRoot(): string {
  const extensionDir = dirname(fileURLToPath(import.meta.url));
  return dirname(dirname(extensionDir));
}

/** Frontmatter fence offset. */
const FRONTMATTER_OFFSET = 3;

/**
 * Load orchestrator prompt from disk, stripping YAML frontmatter.
 *
 * @param promptPath - Absolute path to the ORCHESTRATOR.md file.
 *
 * @returns The prompt content with frontmatter removed.
 *
 * @example
 * ```typescript
 * const prompt = loadOrchestratorPrompt("/path/to/ORCHESTRATOR.md");
 * ```
 */
function loadOrchestratorPrompt(promptPath: string): string {
  if (!existsSync(promptPath)) {
    return "You are the Pipeline Orchestrator. No ORCHESTRATOR.md found.";
  }
  const rawContent = readFileSync(promptPath, "utf-8");
  const firstFence = rawContent.indexOf("---");
  const secondFence =
    firstFence >= 0 ? rawContent.indexOf("---", firstFence + FRONTMATTER_OFFSET) : -1;
  return secondFence > 0 ? rawContent.slice(secondFence + FRONTMATTER_OFFSET).trim() : rawContent;
}

/** Resolve prompt path from bootstrap result or package default. */
function resolvePromptPath(bootstrapResult: BootstrapResult | null, packageRoot: string): string {
  if (bootstrapResult?.status === "ready") {
    return bootstrapResult.paths.promptPath;
  }
  return join(packageRoot, "prompts", "ORCHESTRATOR.md");
}

/** Action handler map keyed by action name. */
const ACTION_HANDLERS: Record<
  string,
  | ((
      params: Record<string, string | undefined>,
      actions: BootstrapReady["actions"],
    ) => Promise<{ content: ToolContent[] }>)
  | undefined
> = {
  start: async (params, actions) => {
    const scope = (params["scope"] ?? "full") as
      | "analysis"
      | "planning"
      | "architecture"
      | "implementation"
      | "full";
    const actionResult = await actions.start(scope);
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  status: async (_params, actions) => {
    const actionResult = actions.status();
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  list: async (_params, actions) => {
    const actionResult = actions.list();
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  steer: async (params, actions) => {
    const actionResult = await actions.steer(params["sessionId"] ?? "", params["message"] ?? "");
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  pause: async (_params, actions) => {
    const actionResult = await actions.pause();
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  resume: async (_params, actions) => {
    const actionResult = await actions.resume();
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  abort: async (params, actions) => {
    const actionResult = await actions.abort(params["message"]);
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  escalate: async (params, actions) => {
    const actionResult = await actions.escalate(params["message"]);
    return { content: [{ type: "text", text: actionResult.message }] };
  },
  result: async (_params, actions) => {
    const pipelineResult = actions.result();
    return { content: [{ type: "text", text: JSON.stringify(pipelineResult) }] };
  },
};

/**
 * Execute a tool action via the handler map.
 *
 * @param actionName - The action to perform.
 * @param params - The action parameters.
 * @param actions - The OrchestratorActions boundary.
 *
 * @returns Tool content result.
 *
 * @example
 * ```typescript
 * const result = await executeToolAction("status", {}, actions);
 * ```
 */
async function executeToolAction(
  actionName: string,
  params: Record<string, string | undefined>,
  actions: BootstrapReady["actions"],
): Promise<{ content: ToolContent[] }> {
  const handler = ACTION_HANDLERS[actionName];
  if (handler !== undefined) {
    return handler(params, actions);
  }
  return { content: [{ type: "text", text: "Unknown action: " + actionName }] };
}

/**
 * Handle the /orchestrate slash command.
 *
 * @param rawArgs - Raw argument string.
 * @param actions - The OrchestratorActions boundary.
 *
 * @example
 * ```typescript
 * await handleSlashCommand("start full", actions);
 * ```
 */
async function handleSlashCommand(
  rawArgs: string,
  actions: BootstrapReady["actions"],
): Promise<void> {
  const subcommand = rawArgs.trim().split(/\s+/)[0] ?? "status";
  switch (subcommand) {
    case "start":
      await actions.start("full");
      break;
    case "pause":
      await actions.pause();
      break;
    case "resume":
      await actions.resume();
      break;
    case "abort":
      await actions.abort(rawArgs.slice(subcommand.length).trim() || undefined);
      break;
    case "status":
    default:
      actions.status();
      break;
  }
}

/** Register the orchestrate tool. */
function registerOrchestratorTool(
  piApi: PiExtensionAPI,
  getResult: () => BootstrapResult | null,
): void {
  piApi.registerTool({
    name: "orchestrate",
    label: "Orchestrate",
    description: "Pipeline orchestration tool",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "Action to perform" },
        sessionId: { type: "string", description: "Target session ID" },
        message: { type: "string", description: "Steer message or abort reason" },
        scope: { type: "string", description: "Start scope" },
      },
      required: ["action"],
    },
    async execute(...args: unknown[]) {
      const bootstrapResult = getResult();
      if (bootstrapResult?.status !== "ready") {
        return { content: [{ type: "text", text: "Orchestrator not initialized" }] };
      }
      const params = (args[1] ?? {}) as Record<string, string | undefined>;
      return executeToolAction(params["action"] ?? "status", params, bootstrapResult.actions);
    },
  });
}

/**
 * Registers the pi-orchestrator extension with the Pi agent runtime.
 *
 * @param piApi - The Pi extension API provided by the host runtime.
 *
 * @example
 * ```typescript
 * registerPiOrchestratorExtension(piApi);
 * ```
 */
export default function registerPiOrchestratorExtension(piApi: PiExtensionAPI): void {
  let bootstrapResult: BootstrapResult | null = null;
  const packageRoot = resolvePackageRoot();

  piApi.on("session_start", async (_event: unknown, ctx: unknown) => {
    const extensionContext = ctx as { cwd: string; hasUI?: boolean } | undefined;
    const projectRoot = extensionContext?.cwd ?? process.cwd();
    const hasUI = extensionContext?.hasUI ?? false;
    const { bootstrapOrchestrator } = await import("../bootstrap.js");
    bootstrapResult = await bootstrapOrchestrator({ projectRoot, hasUI, env: process.env });
  });

  piApi.on("before_agent_start", async () => ({
    systemPrompt: loadOrchestratorPrompt(resolvePromptPath(bootstrapResult, packageRoot)),
  }));

  piApi.on("session_shutdown", async () => {
    if (bootstrapResult !== null) {
      await bootstrapResult.dispose();
      bootstrapResult = null;
    }
  });

  piApi.registerCommand("orchestrate", {
    description:
      "Pipeline orchestration: start, status, list, steer, pause, resume, abort, escalate, result",
    async handler(rawArgs: string, commandCtx: unknown) {
      void commandCtx;
      if (bootstrapResult?.status !== "ready") {
        return;
      }
      await handleSlashCommand(rawArgs, bootstrapResult.actions);
    },
  });

  registerOrchestratorTool(piApi, () => bootstrapResult);
}
