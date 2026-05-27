# pi-orchestrator

Pipeline orchestrator for BMAD agent workflows. Supervises child Pi sessions across git worktrees, preserves artifact ownership, provides JSONL observability, enforces safe worktree lifecycle, and exposes slash/tool/headless/TUI surfaces from one state model.

## Overview

`pi-orchestrator` is a standalone [pi-package](https://github.com/mariozechner/pi-coding-agent) that extends the Pi coding agent with full SDLC orchestration capabilities. It manages pools of BMAD worker agents running in isolated git worktrees, coordinates their work through a typed event bus, and merges completed work back to the main branch.

## Install

```bash
pi install pi-orchestrator
```

Or from source (development):

```bash
pi install ./pi-orchestrator
```

## Usage

Once installed, the orchestrator surfaces are available as Pi slash commands and tools:

```
/pipeline-start    — Start a pipeline run (optionally scoped to a phase)
/pipeline-status   — Show current pipeline and worker status
/pipeline-list     — List dispatches and active worker sessions
/pipeline-steer    — Send steering message to a worker session
/pipeline-pause    — Pause the dispatch loop
/pipeline-resume   — Resume the dispatch loop
/pipeline-abort    — Abort the pipeline run
/pipeline-escalate — Escalate a blocking issue for human decision
/pipeline-result   — Show the final pipeline result
```

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

```bash
# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run all tests
npm run test:all
```

## State Root

At runtime, the orchestrator stores its state in:

```
<projectRoot>/.pi/orchestrator/
├── pipeline-state.json    — Current pipeline run state
├── worktree-registry.json — Worktree lifecycle registry
└── logs/                  — JSONL audit logs
```

This is separate from the package installation directory, which contains only read-only assets.

## Safety Invariants

- No active worktree is ever removed without explicit authorization
- No dispatch is sent before health check and reconciliation complete
- No raw shell interpolation — all commands use argv arrays
- No state writes outside the state manager's `apply()` method
- No surface bypasses the `OrchestratorActions` boundary
- No imports from `pi-bmad` src/types.ts inside this package

## Architecture

See the [refactor plan](../orchestrator/docs/refactor/pi-package-refactor-plan.md) for the full architecture, module visibility model, interface contracts, and dependency graph.
