/* eslint-disable max-lines -- Centralized render module: all pure ANSI rendering in one locality. */
/**
 * Pure ANSI rendering functions for the pipeline dashboard.
 *
 * Every function in this module is a pure function: data in → string[] out.
 * No side effects, no mutable state, no I/O, no subscriptions.
 *
 * @see R-S14 AC-4 for width constraints and accessibility
 */

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard Data Types (render-layer projections)
// ═══════════════════════════════════════════════════════════════════════════

/** Row status for a pipeline stage in the dashboard. */
export type DashboardStageStatus = "running" | "done" | "blocked" | "pending" | "failed";

/** One row in the stage panel of the dashboard. */
export interface DashboardStageRow {
  /** Pipeline stage name. */
  stage: string;
  /** Agent identifier (SM, Dev, QA, Architect, PM). */
  agent: string;
  /** Workflow ID running at this stage. */
  workflowId: string;
  /** Active step label, or null when not started. */
  activeStep: string | null;
  /** Status of this stage. */
  status: DashboardStageStatus;
  /** Progress fraction 0..1, or null. */
  progress: number | null;
  /** Elapsed time in ms, or null. */
  elapsedMs: number | null;
  /** Number of loop-backs observed. */
  loopCount: number;
}

/** One row in the event log of the dashboard. */
export interface DashboardEventRow {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Event kind label. */
  kind: string;
  /** Severity level. */
  severity: "info" | "warn" | "error";
  /** Human-readable event message. */
  message: string;
}

/** Summary counts for the dashboard header. */
interface DashboardSummary {
  /** Stage counts by status. */
  counts: {
    /** Number of running stages. */
    running: number;
    /** Number of blocked stages. */
    blocked: number;
    /** Number of done stages. */
    done: number;
    /** Number of loop-backs. */
    loops: number;
  };
}

/** Complete dashboard data snapshot — input to renderDashboard. */
export interface DashboardSnapshot {
  /** Pipeline ID. */
  pipelineId: string;
  /** Run ID. */
  runId: string;
  /** Pipeline status. */
  status: string;
  /** Summary statistics. */
  summary: DashboardSummary;
  /** Stage rows. */
  stages: DashboardStageRow[];
  /** Event log rows. */
  events: DashboardEventRow[];
}

// ═══════════════════════════════════════════════════════════════════════════
// ANSI Helpers (24-bit inline — not theme-dependent)
// ═══════════════════════════════════════════════════════════════════════════

const RESET = "\x1b[0m";
const FG_RESET = "\x1b[39m";
const BOLD = "\x1b[1m";

/** ANSI color definition with RGB components. */
interface AnsiColor {
  /** Red component 0-255. */
  red: number;
  /** Green component 0-255. */
  green: number;
  /** Blue component 0-255. */
  blue: number;
}

/**
 * Apply 24-bit foreground color to text.
 *
 * @param color - RGB color definition.
 * @param text - Text to color.
 *
 * @returns ANSI-colored string with reset suffix.
 *
 * @example
 * ```typescript
 * fg({ red: 130, green: 200, blue: 255 }, "hello");
 * ```
 */
function fg(color: AnsiColor, text: string): string {
  return `\x1b[38;2;${String(color.red)};${String(color.green)};${String(color.blue)}m${text}${FG_RESET}`;
}

/**
 * Apply bold formatting to text.
 *
 * @param text - Text to bold.
 *
 * @returns Bold-formatted string with reset suffix.
 *
 * @example
 * ```typescript
 * bold("title");
 * ```
 */
function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Named Color Constants (eliminates magic number warnings)
// ═══════════════════════════════════════════════════════════════════════════

