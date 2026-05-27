/**
 * Deep path resolver for the pi-orchestrator package.
 *
 * Resolves all filesystem paths from three roots — packageRoot (immutable
 * assets), projectRoot (managed repository), and env overrides — then
 * creates required directories.
 *
 * Resolution rules (see Section 5.2 of the refactor plan):
 *
 * 1. PackageRoot is supplied by caller (dirname of this package).
 * 2. ProjectRoot is supplied by caller (Pi session cwd).
 * 3. StateRoot is env override or projectRoot/.pi/orchestrator/.
 * 4. PromptPath is project override if exists, else package default.
 * 5. WorktreeBase is env ORCHESTRATOR_WORKTREE_BASE or projectRoot/.trees.
 */

import { join } from "node:path";
import { mkdir, access } from "node:fs/promises";

/**
 * All resolved filesystem paths used by the orchestrator runtime.
 */
export interface OrchestratorPaths {
  /** Where the pi-orchestrator package is installed (immutable assets). */
  readonly packageRoot: string;
  /** The managed project/repository root (Pi session cwd). */
  readonly projectRoot: string;
  /** Project-local orchestrator state directory. */
  readonly stateRoot: string;
  /** Pipeline state JSON file path. */
  readonly pipelineStatePath: string;
  /** Worktree registry JSON file path. */
  readonly worktreeRegistryPath: string;
  /** Audit log directory path. */
  readonly logRoot: string;
  /** Resolved prompt (project override \> package default). */
  readonly promptPath: string;
  /** Worker worktree base directory. */
  readonly worktreeBase: string;
  /** The pi-bmad extension path for child workers. */
  readonly piBmadExtensionPath: string;
  /** The pi-pi extension path for child workers. */
  readonly piPiExtensionPath: string;
  /** Returns the child project root within a worktree. */
  childProjectRoot(worktreePath: string): string;
  /** Returns the child BMAD session state path within a worktree. */
  childBmadStatePath(worktreePath: string): string;
}

/**
 * Resolves all orchestrator paths from package root, project root, and env.
 *
 * Creates stateRoot and logRoot directories if missing.
 * Does NOT create worktreeBase — that is created lazily during provisioning.
 *
 * @param opts - Resolution options containing packageRoot, projectRoot, and env.
 *
 * @returns Resolved orchestrator paths object.
 *
 * @example
 * ```typescript
 * const paths = await resolveOrchestratorPaths({
 *   packageRoot: "/path/to/pi-orchestrator",
 *   projectRoot: "/path/to/project",
 *   env: process.env,
 * });
 * ```
 */
export async function resolveOrchestratorPaths(opts: {
  packageRoot: string;
  projectRoot: string;
  env: Record<string, string | undefined>;
}): Promise<OrchestratorPaths> {
  const { packageRoot, projectRoot, env } = opts;

  const stateRoot = env["ORCHESTRATOR_STATE_ROOT"] ?? join(projectRoot, ".pi", "orchestrator");

  const logRoot = join(stateRoot, "logs");

  const projectPromptOverride = join(stateRoot, "ORCHESTRATOR.md");
  const packageDefaultPrompt = join(packageRoot, "prompts", "ORCHESTRATOR.md");
  const promptOverrideExists = await fileExists(projectPromptOverride);
  const promptPath = promptOverrideExists ? projectPromptOverride : packageDefaultPrompt;

  const worktreeBase = env["ORCHESTRATOR_WORKTREE_BASE"] ?? join(projectRoot, ".trees");

  const piCodingAgentDir = env["PI_CODING_AGENT_DIR"] ?? "";
  const piBmadExtensionPath = join(projectRoot, "extensions", "pi-bmad.ts");
  const piPiExtensionPath = piCodingAgentDir
    ? join(piCodingAgentDir, "extensions", "pi-pi.ts")
    : "";

  await mkdir(stateRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });

  return buildPaths({
    packageRoot,
    projectRoot,
    stateRoot,
    logRoot,
    promptPath,
    worktreeBase,
    piBmadExtensionPath,
    piPiExtensionPath,
  });
}

/** Input for building the paths object. */
interface PathInputs {
  /** Package root directory. */
  packageRoot: string;
  /** Project root directory. */
  projectRoot: string;
  /** State root directory. */
  stateRoot: string;
  /** Log root directory. */
  logRoot: string;
  /** Resolved prompt path. */
  promptPath: string;
  /** Worktree base directory. */
  worktreeBase: string;
  /** Pi-bmad extension path. */
  piBmadExtensionPath: string;
  /** Pi-pi extension path. */
  piPiExtensionPath: string;
}

/**
 * Build the immutable paths object from resolved inputs.
 *
 * @param inputs - All resolved path components.
 *
 * @returns Complete OrchestratorPaths object.
 *
 * @example
 * ```typescript
 * const paths = buildPaths({ packageRoot, projectRoot, ... });
 * ```
 */
function buildPaths(inputs: PathInputs): OrchestratorPaths {
  return {
    packageRoot: inputs.packageRoot,
    projectRoot: inputs.projectRoot,
    stateRoot: inputs.stateRoot,
    pipelineStatePath: join(inputs.stateRoot, "pipeline-state.json"),
    worktreeRegistryPath: join(inputs.stateRoot, "worktree-registry.json"),
    logRoot: inputs.logRoot,
    promptPath: inputs.promptPath,
    worktreeBase: inputs.worktreeBase,
    piBmadExtensionPath: inputs.piBmadExtensionPath,
    piPiExtensionPath: inputs.piPiExtensionPath,
    childProjectRoot(worktreePath: string): string {
      return worktreePath;
    },
    childBmadStatePath(worktreePath: string): string {
      return join(worktreePath, ".pi", "state", "bmad", "session-state.json");
    },
  };
}

/**
 * Check if a file exists on disk.
 *
 * @param filePath - Absolute path to check.
 *
 * @returns True if the file exists.
 *
 * @example
 * ```typescript
 * const exists = await fileExists("/path/to/file");
 * ```
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
