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

## 5) How pi-orchestrator Drives pi-bmad

pi-orchestrator is a **deterministic conditional software factory** that uses
pi-bmad as its execution engine. The architecture is:

1. pi-orchestrator spawns a headless pi-bmad child process in an isolated git worktree
2. pi-bmad runs a workflow end-to-end via its auto-advance loop
3. pi-bmad emits a typed `HeadlessWorkflowOutput<T>` JSON on stdout at completion
4. pi-orchestrator parses the JSON, extracts the typed payload, and routes
   deterministically through the story lifecycle FSM to decide the next workflow
5. Repeat until all stories reach `done`, `blocked`, or `escalated`

### Child Process Launch

```bash
pi -ne \
  -e <pi-pi-extension> \
  -e <pi-bmad-extension> \
  --bmad-workflow <workflowId> \
  --bmad-agent <agentId> \
  -p "<dispatch prompt>"
```

### Data Flow

```
pi-orchestrator                         pi-bmad (child process)
───────────────────────────────────────         ─────────────────────────────
                                        Workflow YAML has returns: block
spawn-worker-pool.ts                    with contractVersion, typeId,
  │ provision(config)                   schemaPath, emitter
  │ → git worktree add                          │
  │ → spawn pi --bmad-workflow          headless-workflow.ts
  │                                       │ bootstrapHeadlessWorkflow()
  │                                       │ → /workflow start
  │                                       │ → sendFollowUp("/workflow advance")
  │  collects stdout                      │ → auto-advance loop until terminal
  │                                       │
  │                                     result-builder.ts
  │                                       │ buildHeadlessWorkflowOutput()
  │                                       │ → assembles typed envelope
  │                                     result-validator.ts
  │                                       │ validateResultPayload()
  │                                       │ → validates payload vs JSON Schema
  │                                       │
  │  ← stdout: HeadlessWorkflowOutput    │ writeJsonLine(output)
  │  ← exit code: 0/1/2                  │ setExitCode()
  │                                       │
headless-output-parser.ts
  │ parseHeadlessOutput(stdout)
  │ → validates schemaVersion tag
  │ → extracts last valid JSON
  │
result-mapper.ts
  │ mapResultToOutcome(output)
  │ → maps payload to FSM semantic outcome
  │   e.g. e2e-verify { verdict: "fail" } → FAIL
  │        code-review { verdict: "approved" } → APPROVED
  │
story-lifecycle.ts
  │ applyStoryOutcome(lifecycle, outcome)
  │ → deterministic FSM transition
  │   FAIL below budget → next: dev-story
  │   PASS → next: code-review
  │   APPROVED → next: done
  │
scheduler (planned)
  │ planNext() → dispatch next workflow
```

### HeadlessWorkflowOutput Contract

pi-bmad emits this JSON envelope to stdout. pi-orchestrator parses it.

```typescript
interface HeadlessWorkflowOutput<T> {
  schemaVersion: "pi-bmad.headless-workflow-result.v1";
  workflow: string;          // "dev-story", "e2e-verify", etc.
  returnType: string;        // "pi-bmad.workflow.dev-story.result.v1"
  status: "success" | "partial" | "failed";
  exitCode: 0 | 1 | 2;
  completedSteps: string[];
  failedSteps: { step: string; reason: string }[];
  artifacts: Record<string, string>;
  payload: T | null;         // per-workflow typed data
  emittedAt: string;
  durationMs: number;
}
```

The `payload` field is workflow-specific and validated against a JSON Schema
declared in the workflow's `returns.schemaPath`. Key payload shapes:

| Workflow | Payload Type | Routing Field |
|---|---|---|
| `create-story` | `{ storyId, storyPath, acceptanceCriteriaCount }` | status |
| `e2e-plan` | `{ storyId, scenarioCount, coverageComplete }` | status |
| `dev-story` | `{ storyId, testsAdded, filesChanged, testsPassed, ... }` | status |
| `e2e-verify` | `{ storyId, scenariosPassed, scenariosFailed, verdict }` | `verdict: "pass" \| "fail"` |
| `code-review` | `{ storyId, verdict, findingsBySeverity, autoFixed }` | `verdict: "approved" \| "needs-dev" \| "needs-verify"` |

### Story Lifecycle FSM

The routing is deterministic — no LLM decisions, no tmux scraping:

```
create-story ──success──► e2e-plan ──success──► dev-story
                                                 │
                                             success
                                                 │
    done ◄──approved── code-review ◄──pass── e2e-verify
                          │                       │
                      needs-dev              fail (< budget)
                          │                       │
                          └────► dev-story ◄─────┘
```

### pi-bmad Provider Documentation

The provider-side contract is documented at:
- pi-bmad `.pi/SYSTEM.md` §7 — headless CLI, return contract, envelope structure
- pi-bmad `docs/ARCHITECTURE.md` "Headless Execution & External Integration" section
- pi-bmad `docs/adr/0019-structured-workflow-result.md` — full ADR with examples
- pi-bmad `src/types.ts` — `HeadlessWorkflowOutput<T>`, `WorkflowReturnContract`
- pi-bmad `content/schemas/` — per-workflow JSON Schemas
- GitHub: `github.com/rayshawnmccall21/pi-bmad`

## 6) Commands
- `npm run test:unit` — run unit tests
- `npm run test:integration` — run integration tests
- `npm run typecheck` — type check
- `npm run lint` — lint
- `npm run check` — full CI (typecheck + lint + format + tests + arch + dead code)
