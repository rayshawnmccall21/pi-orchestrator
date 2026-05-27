# pi-orchestrator

Pipeline orchestrator for BMAD agent workflows. Supervises child Pi sessions across git worktrees, preserves artifact ownership, provides JSONL observability, enforces safe worktree lifecycle, and exposes slash/tool/headless/TUI surfaces from one state model.

## Overview

`pi-orchestrator` is a standalone [pi-package](https://github.com/mariozechner/pi-coding-agent) that extends the Pi coding agent with full SDLC orchestration capabilities. It manages pools of BMAD worker agents running in isolated git worktrees, coordinates their work through a typed event bus, and merges completed work back to the main branch.

## Install

### As a Pi Package

```bash
pi install pi-orchestrator
```

This installs the package to your Pi extensions directory and registers the extension entry point.

### From Source (Development)

```bash
pi install ./pi-orchestrator
```

Or link for development:

```bash
cd /path/to/pi-orchestrator
pi install .
```

## Pi Extension

After installation, `pi-orchestrator` registers with the Pi agent:

- **Slash command**: `/orchestrate` — Unified orchestration interface
- **Tool**: `orchestrate` — Programmatic pipeline control via LLM calls
- **Hot-reloaded prompt**: `prompts/ORCHESTRATOR.md` updates every turn

## Usage

### Slash Command: `/orchestrate`

The primary interface for pipeline operations:

```
/orchestrate              — Show pipeline status (default)
/orchestrate start        — Start a full pipeline run
/orchestrate start analysis — Start from analysis phase only
/orchestrate start planning — Start from planning phase
/orchestrate start full   — Start full SDLC pipeline
/orchestrate pause        — Pause the dispatch loop
/orchestrate resume       — Resume the dispatch loop
/orchestrate abort        — Abort the pipeline run
/orchestrate abort reason — Abort with reason
```

### Orchestration Tool

The `orchestrate` tool provides programmatic control:

```typescript
await pi.tools.orchestrate({
  action: "start",      // Required: start, status, list, steer, pause, resume, abort, escalate, result
  scope: "full",        // For start action: analysis, planning, architecture, implementation, full
  sessionId: "sess-1",  // For steer action
  message: "Guidance"   // For steer, abort, escalate actions
});
```

### Actions

| Action | Description |
|--------|-------------|
| `start` | Start a pipeline run (optionally scoped to a phase) |
| `status` | Show current pipeline and worker status |
| `list` | List dispatches and active worker sessions |
| `steer` | Send steering message to a worker session |
| `pause` | Pause the dispatch loop |
| `resume` | Resume the dispatch loop |
| `abort` | Abort the pipeline run |
| `escalate` | Escalate a blocking issue for human decision |
| `result` | Show the final pipeline result |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_CODING_AGENT_DIR` | `~/.pi/agent` | Path to Pi coding agent installation |
| `ORCHESTRATOR_MAX_WORKERS` | `3` | Maximum concurrent worker sessions |
| `ORCHESTRATOR_LOG_LEVEL` | `info` | Log verbosity: debug, info, warn, error |
| `ORCHESTRATOR_HAS_UI` | `false` | Whether session has UI (headed mode) |
| `ORCHESTRATOR_WORKTREE_BASE` | `.trees/` | Base directory for worker worktrees |
| `ORCHESTRATOR_STATE_ROOT` | `.pi/orchestrator/` | State persistence directory |
| `ORCHESTRATOR_MAX_STEERS_PER_STEP` | `2` | Max steer attempts before retry |
| `ORCHESTRATOR_MAX_RETRIES` | `2` | Max retry attempts per dispatch |
| `ORCHESTRATOR_ESCALATION_THRESHOLD` | `3` | Blocked stories before escalation |
| `ORCHESTRATOR_STALE_THRESHOLD_MS` | `600000` | Worker stale timeout (10 min) |
| `ORCHESTRATOR_PROMPT_TIMEOUT_MS` | `60000` | Prompt timeout in headless mode |
| `ORCHESTRATOR_MAX_REVIEW_LOOPS` | `3` | Max review loop transitions per story |

### PI_CODING_AGENT_DIR

The path to your Pi coding agent installation. This is where `pi-orchestrator` looks for:

- `pi` CLI binary
- Extension registry
- Shared resources

Defaults to `~/.pi/agent` if not set.

## Package Structure

```
pi-orchestrator/
├── package.json           — Package manifest with Pi metadata
├── tsconfig.json          — Strict TypeScript configuration
├── vitest.config.ts       — Vitest test configuration
├── README.md              — This file
├── src/
│   ├── extension/         — Pi extension entry (hooks + wiring)
│   ├── shared/            — Domain utilities and ports
│   │   ├── types.ts       — Core domain types (owned by this package)
│   │   └── errors.ts      — Error classes with codes
│   ├── config.ts          — Static config from env (pure, no I/O)
│   ├── bootstrap.ts       — Runtime startup sequencer
│   ├── state/             — Pipeline state and worktree registry
│   ├── events/            — Typed event bus and child parser
│   ├── workers/pool/      — Worker lifecycle management
│   ├── scheduling/        — Dispatch planning engine
│   ├── triage/            — Failure classification and auth gates
│   ├── run/controller/    — Orchestration brain
│   ├── actions.ts         — Typed OrchestratorActions boundary
│   ├── slash/             — Slash command implementations
│   └── tui/               — TUI dashboard and rendering
├── skills/
│   └── pi-orchestrator/   — Pi skill descriptor
├── prompts/
│   └── ORCHESTRATOR.md    — Hot-reloaded orchestrator prompt
└── test/
    ├── unit/              — Unit tests (run with npm run test:unit)
    ├── integration/       — Integration tests (npm run test:integration)
    └── support/           — Test helpers and fixtures
```

## Development

### Prerequisites

- Node.js 20+ with ESM support
- Pi coding agent installed at `~/.pi/agent` (or set `PI_CODING_AGENT_DIR`)

### Running Tests

```bash
# Run unit tests only (fast, no I/O)
npm run test:unit

# Run integration tests (requires git, tmux)
npm run test:integration

# Run all tests with coverage
npm run test:all

# Run tests with coverage report
npm run test:coverage
```

### Code Quality

```bash
# Type check
npm run typecheck

# Lint
npm run lint

# Format check
npm run format:check

# Format fix
npm run format

# Architecture validation
npm run lint:arch

# Dead code detection
npm run lint:dead

# Full CI check (all of the above + tests)
npm run check
```

### Building

```bash
# Type check (this package has no build step — ships TypeScript source)
npm run typecheck
```

## State Root

At runtime, the orchestrator stores its state in the project (separate from the package installation):

```
<projectRoot>/.pi/orchestrator/
├── pipeline-state.json    — Current pipeline run state
├── worktree-registry.json — Worktree lifecycle registry
└── logs/                  — JSONL audit logs
```

This is separate from the package installation directory, which contains only read-only assets.

## Safety Invariants

These invariants are enforced in code and tested in `test/unit/shared/import-independence.test.ts`:

- **No active worktree removal** without explicit authorization
- **No dispatch** before health check and reconciliation complete
- **No raw shell interpolation** — all commands use argv arrays
- **No state writes** outside the state manager's `apply()` method
- **No surface bypasses** the `OrchestratorActions` boundary
- **No imports escaping the package** — enforced by import independence tests
- **No 'any' type** in owned files (`src/shared/types.ts`, `src/shared/errors.ts`)

## Architecture

See the [refactor plan](./docs/refactor/pi-package-refactor-plan.md) for the full architecture, module visibility model, interface contracts, and dependency graph.

## Troubleshooting

### "Orchestrator not initialized"

The orchestrator must bootstrap before use. This happens automatically on session start. If you see this error:

1. Ensure `pi-orchestrator` is installed: `pi list | grep orchestrator`
2. Restart your Pi session
3. Check logs in `<projectRoot>/.pi/orchestrator/logs/`

### Worker stuck or stale

```bash
/orchestrate status

/orchestrate steer <sessionId> "Your guidance here"
```

### Merge conflict

Merge conflicts are handled by the triage engine via the `merge-conflict-resolution` authorization gate. The conflict is blocked until resolved or overridden.

### System failure on boot

If `bootstrapOrchestrator()` fails, required tools (git, pi) are missing or `PI_CODING_AGENT_DIR` is misconfigured. Check the pipeline state file for error details.

---

For more details on the orchestration model, see `prompts/ORCHESTRATOR.md`.
