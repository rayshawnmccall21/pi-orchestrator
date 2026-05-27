/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ── Universal rules ────────────────────────────────────────────────────
    {
      name: "no-circular",
      severity: "error",
      comment: "No circular dependencies allowed.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "No orphan files (unreachable from entry points).",
      from: {
        orphan: true,
        pathNot: [
          "\\.test\\.ts$",
          "\\.d\\.ts$",
          // Extension entry IS the package entry point — not imported by anything inside the package
          "^src/extension/index\\.ts$",
        ],
      },
      to: {},
    },

    // ── INV-1: No pi-bmad src/types imports ────────────────────────────────
    {
      name: "no-pi-bmad-src-types",
      severity: "error",
      comment: "pi-orchestrator must never import from pi-bmad src/types.ts.",
      from: { path: "^src/" },
      to: { path: "pi-bmad/src/types" },
    },

    // ── Layer: shared/ is the foundation ───────────────────────────────────
    {
      name: "shared-does-not-import-domain",
      severity: "error",
      comment: "shared/ utilities must not import from domain layers.",
      from: { path: "^src/shared/" },
      to: {
        path: "^src/(state|events|workers|scheduling|triage|run|actions|slash|tui|bootstrap)\\.?",
      },
    },
    {
      name: "config-does-not-import-domain",
      severity: "error",
      comment: "config.ts must not import from domain layers (pure env only).",
      from: { path: "^src/config\\.ts$" },
      to: {
        path: "^src/(state|events|workers|scheduling|triage|run|actions|slash|tui|bootstrap)\\.?",
      },
    },

    // ── Layer: surfaces call through actions only ───────────────────────────
    {
      name: "surfaces-use-actions-boundary",
      severity: "error",
      comment: "Slash commands and TUI must route through actions.ts, not state/workers directly.",
      from: { path: "^src/(slash|tui)/" },
      to: { path: "^src/(state|workers|run)/" },
    },

    // ── Layer: extension calls bootstrap, not internals directly ───────────
    // extension/index.ts may import: bootstrap.ts, actions.ts, slash/, tui/
    // extension/index.ts must NOT bypass bootstrap by importing state/events/workers/run directly.
    {
      name: "extension-uses-bootstrap",
      severity: "error",
      comment: "extension/index.ts must not import domain internals (state/events/workers/scheduling/triage/run) directly; all orchestration wires through bootstrap.ts.",
      from: { path: "^src/extension/index\.ts$" },
      to: {
        path: "^src/(state|events|workers|scheduling|triage|run)/",
      },
    },

    // ── Locality: private files must not be imported cross-domain ──────────
    {
      name: "workers-pool-private-locality",
      severity: "error",
      comment: "Private files inside workers/pool/ must not be imported outside workers/.",
      from: { pathNot: "^src/workers/" },
      to: {
        path: "^src/workers/pool/(transport|worktree-lifecycle|heartbeat|child-state)\\.ts$",
      },
    },
    {
      name: "run-controller-private-locality",
      severity: "error",
      comment: "Private files inside run/controller/ must not be imported outside run/.",
      from: { pathNot: "^src/run/" },
      to: { path: "^src/run/controller/(reconcile|merge|tick)\\.ts$" },
    },
    {
      name: "events-child-parser-private-locality",
      severity: "error",
      comment: "child-parser.ts is private to events/; import events/bus.ts instead.",
      from: { pathNot: "^src/events/" },
      to: { path: "^src/events/child-parser\\.ts$" },
    },
    {
      name: "state-story-lifecycle-private-locality",
      severity: "error",
      comment: "story-lifecycle.ts is private to state/; it must not be imported directly.",
      from: { pathNot: "^src/state/" },
      to: { path: "^src/state/story-lifecycle\\.ts$" },
    },
    {
      name: "extension-schemas-private-locality",
      severity: "error",
      comment: "extension/schemas.ts is private to extension/.",
      from: { pathNot: "^src/extension/" },
      to: { path: "^src/extension/schemas\\.ts$" },
    },
  ],

  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
