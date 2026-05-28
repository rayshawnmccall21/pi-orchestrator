# Pi-Orchestrator Product Brief

Pipeline orchestrator for BMAD agent workflows. Supervises child Pi sessions
across git worktrees, preserves artifact ownership, provides JSONL observability,
enforces safe worktree lifecycle, and exposes slash/tool/headless/TUI surfaces
from one state model.

## Key Capability
Dispatch pi-bmad agents to isolated git worktrees, collect typed
HeadlessWorkflowOutput results, and route through the story lifecycle FSM
for deterministic conditional branching.
