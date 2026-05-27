---
name: pi-orchestrator
description: Pipeline orchestrator skill for supervising BMAD agent workflows across git worktrees
version: 0.1.0
---

# pi-orchestrator Skill

This skill provides pipeline orchestration capabilities for the Pi coding agent. It enables the agent to supervise BMAD worker sessions running in isolated git worktrees, coordinate their work through a typed event bus, and merge completed work back to the main branch.

## Commands

> **Note:** All slash commands are pending implementation in R-S14. The package skeleton (R-S1) does not wire any commands. Invoking these before R-S14 is complete will produce an "unknown command" error.

| Command | Description |
|---|---|
| `/pipeline-start [scope]` | Start a pipeline run, optionally scoped to a phase |
| `/pipeline-status` | Show current pipeline and worker session status |
| `/pipeline-list` | List active dispatches and worker sessions |
| `/pipeline-steer <sessionId> <message>` | Send steering guidance to a worker |
| `/pipeline-pause` | Pause the dispatch loop |
| `/pipeline-resume` | Resume the dispatch loop |
| `/pipeline-abort [reason]` | Abort the pipeline run |
| `/pipeline-escalate [reason]` | Escalate a blocking issue |
| `/pipeline-result` | Show the final pipeline result |

## Surfaces

The orchestrator exposes three surfaces that share one state model:

- **Slash commands** — Interactive control via Pi slash commands
- **Tool** — Programmatic control via the `bmad_pipeline` tool
- **TUI** — Real-time dashboard widget showing worker status and pipeline progress

## Safety

All commands route through the `OrchestratorActions` typed boundary. No surface can bypass the run controller or write state directly.

## Package

This skill is part of the `pi-orchestrator` package. See the package README for installation and configuration details.
