/* eslint-disable max-lines -- Bootstrap is a central wiring module with many type definitions. */
/**
 * Runtime startup sequencer with discriminated result and state migration.
 *
 * All module factories are injectable via BootstrapDeps for testing.
 *
 * @see Section 5.6 of pi-package-refactor-plan.md
 */

import { loadConfig as defaultLoadConfig, type OrchestratorConfig } from "./config.js";
import {
  resolveOrchestratorPaths as defaultResolvePaths,
  type OrchestratorPaths,
} from "./shared/paths.js";
import {
  createEventBus as defaultCreateEventBus,
  type OrchestratorEventBus,
} from "./events/bus.js";
import {
  createPipelineStateManager as defaultCreateStateManager,
  type PipelineStateManager,
} from "./state/pipeline.js";
import {
  createAuthorizationPolicy as defaultCreateAuthorizationPolicy,
  type AuthorizationPolicy,
} from "./triage/authorization.js";
import { createAtomicJsonStore, type AtomicJsonStore } from "./shared/atomic-json.js";
import { createJsonlLogWriter } from "./shared/jsonl-log.js";
import type { PipelineResult, PipelineRunState } from "./shared/types.js";
import { createOrchestratorActions as createOrchestratorActionsFromDeps, type OrchestratorActions, type WorkerHandle } from "./actions.js";
export type {
  WorktreeRegistryPort,
  WorkerPoolPort,
  SchedulerPort,
  TriageEnginePort,
  OrchestratorRunPort,
} from "./bootstrap-ports.js";
import type {
  WorktreeRegistryPort,
  WorkerPoolPort,
  SchedulerPort,
  TriageEnginePort,
  OrchestratorRunPort,
} from "./bootstrap-ports.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Result of checking whether a tool is available. */
export interface ToolCheckResult {
  /** Tool binary name. */
  tool: string;
  /** Whether the tool is found on PATH. */
  available: boolean;
  /** Detected version string, or null. */
  version: string | null;
  /** Whether the detected version meets minimum requirements. */
  meetsMinimum: boolean;
  /** Whether this tool is required. */
  required: boolean;
  /** Error message if unavailable, or null. */
  error: string | null;
}

/** State migration result from ADR-009. */
export interface MigrationResult {
  /** Whether migration was performed. */
  migrated: boolean;
  /** Path to migration evidence log, or null. */
  evidence: string | null;
}

/** Discriminated bootstrap result. */
export type BootstrapResult = BootstrapReady | BootstrapSystemFailure;

/** Successful bootstrap. */
export interface BootstrapReady {
  /** Discriminator. */
  status: "ready";
  /** Config. */
  config: OrchestratorConfig;
  /** Paths. */
  paths: OrchestratorPaths;
  /** State manager. */
  stateManager: PipelineStateManager;
  /** Event bus. */
  eventBus: OrchestratorEventBus;
  /** Registry. */
  registry: WorktreeRegistryPort;
  /** Worker pool. */
  workerPool: WorkerPoolPort;
  /** Scheduler. */
  scheduler: SchedulerPort;
  /** Triage engine. */
  triageEngine: TriageEnginePort;
  /** Authorization. */
  authorization: AuthorizationPolicy;
  /** Run controller. */
  run: OrchestratorRunPort;
  /** Actions. */
  actions: OrchestratorActions;
  /** Tool health. */
  toolHealth: ToolCheckResult[];
  /** Dispose. */
  dispose(): Promise<void>;
}

/** Failed bootstrap. */
export interface BootstrapSystemFailure {
  /** Discriminator. */
  status: "system-failure";
  /** Config. */
  config: OrchestratorConfig;
  /** Paths. */
  paths: OrchestratorPaths;
  /** State manager. */
  stateManager: PipelineStateManager;
  /** Event bus. */
  eventBus: OrchestratorEventBus;
  /** Tool health. */
  toolHealth: ToolCheckResult[];
  /** Result. */
  result: PipelineResult;
  /** Dispose. */
  dispose(): Promise<void>;
}

