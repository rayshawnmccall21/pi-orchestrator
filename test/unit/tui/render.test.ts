/**
 * Unit tests for tui/render.ts — pure ANSI rendering functions.
 *
 * Covers AC-4 (no line exceeds terminal width, state distinguishable).
 * All render functions are tested as pure functions from data to string[].
 *
 * @see R-S14 story acceptance criteria
 */

import { describe, it, expect } from "vitest";
import {
  renderDashboard,
  renderHeader,
  renderStageRow,
  renderEventLog,
  progressBar,
  statusGlyph,
  statusLabel,
  formatElapsed,
  PALETTE,
  type DashboardSnapshot,
  type DashboardStageRow,
  type DashboardEventRow,
} from "../../../src/tui/render.js";

// ═══════════════════════════════════════════════════════════════════════════
// ANSI width helper — strips ANSI for visible width measurement
// ═══════════════════════════════════════════════════════════════════════════

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/** Strip ANSI escape codes to measure visible character width. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fixture factories
// ═══════════════════════════════════════════════════════════════════════════

function createStageRow(overrides: Partial<DashboardStageRow> = {}): DashboardStageRow {
  return {
    stage: "development",
    agent: "Dev",
    workflowId: "dev-story",
    activeStep: "task-3 tests",
    status: "running",
    progress: 0.62,
    elapsedMs: 184_000,
    loopCount: 0,
    ...overrides,
  };
}

function createEventRow(overrides: Partial<DashboardEventRow> = {}): DashboardEventRow {
  return {
    timestamp: "2025-07-16T12:00:00.000Z",
    kind: "workflow:started",
    severity: "info",
    message: "Dev • dev-story started",
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    pipelineId: "pipeline-1",
    runId: "run-1",
    status: "running",
    summary: {
      counts: { running: 1, blocked: 0, done: 2, loops: 0 },
    },
    stages: [
      createStageRow({
        status: "done",
        progress: 1.0,
        stage: "analysis",
        agent: "SM",
        workflowId: "create-story",
      }),
      createStageRow({ status: "running", progress: 0.62 }),
      createStageRow({
        status: "pending",
        progress: 0.0,
        stage: "review",
        agent: "QA",
        workflowId: "code-review",
        activeStep: null,
      }),
    ],
    events: [
      createEventRow(),
      createEventRow({ kind: "step:advanced", message: "Dev → task-3 tests" }),
    ],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("tui/render.ts", () => {
  describe("formatElapsed", () => {
    it("formats seconds below 60 as Ns", () => {
      expect(formatElapsed(45_000)).toBe("45s");
    });

    it("formats minutes and seconds as NmSSs", () => {
      expect(formatElapsed(184_000)).toBe("3m04s");
    });

    it("formats zero as 0s", () => {
      expect(formatElapsed(0)).toBe("0s");
    });
  });

  describe("progressBar", () => {
    it("returns a string of specified width at 0%", () => {
      const bar = progressBar(0, 20, (s) => s);
      expect(visibleWidth(bar)).toBe(20);
    });

    it("returns a string of specified width at 100%", () => {
      const bar = progressBar(1, 20, (s) => s);
      expect(visibleWidth(bar)).toBe(20);
    });

    it("returns a string of specified width at 50%", () => {
      const bar = progressBar(0.5, 20, (s) => s);
      expect(visibleWidth(bar)).toBe(20);
    });

    it("clamps values above 1 to 100%", () => {
      const bar = progressBar(1.5, 20, (s) => s);
      expect(visibleWidth(bar)).toBe(20);
    });

    it("clamps values below 0 to 0%", () => {
      const bar = progressBar(-0.5, 20, (s) => s);
      expect(visibleWidth(bar)).toBe(20);
    });
  });

  describe("statusGlyph", () => {
    it("returns a glyph for running status", () => {
      const glyph = statusGlyph("running", 0);
      expect(stripAnsi(glyph).length).toBeGreaterThan(0);
    });

    it("returns ✓ for done status", () => {
      const glyph = statusGlyph("done", 0);
      expect(stripAnsi(glyph)).toContain("✓");
    });

    it("returns a glyph for blocked status", () => {
      const glyph = statusGlyph("blocked", 0);
      expect(stripAnsi(glyph).length).toBeGreaterThan(0);
    });

    it("returns a glyph for pending status", () => {
      const glyph = statusGlyph("pending", 0);
      expect(stripAnsi(glyph).length).toBeGreaterThan(0);
    });
  });

  describe("statusLabel", () => {
    it("returns a label for each status", () => {
      const statuses = ["running", "done", "blocked", "pending", "failed"] as const;
      for (const status of statuses) {
        const label = statusLabel(status);
        expect(stripAnsi(label).length).toBeGreaterThan(0);
      }
    });
  });

  describe("renderHeader", () => {
    it("renders lines within 120 columns", () => {
      const lines = renderHeader({
        width: 120,
        tickMs: 0,
        running: 1,
        blocked: 0,
        done: 2,
        loops: 0,
      });
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(120);
      }
    });

    it("renders at least 3 lines (top border, content, bottom border)", () => {
      const lines = renderHeader({
        width: 120,
        tickMs: 0,
        running: 1,
        blocked: 0,
        done: 2,
        loops: 0,
      });
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("renderStageRow", () => {
    it("renders lines within 120 columns (AC-4)", () => {
      const row = createStageRow();
      const lines = renderStageRow(row, 120, 0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(120);
      }
    });

    it("renders at least 3 lines (header, bar, status)", () => {
      const row = createStageRow();
      const lines = renderStageRow(row, 120, 0);
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    it("renders loop badge when loopCount > 0", () => {
      const row = createStageRow({ loopCount: 2 });
      const lines = renderStageRow(row, 120, 0);
      const joined = lines.map(stripAnsi).join("\n");
      expect(joined).toContain("↻");
    });

    it("handles narrow width (80 columns) without exceeding width", () => {
      const row = createStageRow();
      const lines = renderStageRow(row, 80, 0);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });
  });

  describe("renderEventLog", () => {
    it("renders lines within 120 columns (AC-4)", () => {
      const events = [createEventRow(), createEventRow()];
      const lines = renderEventLog(events, 120, 5);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(120);
      }
    });

    it("pads to maxLines when fewer events available", () => {
      const events = [createEventRow()];
      const lines = renderEventLog(events, 120, 5);
      // top + maxLines rows + bottom = maxLines + 2
      expect(lines.length).toBe(5 + 2);
    });

    it("renders empty log without errors", () => {
      const lines = renderEventLog([], 120, 5);
      expect(lines.length).toBe(5 + 2);
    });
  });

  describe("renderDashboard (full composition)", () => {
    it("renders all lines within 120 columns (AC-4)", () => {
      const snapshot = createSnapshot();
      const lines = renderDashboard(snapshot, 0, 120);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(120);
      }
    });

    it("renders all lines within 80 columns for narrow terminals", () => {
      const snapshot = createSnapshot();
      const lines = renderDashboard(snapshot, 0, 80);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      }
    });

    it("includes header, stage rows, and event log sections", () => {
      const snapshot = createSnapshot();
      const lines = renderDashboard(snapshot, 0, 120);
      const text = lines.map(stripAnsi).join("\n");
      // Header should contain pipeline orchestrator
      expect(text.toUpperCase()).toContain("PIPELINE");
      // Should include event stream section
      expect(text).toContain("event stream");
    });

    it("renders empty pipeline state without errors", () => {
      const emptySnapshot = createSnapshot({
        status: "idle",
        stages: [],
        events: [],
        summary: { counts: { running: 0, blocked: 0, done: 0, loops: 0 } },
      });
      const lines = renderDashboard(emptySnapshot, 0, 120);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("state is distinguishable without color (AC-4 accessibility)", () => {
      const snapshot = createSnapshot();
      const lines = renderDashboard(snapshot, 0, 120);
      const plainText = lines.map(stripAnsi).join("\n");
      // Status glyphs should be visible in plain text
      expect(plainText).toMatch(/[✓◆·✗]/);
    });
  });

  describe("PALETTE export", () => {
    it("exports color functions that return strings", () => {
      expect(typeof PALETTE.accent("test")).toBe("string");
      expect(typeof PALETTE.ok("test")).toBe("string");
      expect(typeof PALETTE.err("test")).toBe("string");
      expect(typeof PALETTE.muted("test")).toBe("string");
    });
  });
});
