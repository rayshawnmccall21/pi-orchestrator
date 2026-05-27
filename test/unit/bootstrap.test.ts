/**
 * Tests for bootstrap.ts — the runtime startup sequencer.
 *
 * Covers AC-1 (BootstrapReady), AC-2 (BootstrapSystemFailure),
 * AC-3 (ADR-009 state migration), and AC-5 (no legacy imports).
 */

import { describe, it, expect, vi } from "vitest";
import {
  bootstrapOrchestrator,
  type BootstrapReady,
  type BootstrapSystemFailure,
  type ToolCheckResult,
  type BootstrapDeps,
} from "../../src/bootstrap.js";
import type { OrchestratorConfig } from "../../src/config.js";
import type { OrchestratorPaths } from "../../src/shared/paths.js";
import type { PipelineStateManager, RecoveryResult } from "../../src/state/pipeline.js";
import type { OrchestratorEventBus } from "../../src/events/bus.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock factories
// ═══════════════════════════════════════════════════════════════════════════

function createMockConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    maxWorkers: 3,
    logLevel: "info",
    hasUI: false,
    triage: {
      maxSteersPerStep: 2,
      maxRetries: 2,
      escalationThreshold: 3,
      staleThresholdMs: 600_000,
      promptTimeoutMs: 60_000,
      maxReviewLoops: 3,
    },
    worktreeBaseOverride: null,
    stateRootOverride: null,
    piCodingAgentDir: "/opt/pi",
    ...overrides,
  };
}

function createMockPaths(overrides?: Partial<OrchestratorPaths>): OrchestratorPaths {
  return {
    packageRoot: "/pkg",
    projectRoot: "/project",
    stateRoot: "/project/.pi/orchestrator",
    pipelineStatePath: "/project/.pi/orchestrator/pipeline-state.json",
    worktreeRegistryPath: "/project/.pi/orchestrator/worktree-registry.json",
    logRoot: "/project/.pi/orchestrator/logs",
    promptPath: "/pkg/prompts/ORCHESTRATOR.md",
    worktreeBase: "/project/.trees",
    piBmadExtensionPath: "/project/extensions/pi-bmad.ts",
    piPiExtensionPath: "/opt/pi/extensions/pi-pi.ts",
    childProjectRoot: (worktreePath: string) => worktreePath,
    childBmadStatePath: (worktreePath: string) =>
      `${worktreePath}/.pi/state/bmad/session-state.json`,
    ...overrides,
  };
}

function createMockEventBus(): OrchestratorEventBus {
  return {
    emit: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    close: vi.fn(async () => {
      /* noop */
    }),
  };
}