/** Port for worktree registry. */
export interface BootstrapDeps {
  /** Load config. */
  loadConfig: (env: Record<string, string | undefined>) => OrchestratorConfig;
  /** Resolve paths. */
  resolvePaths: (opts: {
    /** Pkg root. */ packageRoot: string;
    /** Project root. */ projectRoot: string;
    /** Env. */ env: Record<string, string | undefined>;
  }) => Promise<OrchestratorPaths>;
  /** Create event bus. */
  createEventBus: (config: {
    /** Run ID. */ runId: string;
    /** Writer. */ logWriter?: {
      /** Append. */ append: (event: Record<string, unknown>) => Promise<void>;
      /** Close. */ close: () => Promise<void>;
    };
  }) => OrchestratorEventBus;
  /** Create state manager. */
  createStateManager: (deps: {
    /** Store. */ store: AtomicJsonStore<PipelineRunState>;
    /** Bus. */ eventBus: OrchestratorEventBus;
  }) => PipelineStateManager;
  /** Check tools. */
  checkToolHealth: (hasUI: boolean) => Promise<ToolCheckResult[]>;
  /** Migrate state. */
  migrateState: (opts: {
    /** Project root. */ projectRoot: string;
    /** State root. */ stateRoot: string;
  }) => Promise<MigrationResult>;
  /** Create registry. */
  createWorktreeRegistry: () => WorktreeRegistryPort;
  /** Create pool. */
  createWorkerPool: () => WorkerPoolPort;
  /** Create scheduler. */
  createScheduler: () => SchedulerPort;
  /** Create triage. */
  createTriageEngine: () => TriageEnginePort;
  /** Create auth. */
  createAuthorizationPolicy: () => AuthorizationPolicy;
  /** Create run. */
  createRunController: () => OrchestratorRunPort;
  /** Create actions. */
  createActions: () => OrchestratorActions;
}

/** Configuration options passed to the bootstrap sequencer. */
export interface BootstrapOptions {
  /** Project root. */
  projectRoot: string;
  /** Has UI. */
  hasUI: boolean;
  /** Env vars. */
  env?: Record<string, string | undefined>;
}

/** Process exit code returned when required tools are missing at startup. */
const SYSTEM_FAILURE_EXIT_CODE = 3;
/** @internal */
const RUN_ID_RADIX = 36;
/** @internal */
const RUN_ID_SLICE_START = 2;
/** @internal */
const RUN_ID_SLICE_END = 8;

function resolvePackageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function generateRunId(): string {
  return (
    "run-" +
    String(Date.now()) +
    "-" +
    Math.random().toString(RUN_ID_RADIX).slice(RUN_ID_SLICE_START, RUN_ID_SLICE_END)
  );
}

function generatePipelineId(projectRoot: string): string {
  return "pipeline-" + (projectRoot.split("/").pop() ?? "unknown");
}

function hasRequiredToolFailure(toolHealth: ToolCheckResult[]): boolean {
  return toolHealth.some((t) => t.required && (!t.available || !t.meetsMinimum));
}

function buildSystemFailureResult(
  runId: string,
  toolHealth: ToolCheckResult[],
  startedAt: string,
): PipelineResult {
  const missing = toolHealth.filter((t) => t.required && !t.available).map((t) => t.tool);
  return {
    status: "failed",
    runId,
    exitCode: SYSTEM_FAILURE_EXIT_CODE,
    message: "System failure: required tools missing -- " + missing.join(", "),
    evidenceRefs: [],
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
  };
}

function createDisposeFn(
  stateManager: PipelineStateManager,
  eventBus: OrchestratorEventBus,
  workerPool?: WorkerPoolPort,
): () => Promise<void> {
  let disposed = false;
  return async () => {
    if (disposed) {
      return;
    }
    disposed = true;
    try {
      if (workerPool) {
        await workerPool.killAll();
      }
    } catch {
      /* ok */
    }
    try {
      await stateManager.flush();
    } catch {
      /* ok */
    }
    try {
      await eventBus.close();
    } catch {
      /* ok */
    }
  };
}

function defaultMigrateState(migrateOpts: {
  projectRoot: string;
  stateRoot: string;
}): Promise<MigrationResult> {
  void migrateOpts;
  return Promise.resolve({ migrated: false, evidence: null });
}

