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
 * 6. PiCodingAgentDir is env override or ~/.pi/agent (tilde-expanded).
 */

import { join, normalize } from "node:path";
import { mkdir, access } from "node:fs/promises";

/** Default Pi agent installation directory (before tilde expansion). */
const DEFAULT_PI_CODING_AGENT_DIR_TILDE = "~/.pi/agent";

/** Length of the tilde prefix "~/". */
const TILDE_PREFIX_LENGTH = 2;

/**
 * Expand ~ to the user's home directory using HOME environment variable.
 *
 * @param path - Path potentially starting with ~.
 *
 * @returns Path with ~ replaced by home directory, or original path if not starting with ~.
 *
 * @example
 * ```typescript
 * const expanded = expandTilde("~/.pi/agent"); // "/Users/name/.pi/agent"
 * ```
 */
function expandTilde(path: string): string {
  if (!path.startsWith("~/")) {
    return path;
  }
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";
  return normalize(join(home, path.slice(TILDE_PREFIX_LENGTH)));
}

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
  /** Resolved prompt (project override gt package default). */
  readonly promptPath: string;
  /** Worker worktree base directory. */
  readonly worktreeBase: string;
  /** The pi-coding-agent installation directory. */
  readonly piCodingAgentDir: string;
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

  // Resolve PI_CODING_AGENT_DIR with tilde expansion and default fallback
  const piCodingAgentDirRaw = env["PI_CODING_AGENT_DIR"];
  const piCodingAgentDir =
    piCodingAgentDirRaw !== undefined && piCodingAgentDirRaw !== ""
      ? expandTilde(piCodingAgentDirRaw)
      : expandTilde(DEFAULT_PI_CODING_AGENT_DIR_TILDE);

  const piBmadExtensionPath = join(projectRoot, "extensions", "pi-bmad.ts");
  const piPiExtensionPath = join(piCodingAgentDir, "extensions", "pi-pi.ts");

  await mkdir(stateRoot, { recursive: true });
  await mkdir(logRoot, { recursive: true });

  return buildPaths({
    packageRoot,
    projectRoot,
    stateRoot,
    logRoot,
    promptPath,
    worktreeBase,
    piCodingAgentDir,
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
  /** Pi coding agent installation directory. */
  piCodingAgentDir: string;
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
    piCodingAgentDir: inputs.piCodingAgentDir,
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