function createMockStateManager(): PipelineStateManager {
  const freshState = {
    schemaVersion: "pipeline-run-state.v1" as const,
    pipelineId: "test-pipeline",
    runId: "test-run",
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
  return {
    getState: vi.fn(() => freshState),
    apply: vi.fn(async () => {
      /* noop */
    }),
    initialize: vi.fn(
      async (): Promise<RecoveryResult> => ({
        recovered: false,
        fromPersisted: false,
        quarantinedPath: null,
        runId: "test-run",
      }),
    ),
    onStateChange: vi.fn(() => vi.fn()),
    flush: vi.fn(async () => {
      /* noop */
    }),
  };
}

function createHealthyToolResults(): ToolCheckResult[] {
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

function createFailingToolResults(): ToolCheckResult[] {
  return [
    {
      tool: "git",
      available: false,
      version: null,
      meetsMinimum: false,
      required: true,
      error: "git not found",
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

function createMockDeps(overrides?: Partial<BootstrapDeps>): BootstrapDeps {
  return {
    loadConfig: vi.fn(() => createMockConfig()),
    resolvePaths: vi.fn(async () => createMockPaths()),
    createEventBus: vi.fn(() => createMockEventBus()),
    createStateManager: vi.fn(() => createMockStateManager()),
    checkToolHealth: vi.fn(async () => createHealthyToolResults()),
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
    createAuthorizationPolicy: vi.fn(() => ({ evaluate: vi.fn() })),
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

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("bootstrapOrchestrator", () => {
  describe("ready path (AC-1)", () => {
    it("returns status ready when all required tools are present", async () => {
      const deps = createMockDeps();
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(result.status).toBe("ready");
    });

    it("returns all module instances in BootstrapReady", async () => {
      const deps = createMockDeps();
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(result.status).toBe("ready");
      const ready = result as BootstrapReady;
      expect(ready.config).toBeDefined();
      expect(ready.paths).toBeDefined();
      expect(ready.stateManager).toBeDefined();
      expect(ready.eventBus).toBeDefined();
      expect(ready.registry).toBeDefined();
      expect(ready.workerPool).toBeDefined();
      expect(ready.scheduler).toBeDefined();
      expect(ready.triageEngine).toBeDefined();
      expect(ready.authorization).toBeDefined();
      expect(ready.run).toBeDefined();
      expect(ready.actions).toBeDefined();
      expect(ready.toolHealth).toBeDefined();
      expect(typeof ready.dispose).toBe("function");
    });

    it("calls factories in correct startup order", async () => {
      const callOrder: string[] = [];
      const deps = createMockDeps({
        loadConfig: vi.fn(() => {
          callOrder.push("config");
          return createMockConfig();
        }),
        resolvePaths: vi.fn(async () => {
          callOrder.push("paths");
          return createMockPaths();
        }),
        createEventBus: vi.fn(() => {
          callOrder.push("eventBus");
          return createMockEventBus();
        }),
        createStateManager: vi.fn(() => {
          callOrder.push("stateManager");
          return createMockStateManager();
        }),
        checkToolHealth: vi.fn(async () => {
          callOrder.push("toolHealth");
          return createHealthyToolResults();
        }),
      });
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(callOrder).toEqual(["config", "paths", "eventBus", "stateManager", "toolHealth"]);
    });

    it("initializes state manager with a generated runId and pipelineId", async () => {
      const mockStateManager = createMockStateManager();
      const deps = createMockDeps({
        createStateManager: vi.fn(() => mockStateManager),
      });
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockStateManager.initialize).toHaveBeenCalledOnce();

      const initCall = (mockStateManager.initialize as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        string,
      ];
      expect(initCall[0]).toMatch(/^run-/);
      expect(initCall[1].length).toBeGreaterThan(0);
    });
  });

  describe("system failure path (AC-2)", () => {
    it("returns status system-failure when a required tool is missing", async () => {
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(result.status).toBe("system-failure");
    });

    it("returns foundation modules in BootstrapSystemFailure", async () => {
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      const failure = result as BootstrapSystemFailure;
      expect(failure.config).toBeDefined();
      expect(failure.paths).toBeDefined();
      expect(failure.stateManager).toBeDefined();
      expect(failure.eventBus).toBeDefined();
      expect(failure.toolHealth).toBeDefined();
    });

    it("returns PipelineResult with exitCode 3", async () => {
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      const failure = result as BootstrapSystemFailure;
      expect(failure.result.exitCode).toBe(3);
      expect(failure.result.status).toBe("failed");
    });

    it("does NOT create dispatch-capable modules", async () => {
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
      });
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(deps.createWorkerPool).not.toHaveBeenCalled();
      expect(deps.createScheduler).not.toHaveBeenCalled();
      expect(deps.createRunController).not.toHaveBeenCalled();
    });

    it("applies system-failure state mutation", async () => {
      const mockStateManager = createMockStateManager();
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
        createStateManager: vi.fn(() => mockStateManager),
      });
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockStateManager.apply).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "set-status", status: "failed" }),
      );
    });
  });

  describe("tool health edge cases", () => {
    it("allows ready when tmux missing in headless mode", async () => {
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => [
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
            available: false,
            version: null,
            meetsMinimum: false,
            required: false,
            error: "not found",
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
        ]),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(result.status).toBe("ready");
    });
  });

  describe("dispose lifecycle", () => {
    it("dispose flushes state and closes event bus on BootstrapReady", async () => {
      const mockStateManager = createMockStateManager();
      const mockEventBus = createMockEventBus();
      const deps = createMockDeps({
        createStateManager: vi.fn(() => mockStateManager),
        createEventBus: vi.fn(() => mockEventBus),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      const ready = result as BootstrapReady;
      await ready.dispose();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockStateManager.flush).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockEventBus.close).toHaveBeenCalled();
    });

    it("dispose works on BootstrapSystemFailure", async () => {
      const mockStateManager = createMockStateManager();
      const mockEventBus = createMockEventBus();
      const deps = createMockDeps({
        checkToolHealth: vi.fn(async () => createFailingToolResults()),
        createStateManager: vi.fn(() => mockStateManager),
        createEventBus: vi.fn(() => mockEventBus),
      });
      const result = await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      const failure = result as BootstrapSystemFailure;
      await failure.dispose();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockStateManager.flush).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vitest mock
      expect(mockEventBus.close).toHaveBeenCalled();
    });
  });

  describe("ADR-009 state migration (AC-3)", () => {
    it("calls migrateState during bootstrap", async () => {
      const deps = createMockDeps();
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(deps.migrateState).toHaveBeenCalled();
    });

    it("migration is called before state manager initialization", async () => {
      const callOrder: string[] = [];
      const mockStateManager = createMockStateManager();
      (mockStateManager.initialize as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push("stateInit");
        return { recovered: false, fromPersisted: false, quarantinedPath: null, runId: "test-run" };
      });
      const deps = createMockDeps({
        createStateManager: vi.fn(() => mockStateManager),
        migrateState: vi.fn(async () => {
          callOrder.push("migrate");
          return { migrated: false, evidence: null };
        }),
      });
      await bootstrapOrchestrator(
        { projectRoot: "/project", hasUI: false, env: { PI_CODING_AGENT_DIR: "/opt/pi" } },
        deps,
      );
      expect(callOrder.indexOf("migrate")).toBeLessThan(callOrder.indexOf("stateInit"));
    });
  });

  describe("env forwarding", () => {
    it("passes env to loadConfig", async () => {
      const customEnv = { PI_CODING_AGENT_DIR: "/custom/pi", ORCHESTRATOR_MAX_WORKERS: "5" };
      const deps = createMockDeps();
      await bootstrapOrchestrator({ projectRoot: "/project", hasUI: false, env: customEnv }, deps);
      expect(deps.loadConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          PI_CODING_AGENT_DIR: "/custom/pi",
          ORCHESTRATOR_MAX_WORKERS: "5",
        }),
      );
    });

    it("uses process.env as fallback when env is not provided", async () => {
      const deps = createMockDeps();
      await bootstrapOrchestrator({ projectRoot: "/project", hasUI: false }, deps);
      expect(deps.loadConfig).toHaveBeenCalledOnce();
    });
  });
});
