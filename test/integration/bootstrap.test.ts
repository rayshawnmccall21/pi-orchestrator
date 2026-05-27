/**
 * Integration tests for bootstrapOrchestrator with real filesystem but mock modules.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  bootstrapOrchestrator,
  type BootstrapDeps,
  type ToolCheckResult,
} from "../../src/bootstrap.js";
import type { BootstrapReady, BootstrapSystemFailure } from "../../src/bootstrap.js";
import { loadConfig } from "../../src/config.js";
import { resolveOrchestratorPaths } from "../../src/shared/paths.js";
import { createEventBus } from "../../src/events/bus.js";
import { createAuthorizationPolicy } from "../../src/triage/authorization.js";
import type { PipelineStateManager, RecoveryResult } from "../../src/state/pipeline.js";

function createTempProjectRoot(): string {
  const tempDir = join(tmpdir(), "bootstrap-test-" + randomUUID());
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function createMinimalEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return { PI_CODING_AGENT_DIR: "/opt/pi-agent", ...overrides };
}

function healthyToolResults(): ToolCheckResult[] {
  return [
    {
      tool: "git",
      available: true,
      version: "2.40.0",
      meetsMinimum: true,
      required: true,
      error: null,
    },
    {
      tool: "tmux",
      available: true,
      version: "3.4",
      meetsMinimum: true,
      required: false,
      error: null,
    },
    {
      tool: "bun",
      available: true,
      version: "1.1.0",
      meetsMinimum: true,
      required: true,
      error: null,
    },
    {
      tool: "pi",
      available: true,
      version: "0.74.0",
      meetsMinimum: true,
      required: true,
      error: null,
    },
  ];
}

function failingToolResults(): ToolCheckResult[] {
  return [
    {
      tool: "git",
      available: false,
      version: null,
      meetsMinimum: false,
      required: true,
      error: "not found",
    },
    {
      tool: "bun",
      available: true,
      version: "1.0.0",
      meetsMinimum: true,
      required: true,
      error: null,
    },
  ];
}

function createMockStateManager(): PipelineStateManager {
  const freshState = {
    schemaVersion: "pipeline-run-state.v1" as const,
    pipelineId: "int-pipeline",
    runId: "int-run",
    status: "idle" as const,
    phase: "analysis" as const,
    activeStage: null,
    activeWorkflowId: null,
    activeStepId: null,
    activeStoryId: null,
    dispatches: [],
    childSessions: [],
    prompts: [],
    approvals: [],
    gateResults: [],
    artifactEvidence: [],
    storyLifecycles: {},
    retryCounts: {},
    events: [],
    blocker: null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    completedPhases: [],
  };
  let currentState = { ...freshState };
  return {
    getState: vi.fn(() => Object.freeze({ ...currentState })),
    apply: vi.fn(async (mutation: { kind: string; status?: string }) => {
      if (mutation.kind === "set-status" && mutation.status !== undefined) {
        currentState = {
          ...currentState,
          status: mutation.status as typeof currentState.status,
          updatedAt: new Date().toISOString(),
        };
      }
    }),
    initialize: vi.fn(async (_runId: string, pipelineId: string): Promise<RecoveryResult> => {
      currentState = { ...freshState, pipelineId };
      return { recovered: false, fromPersisted: false, quarantinedPath: null, runId: _runId };
    }),
    onStateChange: vi.fn(() => vi.fn()),
    flush: vi.fn(async () => {
      /* noop */
    }),
  };
}

function createIntegrationDeps(overrides?: Partial<BootstrapDeps>): BootstrapDeps {
  return {
    loadConfig,
    resolvePaths: resolveOrchestratorPaths,
    createEventBus: (config: { runId: string }) => createEventBus({ runId: config.runId }),
    createStateManager: vi.fn(() => createMockStateManager()),
    checkToolHealth: vi.fn(async () => healthyToolResults()),
    migrateState: vi.fn(async () => ({ migrated: false, evidence: null })),
    createWorktreeRegistry: vi.fn(() => ({
      initialize: vi.fn(async () => {
        /* noop */
      }),
      snapshot: vi.fn(),
      register: vi.fn(),
      transition: vi.fn(),
      heartbeat: vi.fn(),
      getEntry: vi.fn(),
      getActiveEntries: vi.fn(() => []),
      removalDecision: vi.fn(),
    })),
    createWorkerPool: vi.fn(() => ({
      provision: vi.fn(),
      steer: vi.fn(),
      kill: vi.fn(),
      killAll: vi.fn(async () => {
        /* noop */
      }),
      getActiveWorkers: vi.fn(() => []),
      getWorkerCount: vi.fn(() => 0),
      onWorkerDone: vi.fn(() => vi.fn()),
      onWorkerStale: vi.fn(() => vi.fn()),
      dispose: vi.fn(),
    })),
    createScheduler: vi.fn(() => ({ planNext: vi.fn() })),
    createTriageEngine: vi.fn(() => ({ decideFailureResponse: vi.fn() })),
    createAuthorizationPolicy,
    createRunController: vi.fn(() => ({
      start: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      abort: vi.fn(),
      isPaused: vi.fn(() => false),
      isRunning: vi.fn(() => false),
    })),
    createActions: vi.fn(() => ({
      start: vi.fn(),
      status: vi.fn(),
      list: vi.fn(),
      steer: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      abort: vi.fn(),
      escalate: vi.fn(),
      result: vi.fn(),
    })),
    ...overrides,
  };
}

