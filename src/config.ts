/**
 * Static orchestrator configuration from environment variables.
 *
 * Pure, synchronous, no I/O. Reads only from the supplied env record —
 * never touches the global environment, filesystem, or child processes.
 *
 * Shape matches Section 5.1 of the pi-package refactor plan exactly.
 */

import { OrchestratorError } from "./shared/errors.js";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_WORKERS = 3;
const DEFAULT_MAX_STEERS_PER_STEP = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_ESCALATION_THRESHOLD = 3;
const DEFAULT_STALE_THRESHOLD_MS = 600_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_REVIEW_LOOPS = 3;

/** Default Pi agent installation directory (tilde-style, expanded by paths.ts). */
const DEFAULT_PI_CODING_AGENT_DIR = "~/.pi/agent";

const LOG_LEVEL_MAP: Readonly<Record<string, LogLevel>> = {
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

const CONFIG_ERROR_CODE = "CONFIG_INVALID";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Log verbosity level. */
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Triage policy configuration governing failure recovery bounds.
 */
export interface TriagePolicyConfig {
  /** Maximum steer attempts per workflow step before retry. */
  maxSteersPerStep: number;
  /** Maximum retry attempts per dispatch before blocking. */
  maxRetries: number;
  /** Blocked stories per sprint before escalation triggers. */
  escalationThreshold: number;
  /** Milliseconds without heartbeat before marking a worker stale. */
  staleThresholdMs: number;
  /** Milliseconds before prompt timeout in headless mode. */
  promptTimeoutMs: number;
  /** Maximum review loopback transitions per story. */
  maxReviewLoops: number;
}

/**
 * Orchestrator runtime configuration parsed from environment variables.
 *
 * This is a pure data record — no path resolution, no filesystem access.
 * Override paths are stored as-is for downstream resolution by paths module.
 */
export interface OrchestratorConfig {
  /** Maximum number of concurrent worker sessions. */
  maxWorkers: number;
  /** Log verbosity level controlling event output. */
  logLevel: LogLevel;
  /** Whether the session has a UI for headed mode. */
  hasUI: boolean;
  /** Triage policy governing failure recovery decisions. */
  triage: TriagePolicyConfig;
  /** Optional worktree base directory override, or null if not set. */
  worktreeBaseOverride: string | null;
  /** Optional state root directory override, or null if not set. */
  stateRootOverride: string | null;
  /** Absolute path to the Pi coding agent installation directory (tilde-style). */
  piCodingAgentDir: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loads and validates orchestrator configuration from a supplied env record.
 *
 * @param env - Environment variable record to read configuration from.
 *
 * @returns A validated OrchestratorConfig with defaults applied for missing optional values.
 *
 * @throws OrchestratorError with code CONFIG_INVALID when a required variable is missing or a value fails validation.
 *
 * @example
 * ```typescript
 * const config = loadConfig({ PI_CODING_AGENT_DIR: "/opt/pi" });
 * ```
 */
export function loadConfig(env: Record<string, string | undefined>): OrchestratorConfig {
  const piCodingAgentDir = parsePiCodingAgentDir(env);

  return {
    maxWorkers: parsePositiveInteger(env, "ORCHESTRATOR_MAX_WORKERS", DEFAULT_MAX_WORKERS),
    logLevel: parseLogLevel(env),
    hasUI: parseBoolean(env, "ORCHESTRATOR_HAS_UI", false),
    triage: parseTriagePolicy(env),
    worktreeBaseOverride: parseOptionalString(env, "ORCHESTRATOR_WORKTREE_BASE"),
    stateRootOverride: parseOptionalString(env, "ORCHESTRATOR_STATE_ROOT"),
    piCodingAgentDir,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal Parsers — all pure, all synchronous, no JSDoc (private)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses PI_CODING_AGENT_DIR with optional fallback to default.
 *
 * Unlike requireNonEmptyString, this does NOT throw when unset — it uses
 * DEFAULT_PI_CODING_AGENT_DIR (~/.pi/agent) for zero-config operation.
 * Note: The tilde is not expanded here — paths.ts handles that.
 *
 * @param env - Environment variable record.
 *
 * @returns The PI_CODING_AGENT_DIR value or the default.
 *
 * @example
 * ```typescript
 * const dir = parsePiCodingAgentDir(env);
 * ```
 */
function parsePiCodingAgentDir(env: Record<string, string | undefined>): string {
  const value = env["PI_CODING_AGENT_DIR"];
  if (value !== undefined && value !== "") {
    return value;
  }
  return DEFAULT_PI_CODING_AGENT_DIR;
}

function parseOptionalString(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key];
  if (value === undefined || value === "") {
    return null;
  }
  return value;
}

function parsePositiveInteger(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key];
  if (raw === undefined) {
    return defaultValue;
  }

  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new OrchestratorError(
      `Invalid ${key} value: "${raw}" — must be a positive integer`,
      CONFIG_ERROR_CODE,
      { field: key, value: raw },
    );
  }
  return parsed;
}

function parseLogLevel(env: Record<string, string | undefined>): LogLevel {
  const raw = env["ORCHESTRATOR_LOG_LEVEL"];
  if (raw === undefined) {
    return "info";
  }
  const resolved = LOG_LEVEL_MAP[raw];
  if (resolved === undefined) {
    throw new OrchestratorError(
      `Invalid ORCHESTRATOR_LOG_LEVEL value: "${raw}" — must be one of: debug, info, warn, error`,
      CONFIG_ERROR_CODE,
      { field: "ORCHESTRATOR_LOG_LEVEL", value: raw },
    );
  }
  return resolved;
}

function parseBoolean(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: boolean,
): boolean {
  const raw = env[key];
  if (raw === undefined) {
    return defaultValue;
  }
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  throw new OrchestratorError(
    `Invalid ${key} value: "${raw}" — must be "true" or "false"`,
    CONFIG_ERROR_CODE,
    { field: key, value: raw },
  );
}

function parseTriagePolicy(env: Record<string, string | undefined>): TriagePolicyConfig {
  return {
    maxSteersPerStep: parsePositiveInteger(
      env,
      "ORCHESTRATOR_MAX_STEERS_PER_STEP",
      DEFAULT_MAX_STEERS_PER_STEP,
    ),
    maxRetries: parsePositiveInteger(env, "ORCHESTRATOR_MAX_RETRIES", DEFAULT_MAX_RETRIES),
    escalationThreshold: parsePositiveInteger(
      env,
      "ORCHESTRATOR_ESCALATION_THRESHOLD",
      DEFAULT_ESCALATION_THRESHOLD,
    ),
    staleThresholdMs: parsePositiveInteger(
      env,
      "ORCHESTRATOR_STALE_THRESHOLD_MS",
      DEFAULT_STALE_THRESHOLD_MS,
    ),
    promptTimeoutMs: parsePositiveInteger(
      env,
      "ORCHESTRATOR_PROMPT_TIMEOUT_MS",
      DEFAULT_PROMPT_TIMEOUT_MS,
    ),
    maxReviewLoops: parsePositiveInteger(
      env,
      "ORCHESTRATOR_MAX_REVIEW_LOOPS",
      DEFAULT_MAX_REVIEW_LOOPS,
    ),
  };
}