/**
 * Default stub tool health checker.
 *
 * @param hasUI - Whether UI is available.
 *
 * @returns Healthy tool results.
 *
 * @example
 * ```typescript
 * const results = await defaultCheckToolHealth(false);
 * ```
 */
function defaultCheckToolHealth(hasUI: boolean): Promise<ToolCheckResult[]> {
  void hasUI;
  return Promise.resolve([
    {
      tool: "git",
      available: true,
      version: "unknown",
      meetsMinimum: true,
      required: true,
      error: null,
    },
    {
      tool: "tmux",
      available: true,
      version: "unknown",
      meetsMinimum: true,
      required: false,
      error: null,
    },
    {
      tool: "bun",
      available: true,
      version: "unknown",
      meetsMinimum: true,
      required: true,
      error: null,
    },
    {
      tool: "pi",
      available: true,
      version: "unknown",
      meetsMinimum: true,
      required: true,
      error: null,
    },
  ]);
}

function buildDefaultDeps(): BootstrapDeps {
  return {
    loadConfig: defaultLoadConfig,
    resolvePaths: defaultResolvePaths,
    createEventBus: defaultCreateEventBus,
    createStateManager: (d) => defaultCreateStateManager(d),
    checkToolHealth: defaultCheckToolHealth,
    migrateState: defaultMigrateState,
    createWorktreeRegistry: () => ({
      initialize: () => Promise.resolve(),
      snapshot: () => ({}),
      register: () => Promise.resolve(),
      transition: () => Promise.resolve(),
      heartbeat: () => Promise.resolve(),
      getEntry: () => undefined,
      getActiveEntries: () => [],
      removalDecision: () => ({ safe: true }),
    }),
    createWorkerPool: () => ({
      provision: () => Promise.reject(new Error("Worker pool not yet implemented")),
      steer: () => Promise.reject(new Error("Worker pool not yet implemented")),
      kill: () => Promise.resolve(),
      killAll: () => Promise.resolve(),
      getActiveWorkers: () => [] as WorkerHandle[],
      getWorkerCount: () => 0,
      onWorkerDone: () => () => {},
      onWorkerStale: () => () => {},
      dispose: () => {},
    }),
    createScheduler: () => ({
      planNext: () => Promise.resolve({ dispatches: [], blocked: [], gateResults: [], requiredApprovals: [], nextAction: null }),
    }),
    createTriageEngine: () => ({
      decideFailureResponse: () => ({ action: "block", reason: "Triage not yet implemented" }),
    }),
    createAuthorizationPolicy: defaultCreateAuthorizationPolicy,
    createRunController: () => {
      let paused = false;
      let running = false;
      return {
        start: () => { running = true; paused = false; return Promise.resolve(); },
        pause: () => { paused = true; },
        resume: () => { paused = false; },
        abort: () => { running = false; paused = false; return Promise.resolve(); },
        isPaused: () => paused,
        isRunning: () => running,
      };
    },
    createActions: () => {
      // Placeholder — buildReadyResult will override with real createOrchestratorActions
      throw new Error("R-S13: use buildReadyResult override");
    },
  };
}

/**
 * Bootstrap the orchestrator runtime.
 *
 * @param opts - Bootstrap options.
 * @param deps - Injectable factory dependencies.
 *
 * @returns BootstrapReady or BootstrapSystemFailure.
 *
 * @example
 * ```typescript
 * const result = await bootstrapOrchestrator({ projectRoot: "/project", hasUI: false });
 * ```
 * @example
 *
 * ```typescript
 * const result = await bootstrapOrchestrator({ projectRoot: "/project", hasUI: false });
 * ```
 * ```typescript
 * const result = await bootstrapOrchestrator({ projectRoot: "/project", hasUI: false });
 * ```
 */
