import type { KnipConfig } from "knip";

/**
 * Knip dead-code configuration for pi-orchestrator.
 *
 * Entry point mirrors the pi.extensions manifest field. Config/tooling
 * files (vitest.config.ts, eslint.config.mjs, etc.) are auto-discovered.
 */
const knipConfig: KnipConfig = {
  entry: [
    "src/extension/index.ts",
    // Shared types and errors are consumed by all domain modules (R-S3+).
    // Registered here so knip does not flag them as dead before consumers land.
    "src/shared/types.ts",
    "src/shared/errors.ts",
    // Shared utility public seams (R-S3). Consumed by config, events, state,
    // registry, workers, bootstrap, and run controller in R-S4+.
    "src/shared/paths.ts",
    "src/shared/atomic-json.ts",
    "src/shared/jsonl-log.ts",
    "src/shared/process.ts",
    "src/shared/git.ts",
    "src/shared/tmux.ts",
    // Event bus public seam (R-S5). Consumed by state, workers, run
    // controller, actions, and surfaces in R-S6+.
    "src/events/bus.ts",
    // State authority public seam (R-S6). Consumed by bootstrap, run
    // controller, actions, surfaces, and dashboard in R-S8+.
    "src/state/pipeline.ts",
    // Child parser (R-S5). Consumed by event bus child stream handling.
    "src/events/child-parser.ts",
    // Story lifecycle reducer (R-S6). Consumed by state pipeline manager.
    "src/state/story-lifecycle.ts",
    // Worktree registry (R-S7). Consumed by bootstrap, workers, run controller.
    "src/state/worktree-registry.ts",
    // Worker pool (R-S8). Consumed by bootstrap, run controller, actions.
    "src/workers/pool/index.ts",
    // Scheduling engine (R-S9). Consumed by bootstrap, run controller.
    "src/scheduling/engine.ts",
    // Triage engine (R-S10). Consumed by bootstrap, run controller.
    "src/triage/engine.ts",
    // Authorization policy (R-S11). Consumed by bootstrap, run controller.
    "src/triage/authorization.ts",
    // Run controller (R-S12). Consumed by bootstrap, actions.
    "src/run/controller/index.ts",
    // Actions boundary (R-S13). Consumed by bootstrap, extension, surfaces.
    "src/actions.ts",
    // Config (R-S4). Consumed by bootstrap and all modules.
    "src/config.ts",
    // Bootstrap sequencer (R-S15). Consumed by extension entry.
    "src/bootstrap.ts",
  ],
  project: ["src/**/*.ts"],
  ignoreDependencies: [
    // typebox: declared in manifest per refactor plan Section 4; imported in R-S2+
    "typebox",
    // @vitest/coverage-v8: consumed by vitest --coverage flag, not a direct import
    "@vitest/coverage-v8",
    // Pi extension APIs: in devDependencies per refactor plan Section 4; imported in R-S15+
    // NOTE: these packages are deprecated (→ @earendil-works/); migration tracked separately.
    "@mariozechner/pi-coding-agent",
    "@mariozechner/pi-tui",
  ],
};

export default knipConfig;
