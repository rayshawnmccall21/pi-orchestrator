# Pi-Orchestrator Project Context (SYSTEM)

## 1) Technology Stack
- Runtime/tooling: **Node.js 20+** with ESM
- Language: **TypeScript** with `strict: true`
- Testing: **Vitest** (run via `npm run test:unit`)
- Linting: **ESLint** with typescript-eslint
- Formatting: **Prettier**
- Architecture linting: **dependency-cruiser**
- Dead code detection: **Knip**

## 2) Project Structure
- `src/` — core source modules:
  - `shared/` — domain types, errors, ports (git, tmux, process, paths)
  - `config.ts` — static config from env (pure, no I/O)
  - `bootstrap.ts` — runtime startup sequencer
  - `state/` — pipeline state manager + story lifecycle FSM + worktree registry
  - `events/` — typed event bus + child JSONL parser + headless output parser
  - `workers/pool/` — worker lifecycle management
  - `scheduling/` — dispatch planning engine
  - `triage/` — failure classification + authorization gates
  - `run/controller/` — orchestration brain
  - `actions.ts` — OrchestratorActions typed boundary
  - `builder/` — builder tools for workflow/agent/checkpoint CRUD
  - `slash/` — slash command implementations
  - `tui/` — TUI dashboard and render primitives
  - `extension/` — Pi extension entry point (hooks + wiring)
- `test/` — tests (unit + integration)
- `prompts/` — hot-reloaded orchestrator prompt
- `skills/` — Pi skill descriptors

## 3) Implementation Rules
- Follow strict **TDD**: **Red → Green → Refactor**.
- Never use `any`; use explicit types or `unknown` + type guards.
- Prefer pure functions; isolate side effects at module boundaries.
- All state mutations go through `PipelineStateManager.apply()`.
- All surface calls route through `OrchestratorActions` boundary.
- No raw shell interpolation — use argv arrays.
- No imports escaping the package boundary.

## 4) Coding Conventions
- Use descriptive names: `checkpointResult` not `res`, `workflowDef` not `wf`.
- Every exported function has a JSDoc with `@param`, `@returns`, `@example`.
- Error classes use `OrchestratorError` with machine-readable codes.
- Discriminated unions for all result types.

## 5) Commands
- `npm run test:unit` — run unit tests
- `npm run test:integration` — run integration tests
- `npm run typecheck` — type check
- `npm run lint` — lint
- `npm run check` — full CI (typecheck + lint + format + tests + arch + dead code)
