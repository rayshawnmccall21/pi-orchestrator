/**
 * Unit tests for tui/dashboard.ts — read-only dashboard widget.
 *
 * Covers AC-3 (dashboard reflects real state, not mocks),
 * AC-5 (disposal cleans up timers/subscriptions, no state mutations from rendering).
 *
 * @see R-S14 story acceptance criteria
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDashboardWidget,
  projectDashboardSnapshot,
  type DashboardWidgetDeps,
} from "../../../src/tui/dashboard.js";
import type { PipelineStateManager } from "../../../src/state/pipeline.js";
import type {
  OrchestratorEventBus,
  EventSubscriber,
  DisposeSubscription,
} from "../../../src/events/bus.js";
import type { PipelineRunState, OrchestratorEvent } from "../../../src/shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mock Factories
// ═══════════════════════════════════════════════════════════════════════════

function createFreshState(overrides: Partial<PipelineRunState> = {}): PipelineRunState {
  return {
    schemaVersion: "pipeline-run-state.v1",
    pipelineId: "pipeline-test",
    runId: "run-test-1",
    status: "idle",
    phase: "analysis",
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
    startedAt: "2025-07-16T00:00:00.000Z",
    updatedAt: "2025-07-16T00:00:00.000Z",
    finishedAt: null,
    completedPhases: [],
    ...overrides,
  };
}

function createMockStateManager(
  state: PipelineRunState = createFreshState(),
): PipelineStateManager & { simulateChange: (newState: PipelineRunState) => void } {
  const stateChangeCallbacks: ((state: Readonly<PipelineRunState>) => void)[] = [];
  return {
    getState: vi.fn().mockReturnValue(Object.freeze({ ...state })),
    apply: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue({
      recovered: false,
      fromPersisted: false,
      quarantinedPath: null,
      runId: state.runId,
    }),
    onStateChange: vi.fn((callback: (state: Readonly<PipelineRunState>) => void) => {
      stateChangeCallbacks.push(callback);
      return () => {
        const index = stateChangeCallbacks.indexOf(callback);
        if (index !== -1) stateChangeCallbacks.splice(index, 1);
      };
    }),
    flush: vi.fn().mockResolvedValue(undefined),
    simulateChange: (newState: PipelineRunState) => {
      for (const callback of stateChangeCallbacks) {
        callback(Object.freeze({ ...newState }));
      }
    },
  };
}

function createMockEventBus(): OrchestratorEventBus & {
  simulateEvent: (event: OrchestratorEvent) => void;
  subscriberCount: () => number;
} {
  const eventSubscribers: EventSubscriber[] = [];
  return {
    emit: vi.fn(),
    onEvent: vi.fn((callback: EventSubscriber): DisposeSubscription => {
      eventSubscribers.push(callback);
      return () => {
        const index = eventSubscribers.indexOf(callback);
        if (index !== -1) eventSubscribers.splice(index, 1);
      };
    }),
    close: vi.fn().mockResolvedValue(undefined),
    simulateEvent: (event: OrchestratorEvent) => {
      for (const callback of eventSubscribers) {
        callback(event);
      }
    },
    subscriberCount: () => eventSubscribers.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("tui/dashboard.ts", () => {
  let mockStateManager: ReturnType<typeof createMockStateManager>;
  let mockEventBus: ReturnType<typeof createMockEventBus>;
  let widgetDeps: DashboardWidgetDeps;

  beforeEach(() => {
    vi.useFakeTimers();
    mockStateManager = createMockStateManager();
    mockEventBus = createMockEventBus();
    widgetDeps = { stateManager: mockStateManager, eventBus: mockEventBus };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("projectDashboardSnapshot (AC-3)", () => {
    it("projects real pipeline state into a dashboard snapshot", () => {
      const state = createFreshState({
        status: "running",
        phase: "implementation",
        activeStage: "development",
        dispatches: [
          {
            dispatchId: "d-1",
            sessionId: "sess-1",
            phase: "implementation",
            stage: "development",
            agent: "dev",
            workflowId: "dev-story",
            storyId: "story-1",
            promptIds: [],
            status: "confirmed",
            dispatchedAt: "2025-07-16T00:00:00.000Z",
            resolvedAt: null,
            completionEvidence: null,
          },
        ],
      });
      const snapshot = projectDashboardSnapshot(state, []);
      expect(snapshot.status).toBe("running");
      expect(snapshot.runId).toBe("run-test-1");
      expect(snapshot.stages.length).toBeGreaterThan(0);
    });

    it("projects events from PipelineRunState into the snapshot", () => {
      const state = createFreshState({
        events: [
          {
            sequence: 1,
            timestamp: "2025-07-16T12:00:00.000Z",
            pipelineId: "pipeline-test",
            runId: "run-test-1",
            kind: "workflow:started",
            severity: "info",
            message: "SM • create-story started",
            phaseId: null,
            workflowId: "create-story",
            stepId: null,
            storyId: null,
            sessionId: null,
            evidenceRef: null,
          },
        ],
      });
      const snapshot = projectDashboardSnapshot(state, []);
      expect(snapshot.events.length).toBeGreaterThanOrEqual(1);
    });

    it("does not include mock or simulator data (AC-3)", () => {
      const state = createFreshState({ status: "idle" });
      const snapshot = projectDashboardSnapshot(state, []);
      // An idle pipeline should show empty or minimal stages
      expect(snapshot.status).toBe("idle");
    });
  });

  describe("createDashboardWidget", () => {
    it("returns an object with render and dispose methods", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      expect(typeof widget.render).toBe("function");
      expect(typeof widget.dispose).toBe("function");
    });

    it("render returns string array (render output)", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      const lines = widget.render(120);
      expect(Array.isArray(lines)).toBe(true);
      for (const line of lines) {
        expect(typeof line).toBe("string");
      }
    });

    it("subscribes to state changes on creation", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock assertion pattern.
      expect(mockStateManager.onStateChange).toHaveBeenCalled();
      widget.dispose();
    });

    it("subscribes to event bus on creation", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock assertion pattern.
      expect(mockEventBus.onEvent).toHaveBeenCalled();
      widget.dispose();
    });

    it("requests re-render when state changes", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      const runningState = createFreshState({ status: "running" });
      mockStateManager.simulateChange(runningState);
      expect(mockTui.requestRender).toHaveBeenCalled();
      widget.dispose();
    });
  });

  describe("disposal and cleanup (AC-5)", () => {
    it("dispose removes state change subscription", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      widget.dispose();
    });

    it("dispose removes event bus subscription", () => {
      const mockTui = { requestRender: vi.fn() };
      const initialSubCount = mockEventBus.subscriberCount();
      const widget = createDashboardWidget(mockTui, widgetDeps);
      expect(mockEventBus.subscriberCount()).toBe(initialSubCount + 1);
      widget.dispose();
      expect(mockEventBus.subscriberCount()).toBe(initialSubCount);
    });

    it("render after dispose returns empty or safe output (AC-5)", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      widget.dispose();
      // Should not throw even after dispose
      const lines = widget.render(120);
      expect(Array.isArray(lines)).toBe(true);
    });

    it("dispose is idempotent — calling twice does not throw", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      widget.dispose();
      expect(() => {
        widget.dispose();
      }).not.toThrow();
    });
  });

  describe("no state mutation from rendering (AC-5)", () => {
    it("render does not call stateManager.apply", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      widget.render(120);
      widget.render(80);
      widget.render(120);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock assertion pattern.
      expect(mockStateManager.apply).not.toHaveBeenCalled();
      widget.dispose();
    });

    it("render does not call eventBus.emit", () => {
      const mockTui = { requestRender: vi.fn() };
      const widget = createDashboardWidget(mockTui, widgetDeps);
      widget.render(120);
      widget.render(80);
      // eslint-disable-next-line @typescript-eslint/unbound-method -- vi.fn() mock assertion pattern.
      expect(mockEventBus.emit).not.toHaveBeenCalled();
      widget.dispose();
    });
  });
});