const COLOR_ACCENT: AnsiColor = { red: 130, green: 200, blue: 255 };
const COLOR_OK: AnsiColor = { red: 90, green: 215, blue: 130 };
const COLOR_WARN: AnsiColor = { red: 245, green: 190, blue: 85 };
const COLOR_ERR: AnsiColor = { red: 240, green: 95, blue: 110 };
const COLOR_MUTED: AnsiColor = { red: 130, green: 140, blue: 160 };
const COLOR_LOOP: AnsiColor = { red: 200, green: 130, blue: 235 };
const COLOR_BORDER: AnsiColor = { red: 60, green: 75, blue: 95 };
const COLOR_BAR: AnsiColor = { red: 95, green: 175, blue: 235 };
const COLOR_BAR_DONE: AnsiColor = { red: 90, green: 215, blue: 130 };
const COLOR_BAR_BLOCKED: AnsiColor = { red: 240, green: 95, blue: 110 };
const COLOR_DIM_GREY: AnsiColor = { red: 75, green: 85, blue: 100 };

// ═══════════════════════════════════════════════════════════════════════════
// Public Color Palette
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exported palette functions for ANSI coloring.
 *
 * Each member applies a 24-bit inline foreground color and resets.
 */
export const PALETTE = {
  /**
   * Running / active accent.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  accent: (text: string): string => fg(COLOR_ACCENT, text),
  /**
   * Success color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  ok: (text: string): string => fg(COLOR_OK, text),
  /**
   * Warning color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  warn: (text: string): string => fg(COLOR_WARN, text),
  /**
   * Error / blocked color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  err: (text: string): string => fg(COLOR_ERR, text),
  /**
   * Muted / pending color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  muted: (text: string): string => fg(COLOR_MUTED, text),
  /**
   * Loop-back color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  loopC: (text: string): string => fg(COLOR_LOOP, text),
  /**
   * Border color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  border: (text: string): string => fg(COLOR_BORDER, text),
  /**
   * Progress bar fill color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  bar: (text: string): string => fg(COLOR_BAR, text),
  /**
   * Done bar fill color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  barDone: (text: string): string => fg(COLOR_BAR_DONE, text),
  /**
   * Blocked bar fill color.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  barBlocked: (text: string): string => fg(COLOR_BAR_BLOCKED, text),
  /**
   * Dim grey for empty progress cells.
   *
   * @param text - Text to color.
   *
   * @returns Colored string.
   */
  dimGrey: (text: string): string => fg(COLOR_DIM_GREY, text),
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// Width Primitives
// ═══════════════════════════════════════════════════════════════════════════

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * Strip ANSI escape codes to measure visible character width.
 *
 * @param text - Text possibly containing ANSI codes.
 *
 * @returns Text with all ANSI codes removed.
 *
 * @example
 * ```typescript
 * stripAnsi("\x1b[31mhello\x1b[0m"); // "hello"
 * ```
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Measure visible character width (ANSI-stripped).
 *
 * @param text - Text to measure.
 *
 * @returns Visible character count.
 *
 * @example
 * ```typescript
 * vlen("\x1b[31mhello\x1b[0m"); // 5
 * ```
 */
function vlen(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Pad string with spaces to reach target visible width.
 *
 * @param text - Text to pad.
 * @param targetWidth - Desired visible width.
 *
 * @returns Padded string.
 *
 * @example
 * ```typescript
 * padRight("hi", 5); // "hi   "
 * ```
 */
function padRight(text: string, targetWidth: number): string {
  const currentWidth = vlen(text);
  if (currentWidth >= targetWidth) {
    return text;
  }
  return text + " ".repeat(targetWidth - currentWidth);
}

/**
 * Truncate string to target visible width, preserving ANSI structure.
 *
 * @param text - Text to truncate.
 * @param targetWidth - Maximum visible width.
 *
 * @returns Truncated string ending with "…" if it exceeded targetWidth.
 *
 * @example
 * ```typescript
 * clampToWidth("hello world", 8); // "hello w…"
 * ```
 */
function clampToWidth(text: string, targetWidth: number): string {
  if (vlen(text) <= targetWidth) {
    return text;
  }
  let visibleCount = 0;
  let rawIndex = 0;
  const ansiPattern = /\x1b\[[0-9;]*m/g;
  let result = "";
  while (rawIndex < text.length && visibleCount < targetWidth - 1) {
    ansiPattern.lastIndex = rawIndex;
    const ansiMatch = ansiPattern.exec(text);
    if (ansiMatch !== null && ansiMatch.index === rawIndex) {
      result += ansiMatch[0];
      rawIndex += ansiMatch[0].length;
    } else {
      result += text[rawIndex] ?? "";
      visibleCount++;
      rawIndex++;
    }
  }
  return result + "…" + RESET;
}

// ═══════════════════════════════════════════════════════════════════════════
// Spinner & Progress Primitives
// ═══════════════════════════════════════════════════════════════════════════

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const PARTIAL_BLOCKS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;
const ARROW_FRAMES = ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"] as const;

/** @see SPINNER_FRAMES animation rate. */
const SPINNER_FRAME_MS = 90;
/** @see ARROW_FRAMES animation rate. */
const ARROW_FRAME_MS = 130;
/** Unicode partial block denominator. */
const EIGHTHS_PER_CELL = 8;

/**
 * Get the current spinner frame character.
 *
 * @param tickMs - Animation tick in milliseconds.
 *
 * @returns Spinner character for the current frame.
 *
 * @example
 * ```typescript
 * spinnerFrame(0); // "⠋"
 * ```
 */
function spinnerFrame(tickMs: number): string {
  const frameIndex = Math.floor(tickMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIndex] ?? SPINNER_FRAMES[0];
}

/**
 * Get the current arrow frame character.
 *
 * @param tickMs - Animation tick in milliseconds.
 *
 * @returns Arrow character for the current frame.
 *
 * @example
 * ```typescript
 * arrowFrame(0); // "→"
 * ```
 */
function arrowFrame(tickMs: number): string {
  const frameIndex = Math.floor(tickMs / ARROW_FRAME_MS) % ARROW_FRAMES.length;
  return ARROW_FRAMES[frameIndex] ?? ARROW_FRAMES[0];
}

/**
 * Smooth Unicode progress bar with 1/8th-cell precision.
 *
 * @param pct - Progress fraction 0..1.
 * @param width - Total cell width in terminal columns.
 * @param colorFn - Color applicator for the filled portion.
 *
 * @returns Formatted progress bar string of exact visible width.
 *
 * @example
 * ```typescript
 * progressBar(0.5, 20, (s) => s); // "██████████░░░░░░░░░░"
 * ```
 */
export function progressBar(pct: number, width: number, colorFn: (text: string) => string): string {
  const clamped = Math.max(0, Math.min(1, pct));
  const totalEighths = clamped * width * EIGHTHS_PER_CELL;
  const fullCells = Math.floor(totalEighths / EIGHTHS_PER_CELL);
  const remainder = Math.floor(totalEighths) - fullCells * EIGHTHS_PER_CELL;
  const filledCells = "█".repeat(Math.min(fullCells, width));
  const partialCell = fullCells < width ? (PARTIAL_BLOCKS[remainder] ?? "") : "";
  const filledContent = filledCells + partialCell;
  const emptyCount = Math.max(0, width - vlen(filledContent));
  return colorFn(filledContent) + PALETTE.dimGrey("░".repeat(emptyCount));
}

// ═══════════════════════════════════════════════════════════════════════════
// Status Display Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Return a single-character glyph representing the stage status.
 * Glyphs are distinguishable without color (AC-4 accessibility).
 *
 * @param status - Stage status value.
 * @param tickMs - Animation tick for spinner frames.
 *
 * @returns Colored glyph string.
 *
 * @example
 * ```typescript
 * statusGlyph("done", 0); // "✓" (colored green)
 * ```
 */
export function statusGlyph(status: DashboardStageStatus, tickMs: number): string {
  switch (status) {
    case "running": {
      return PALETTE.accent(spinnerFrame(tickMs));
    }
    case "done": {
      return PALETTE.ok("✓");
    }
    case "blocked": {
      return PALETTE.err("◆");
    }
    case "pending": {
      return PALETTE.muted("·");
    }
    case "failed": {
      return PALETTE.err("✗");
    }
  }
}

/**
 * Return a short label representing the stage status.
 *
 * @param status - Stage status value.
 *
 * @returns Colored label string.
 *
 * @example
 * ```typescript
 * statusLabel("done"); // "DONE" (colored green)
 * ```
 */
export function statusLabel(status: DashboardStageStatus): string {
  switch (status) {
    case "running": {
      return PALETTE.accent("RUN");
    }
    case "done": {
      return PALETTE.ok("DONE");
    }
    case "blocked": {
      return PALETTE.err("BLOCK");
    }
    case "pending": {
      return PALETTE.muted("WAIT");
    }
    case "failed": {
      return PALETTE.err("FAIL");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Time Formatting
// ═══════════════════════════════════════════════════════════════════════════

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const SECONDS_PAD_WIDTH = 2;

/**
 * Format milliseconds as a human-readable elapsed time string.
 *
 * @param milliseconds - Duration in milliseconds.
 *
 * @returns Formatted string like "45s" or "3m04s".
 *
 * @example
 * ```typescript
 * formatElapsed(184_000); // "3m04s"
 * ```
 */
export function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${String(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const remainderSeconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${String(minutes)}m${String(remainderSeconds).padStart(SECONDS_PAD_WIDTH, "0")}s`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Header Renderer
// ═══════════════════════════════════════════════════════════════════════════

/** Input parameters for renderHeader. */
export interface HeaderParams {
  /** Terminal width in columns. */
  width: number;
  /** Animation tick for spinner. */
  tickMs: number;
  /** Number of running stages. */
  running: number;
  /** Number of blocked stages. */
  blocked: number;
  /** Number of done stages. */
  done: number;
  /** Number of loop-backs. */
  loops: number;
}

/**
 * Render the dashboard header bar.
 *
 * @param params - Header rendering parameters.
 *
 * @returns Array of rendered lines.
 *
 * @example
 * ```typescript
 * renderHeader({ width: 120, tickMs: 0, running: 1, blocked: 0, done: 2, loops: 0 });
 * ```
 */
export function renderHeader(params: HeaderParams): string[] {
  const inner = params.width - 2; // eslint-disable-line @typescript-eslint/no-magic-numbers -- Box border width.
  const title = `${PALETTE.accent(spinnerFrame(params.tickMs))} ${bold("PIPELINE ORCHESTRATOR")}`;
  const stats = [
    `${PALETTE.accent("●")} ${bold(String(params.running))} running`,
    `${PALETTE.err("◆")} ${bold(String(params.blocked))} blocked`,
    `${PALETTE.ok("✓")} ${bold(String(params.done))} done`,
    `${PALETTE.loopC("↻")} ${bold(String(params.loops))} loops`,
  ].join(PALETTE.muted("  │  "));

  const leftContent = " " + title + " ";
  const rightContent = " " + stats + " ";
  const gapSize = Math.max(1, inner - vlen(leftContent) - vlen(rightContent));

  const contentLine = leftContent + " ".repeat(gapSize) + rightContent;
  const clampedContent =
    vlen(contentLine) > inner ? clampToWidth(contentLine, inner) : padRight(contentLine, inner);

  return [
    PALETTE.border("┏") + PALETTE.border("━".repeat(inner)) + PALETTE.border("┓"),
    PALETTE.border("┃") + clampedContent + PALETTE.border("┃"),
    PALETTE.border("┗") + PALETTE.border("━".repeat(inner)) + PALETTE.border("┛"),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage Row Renderer
// ═══════════════════════════════════════════════════════════════════════════

const MIN_BAR_WIDTH = 4;
const BAR_PADDING = 4;
const MIN_HEADER_FILL = 2;
const BOX_BORDER_WIDTH = 2;

/**
 * Render one pipeline stage row as a boxed card.
 *
 * @param row - Stage data to render.
 * @param width - Terminal width in columns.
 * @param tickMs - Animation tick for spinner.
 *
 * @returns Array of rendered lines.
 *
 * @example
 * ```typescript
 * renderStageRow({ stage: "dev", agent: "Dev", workflowId: "dev-story", activeStep: null, status: "running", progress: 0.5, elapsedMs: 1000, loopCount: 0 }, 120, 0);
 * ```
 */
export function renderStageRow(row: DashboardStageRow, width: number, tickMs: number): string[] {
  const inner = width - BOX_BORDER_WIDTH;
  const titleColor = selectTitleColor(row.status);
  const loopBadge = row.loopCount > 0 ? " " + PALETTE.loopC(`↻${String(row.loopCount)}`) : "";
  const elapsed = row.elapsedMs !== null ? PALETTE.muted(formatElapsed(row.elapsedMs)) : "";
  const titleText = `${arrowFrame(tickMs)} ${row.agent} • ${row.workflowId}${loopBadge}`;
  const headerLeft = " " + titleColor(bold(titleText)) + " ";
  const headerRight = elapsed.length > 0 ? ` ${elapsed} ` : " ";
  const headerFillWidth = Math.max(MIN_HEADER_FILL, inner - vlen(headerLeft) - vlen(headerRight));
  const topLine =
    PALETTE.border("╔") +
    headerLeft +
    PALETTE.border("═".repeat(headerFillWidth)) +
    headerRight +
    PALETTE.border("╗");

  const adjustedBarWidth = Math.max(MIN_BAR_WIDTH, inner - BAR_PADDING);
  const barColorFn = selectBarColor(row.status);
  const barLine =
    PALETTE.border("║") +
    " " +
    progressBar(row.progress ?? 0, Math.min(adjustedBarWidth, inner - BAR_PADDING), barColorFn) +
    " " +
    PALETTE.border("║");

  const glyph = statusGlyph(row.status, tickMs);
  const label = statusLabel(row.status);
  const stepText = row.activeStep !== null ? PALETTE.accent(row.activeStep) : PALETTE.muted("—");
  const detailContent = ` ${glyph}  ${label}  ${PALETTE.border("│")}  ${stepText} `;
  const detailLine = PALETTE.border("║") + padRight(detailContent, inner) + PALETTE.border("║");
  const bottomLine = PALETTE.border("╚") + PALETTE.border("═".repeat(inner)) + PALETTE.border("╝");

  return [topLine, barLine, detailLine, bottomLine].map((line) =>
    vlen(line) > width ? clampToWidth(line, width) : line,
  );
}

/**
 * Select title color based on status.
 *
 * @param status - Stage status.
 *
 * @returns Color function for the title.
 *
 * @example
 * ```typescript
 * selectTitleColor("done"); // PALETTE.ok
 * ```
 */
function selectTitleColor(status: DashboardStageStatus): (text: string) => string {
  if (status === "done") {
    return PALETTE.ok;
  }
  if (status === "blocked" || status === "failed") {
    return PALETTE.err;
  }
  return PALETTE.accent;
}

/**
 * Select progress bar color based on status.
 *
 * @param status - Stage status.
 *
 * @returns Color function for the bar fill.
 *
 * @example
 * ```typescript
 * selectBarColor("done"); // PALETTE.barDone
 * ```
 */
function selectBarColor(status: DashboardStageStatus): (text: string) => string {
  if (status === "done") {
    return PALETTE.barDone;
  }
  if (status === "blocked") {
    return PALETTE.barBlocked;
  }
  return PALETTE.bar;
}

// ═══════════════════════════════════════════════════════════════════════════
// Event Log Renderer
// ═══════════════════════════════════════════════════════════════════════════

const EVENT_KIND_WIDTH = 22;

/**
 * Render the event log panel.
 *
 * @param events - Recent events to display.
 * @param width - Terminal width in columns.
 * @param maxLines - Maximum number of event lines to show.
 *
 * @returns Array of rendered lines (top border + rows + bottom border).
 *
 * @example
 * ```typescript
 * renderEventLog([{ timestamp: "...", kind: "workflow:started", severity: "info", message: "..." }], 120, 5);
 * ```
 */
export function renderEventLog(
  events: readonly DashboardEventRow[],
  width: number,
  maxLines: number,
): string[] {
  const inner = width - BOX_BORDER_WIDTH;
  const headerText = ` ${bold(PALETTE.accent("◉ event stream"))} `;
  const headerFillWidth = Math.max(MIN_HEADER_FILL, inner - vlen(headerText));
  const topBorder =
    PALETTE.border("╔") +
    headerText +
    PALETTE.border("═".repeat(headerFillWidth)) +
    PALETTE.border("╗");

  const rows: string[] = [];
  const recentEvents = events.slice(-maxLines).reverse();

  for (const eventRow of recentEvents) {
    const lineContent = formatEventLine(eventRow);
    const clampedContent =
      vlen(lineContent) > inner ? clampToWidth(lineContent, inner) : lineContent;
    rows.push(PALETTE.border("║") + padRight(clampedContent, inner) + PALETTE.border("║"));
  }

  while (rows.length < maxLines) {
    rows.push(PALETTE.border("║") + " ".repeat(inner) + PALETTE.border("║"));
  }

  const bottomBorder =
    PALETTE.border("╚") + PALETTE.border("═".repeat(inner)) + PALETTE.border("╝");
  return [topBorder, ...rows, bottomBorder];
}

/**
 * Format a single event row as a display line.
 *
 * @param eventRow - Event data to format.
 *
 * @returns Formatted event line string.
 *
 * @example
 * ```typescript
 * formatEventLine({ timestamp: "2025-01-01T00:00:00Z", kind: "step:advanced", severity: "info", message: "..." });
 * ```
 */
function formatEventLine(eventRow: DashboardEventRow): string {
  const severityColor = selectSeverityColor(eventRow.severity);
  const timeLabel = PALETTE.muted(
    new Date(eventRow.timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  );
  const kindLabel = severityColor(
    eventRow.kind.padEnd(EVENT_KIND_WIDTH).slice(0, EVENT_KIND_WIDTH),
  );
  return ` ${timeLabel} ${kindLabel} ${PALETTE.muted(eventRow.message)}`;
}

/**
 * Select color for event severity level.
 *
 * @param severity - Event severity.
 *
 * @returns Color function.
 *
 * @example
 * ```typescript
 * selectSeverityColor("error"); // PALETTE.err
 * ```
 */
function selectSeverityColor(severity: string): (text: string) => string {
  if (severity === "error") {
    return PALETTE.err;
  }
  if (severity === "warn") {
    return PALETTE.warn;
  }
  return PALETTE.accent;
}

// ═══════════════════════════════════════════════════════════════════════════
// Full Dashboard Composition
// ═══════════════════════════════════════════════════════════════════════════

const EVENT_LOG_MAX_LINES = 10;
const EVENT_LOG_MIN_LINES = 4;

/**
 * Compose a complete dashboard render from a snapshot.
 *
 * @param snapshot - Dashboard data snapshot.
 * @param tickMs - Animation tick for spinners/arrows.
 * @param width - Terminal width in columns.
 *
 * @returns Array of rendered lines, each guaranteed ≤ width visible characters.
 *
 * @example
 * ```typescript
 * renderDashboard(snapshot, Date.now(), 120);
 * ```
 */
export function renderDashboard(
  snapshot: DashboardSnapshot,
  tickMs: number,
  width: number,
): string[] {
  const lines: string[] = [];
  const { running, blocked, done, loops } = snapshot.summary.counts;
  lines.push(...renderHeader({ width, tickMs, running, blocked, done, loops }));
  lines.push("");

  for (const stageRow of snapshot.stages) {
    lines.push(...renderStageRow(stageRow, width, tickMs));
    lines.push("");
  }

  const logLineCount = Math.min(
    EVENT_LOG_MAX_LINES,
    Math.max(EVENT_LOG_MIN_LINES, snapshot.events.length),
  );
  lines.push(...renderEventLog(snapshot.events, width, logLineCount));
  lines.push("");
  lines.push(
    PALETTE.muted("  hint: ") +
      PALETTE.muted("pipelines run in parallel · ") +
      PALETTE.loopC("↻") +
      PALETTE.muted(" loop = rework · ") +
      PALETTE.accent("●") +
      PALETTE.muted(" running · ") +
      PALETTE.err("◆") +
      PALETTE.muted(" blocked"),
  );

  return lines.map((line) => (vlen(line) > width ? clampToWidth(line, width) : line));
}