describe("bootstrapOrchestrator", () => {
  let projectRoot: string;
  beforeEach(() => {
    projectRoot = createTempProjectRoot();
  });
  afterEach(async () => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  describe("AC-1: BootstrapReady", () => {
    it("returns status ready when all required tools are available", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      );
      expect(result.status).toBe("ready");
    });

    it("provides config, paths, stateManager, eventBus on ready", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      );
      expect(result.config).toBeDefined();
      expect(result.paths).toBeDefined();
      expect(result.stateManager).toBeDefined();
      expect(result.eventBus).toBeDefined();
    });

    it("provides registry, workerPool, scheduler on ready", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      )) as BootstrapReady;
      expect(result.registry).toBeDefined();
      expect(result.workerPool).toBeDefined();
      expect(result.scheduler).toBeDefined();
    });

    it("provides triageEngine, authorization, run, actions on ready", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      )) as BootstrapReady;
      expect(result.triageEngine).toBeDefined();
      expect(result.authorization).toBeDefined();
      expect(result.run).toBeDefined();
      expect(result.actions).toBeDefined();
    });

    it("provides toolHealth array and dispose function on ready", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      )) as BootstrapReady;
      expect(Array.isArray(result.toolHealth)).toBe(true);
      expect(typeof result.dispose).toBe("function");
    });

    it("creates state root directory on disk", async () => {
      await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      );
      expect(existsSync(join(projectRoot, ".pi", "orchestrator"))).toBe(true);
    });

    it("dispose is safe to call on ready", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      )) as BootstrapReady;
      await result.dispose();
    });
  });

  describe("AC-2: BootstrapSystemFailure", () => {
    it("returns system-failure when required tool is missing", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps({ checkToolHealth: vi.fn(async () => failingToolResults()) }),
      );
      expect(result.status).toBe("system-failure");
    });

    it("system-failure includes PipelineResult with exitCode 3", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps({ checkToolHealth: vi.fn(async () => failingToolResults()) }),
      )) as BootstrapSystemFailure;
      expect(result.result.exitCode).toBe(3);
      expect(result.result.status).toBe("failed");
    });

    it("system-failure does NOT have dispatch-capable modules", async () => {
      const deps = createIntegrationDeps({
        checkToolHealth: vi.fn(async () => failingToolResults()),
      });
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        deps,
      )) as BootstrapSystemFailure;
      expect("workerPool" in result).toBe(false);
      expect("scheduler" in result).toBe(false);
      expect("run" in result).toBe(false);
    });

    it("system-failure applies set-status failed mutation", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps({ checkToolHealth: vi.fn(async () => failingToolResults()) }),
      );
      const state = result.stateManager.getState();
      expect(state.status).toBe("failed");
    });

    it("system-failure dispose is safe", async () => {
      const result = (await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps({ checkToolHealth: vi.fn(async () => failingToolResults()) }),
      )) as BootstrapSystemFailure;
      await result.dispose();
    });
  });

  describe("AC-3: ADR-009 migration", () => {
    it("calls migrateState with projectRoot and stateRoot", async () => {
      const migrateMock = vi.fn(async () => ({ migrated: false, evidence: null }));
      await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps({ migrateState: migrateMock }),
      );
      expect(migrateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRoot,
          stateRoot: join(projectRoot, ".pi", "orchestrator"),
        }),
      );
    });
  });

  describe("tool health", () => {
    it("toolHealth array has check results", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: false, env: createMinimalEnv() },
        createIntegrationDeps(),
      );
      expect(result.toolHealth.length).toBeGreaterThan(0);
    });
  });

  describe("config pass-through", () => {
    it("passes hasUI to config", async () => {
      const result = await bootstrapOrchestrator(
        { projectRoot, hasUI: true, env: createMinimalEnv() },
        createIntegrationDeps(),
      );
      expect(result.config.hasUI).toBe(true);
    });
  });
});