export async function bootstrapOrchestrator(
  opts: BootstrapOptions,
  deps?: BootstrapDeps,
): Promise<BootstrapResult> {
  const resolvedDeps = deps ?? buildDefaultDeps();
  const resolvedEnv = opts.env ?? process.env;
  const startedAt = new Date().toISOString();
  const runId = generateRunId();
  const pipelineId = generatePipelineId(opts.projectRoot);

  const configEnv: Record<string, string | undefined> = {
    ...resolvedEnv,
    ORCHESTRATOR_HAS_UI: opts.hasUI ? "true" : "false",
  };
  const config = resolvedDeps.loadConfig(configEnv);
  const paths = await resolvedDeps.resolvePaths({
    packageRoot: resolvePackageRoot(),
    projectRoot: opts.projectRoot,
    env: resolvedEnv,
  });
  const auditLogWriter = createJsonlLogWriter(
    join(paths.logRoot, "events.jsonl"),
    { maxBytes: 50 * 1024 * 1024, maxFileCount: 5 },
  );
  const eventBus = resolvedDeps.createEventBus({ runId, logWriter: auditLogWriter });
  await resolvedDeps.migrateState({ projectRoot: opts.projectRoot, stateRoot: paths.stateRoot });
  const stateStore = createAtomicJsonStore<PipelineRunState>(paths.pipelineStatePath);
  const stateManager = resolvedDeps.createStateManager({ store: stateStore, eventBus });
  await stateManager.initialize(runId, pipelineId);
  const toolHealth = await resolvedDeps.checkToolHealth(opts.hasUI);

  if (hasRequiredToolFailure(toolHealth)) {
    return buildFailureResult({
      stateManager,
      eventBus,
      config,
      paths,
      toolHealth,
      runId,
      startedAt,
    });
  }
  return buildReadyResult({ resolvedDeps, config, paths, stateManager, eventBus, toolHealth });
}

/**
 * Build BootstrapSystemFailure result.
 *
 * @param params - Failure result parameters.
 *
 * @returns BootstrapSystemFailure.
 *
 * @example
 * ```typescript
 * const result = await buildFailureResult(params);
 * ```
 */
async function buildFailureResult(params: {
  /** State manager. */ stateManager: PipelineStateManager;
  /** Event bus. */ eventBus: OrchestratorEventBus;
  /** Config. */ config: OrchestratorConfig;
  /** Paths. */ paths: OrchestratorPaths;
  /** Tool health. */ toolHealth: ToolCheckResult[];
  /** Run ID. */ runId: string;
  /** Started at. */ startedAt: string;
}): Promise<BootstrapSystemFailure> {
  const { stateManager, eventBus, config, paths, toolHealth, runId, startedAt } = params;
  await stateManager.apply({
    kind: "set-status",
    status: "failed",
    reason: "System failure: required tools missing",
  });
  return {
    status: "system-failure",
    config,
    paths,
    stateManager,
    eventBus,
    toolHealth,
    result: buildSystemFailureResult(runId, toolHealth, startedAt),
    dispose: createDisposeFn(stateManager, eventBus),
  };
}

/**
 * Build BootstrapReady result.
 *
 * @param params - Ready result parameters.
 *
 * @returns BootstrapReady.
 *
 * @example
 * ```typescript
 * const result = buildReadyResult(params);
 * ```
 */
function buildReadyResult(params: {
  /** Deps. */ resolvedDeps: BootstrapDeps;
  /** Config. */ config: OrchestratorConfig;
  /** Paths. */ paths: OrchestratorPaths;
  /** State manager. */ stateManager: PipelineStateManager;
  /** Event bus. */ eventBus: OrchestratorEventBus;
  /** Tool health. */ toolHealth: ToolCheckResult[];
}): BootstrapReady {
  const { resolvedDeps, config, paths, stateManager, eventBus, toolHealth } = params;
  const workerPool = resolvedDeps.createWorkerPool();
  return {
    status: "ready",
    config,
    paths,
    stateManager,
    eventBus,
    registry: resolvedDeps.createWorktreeRegistry(),
    workerPool,
    scheduler: resolvedDeps.createScheduler(),
    triageEngine: resolvedDeps.createTriageEngine(),
    authorization: resolvedDeps.createAuthorizationPolicy(),
    run: resolvedDeps.createRunController(),
    actions: createOrchestratorActionsFromDeps({
      run: resolvedDeps.createRunController(),
      stateManager,
      workerPool: workerPool as unknown as import("./actions.js").WorkerPool,
      eventBus,
    }),
    toolHealth,
    dispose: createDisposeFn(stateManager, eventBus, workerPool),
  };
}
