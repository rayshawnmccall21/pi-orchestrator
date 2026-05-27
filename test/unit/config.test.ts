/**
 * Unit tests for pi-orchestrator/src/config.ts — pure static config parsing.
 *
 * Tests verify the Section 5.1 contract:
 * - loadConfig(env) returns OrchestratorConfig with correct defaults
 * - Override env vars are recorded as-is (no path resolution)
 * - Invalid values throw OrchestratorError with field context
 * - No filesystem access, no shell execution, no direct process.env
 */

import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { OrchestratorError } from "../../src/shared/errors.js";
import type { OrchestratorConfig, TriagePolicyConfig } from "../../src/config.js";

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Minimal valid env record with only required values set. */
function minimalValidEnv(): Record<string, string | undefined> {
  return {
    PI_CODING_AGENT_DIR: "/opt/pi-coding-agent",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC-1: Defaults match consensus contract
// ═══════════════════════════════════════════════════════════════════════════

describe("loadConfig", () => {
  describe("AC-1: defaults with no optional env vars", () => {
    it("returns maxWorkers defaulting to 3", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.maxWorkers).toBe(3);
    });

    it("returns logLevel defaulting to 'info'", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.logLevel).toBe("info");
    });

    it("returns hasUI defaulting to false", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.hasUI).toBe(false);
    });

    it("returns worktreeBaseOverride defaulting to null", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.worktreeBaseOverride).toBeNull();
    });

    it("returns stateRootOverride defaulting to null", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.stateRootOverride).toBeNull();
    });

    it("returns piCodingAgentDir from the env record", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.piCodingAgentDir).toBe("/opt/pi-coding-agent");
    });

    it("returns triage.maxSteersPerStep defaulting to 2", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.maxSteersPerStep).toBe(2);
    });

    it("returns triage.maxRetries defaulting to 2", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.maxRetries).toBe(2);
    });

    it("returns triage.escalationThreshold defaulting to 3", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.escalationThreshold).toBe(3);
    });

    it("returns triage.staleThresholdMs defaulting to 600_000", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.staleThresholdMs).toBe(600_000);
    });

    it("returns triage.promptTimeoutMs defaulting to 60_000", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.promptTimeoutMs).toBe(60_000);
    });

    it("returns triage.maxReviewLoops defaulting to 3", () => {
      const config = loadConfig(minimalValidEnv());
      expect(config.triage.maxReviewLoops).toBe(3);
    });

    it("returns a config shape matching Section 5.1 exactly", () => {
      const config = loadConfig(minimalValidEnv());

      // Verify all top-level keys exist
      const expectedKeys = [
        "maxWorkers",
        "logLevel",
        "hasUI",
        "triage",
        "worktreeBaseOverride",
        "stateRootOverride",
        "piCodingAgentDir",
      ];
      expect(Object.keys(config).sort()).toEqual(expectedKeys.sort());

      // Verify triage sub-keys
      const expectedTriageKeys = [
        "maxSteersPerStep",
        "maxRetries",
        "escalationThreshold",
        "staleThresholdMs",
        "promptTimeoutMs",
        "maxReviewLoops",
      ];
      expect(Object.keys(config.triage).sort()).toEqual(expectedTriageKeys.sort());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-2: Override env vars recorded as values
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-2: override env vars are recorded as values", () => {
    it("records ORCHESTRATOR_WORKTREE_BASE as worktreeBaseOverride", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_WORKTREE_BASE: "/custom/worktrees",
      };
      const config = loadConfig(env);
      expect(config.worktreeBaseOverride).toBe("/custom/worktrees");
    });

    it("records ORCHESTRATOR_STATE_ROOT as stateRootOverride", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_STATE_ROOT: "/custom/state",
      };
      const config = loadConfig(env);
      expect(config.stateRootOverride).toBe("/custom/state");
    });

    it("does not resolve or normalize worktreeBaseOverride paths", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_WORKTREE_BASE: "../relative/path",
      };
      const config = loadConfig(env);
      // Stored as-is, no path resolution
      expect(config.worktreeBaseOverride).toBe("../relative/path");
    });

    it("does not resolve or normalize stateRootOverride paths", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_STATE_ROOT: "relative/state/../root",
      };
      const config = loadConfig(env);
      // Stored as-is, no path resolution
      expect(config.stateRootOverride).toBe("relative/state/../root");
    });

    it("overrides maxWorkers from ORCHESTRATOR_MAX_WORKERS", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: "5",
      };
      const config = loadConfig(env);
      expect(config.maxWorkers).toBe(5);
    });

    it("overrides logLevel from ORCHESTRATOR_LOG_LEVEL", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_LOG_LEVEL: "debug",
      };
      const config = loadConfig(env);
      expect(config.logLevel).toBe("debug");
    });

    it("overrides hasUI from ORCHESTRATOR_HAS_UI", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_HAS_UI: "true",
      };
      const config = loadConfig(env);
      expect(config.hasUI).toBe(true);
    });

    it("treats empty ORCHESTRATOR_WORKTREE_BASE as null (not set)", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_WORKTREE_BASE: "",
      };
      const config = loadConfig(env);
      expect(config.worktreeBaseOverride).toBeNull();
    });

    it("treats empty ORCHESTRATOR_STATE_ROOT as null (not set)", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_STATE_ROOT: "",
      };
      const config = loadConfig(env);
      expect(config.stateRootOverride).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-3: Invalid numeric or enum config values
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-3: invalid values throw OrchestratorError", () => {
    it("returns default PI_CODING_AGENT_DIR when not set", () => {
      const config = loadConfig({});
      expect(config.piCodingAgentDir).toBe("~/.pi/agent");
    });

    it("returns default PI_CODING_AGENT_DIR when empty string", () => {
      const config = loadConfig({ PI_CODING_AGENT_DIR: "" });
      expect(config.piCodingAgentDir).toBe("~/.pi/agent");
    });

    it("includes field context in error for invalid ORCHESTRATOR_LOG_LEVEL", () => {
      try {
        loadConfig({ ...minimalValidEnv(), ORCHESTRATOR_LOG_LEVEL: "invalid" });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
        const orchestratorError = error as OrchestratorError;
        expect(orchestratorError.context).toBeDefined();
        expect(orchestratorError.context?.["field"]).toBe("ORCHESTRATOR_LOG_LEVEL");
      }
    });

    it("throws OrchestratorError for non-integer ORCHESTRATOR_MAX_WORKERS", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: "3.5",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("throws OrchestratorError for negative ORCHESTRATOR_MAX_WORKERS", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: "-1",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("throws OrchestratorError for zero ORCHESTRATOR_MAX_WORKERS", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: "0",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("throws OrchestratorError for non-numeric ORCHESTRATOR_MAX_WORKERS", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: "banana",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("includes field context for invalid maxWorkers", () => {
      try {
        loadConfig({
          ...minimalValidEnv(),
          ORCHESTRATOR_MAX_WORKERS: "abc",
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
        const orchestratorError = error as OrchestratorError;
        expect(orchestratorError.context?.["field"]).toBe("ORCHESTRATOR_MAX_WORKERS");
      }
    });

    it("throws OrchestratorError for invalid ORCHESTRATOR_LOG_LEVEL", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_LOG_LEVEL: "verbose",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("includes field context for invalid logLevel", () => {
      try {
        loadConfig({
          ...minimalValidEnv(),
          ORCHESTRATOR_LOG_LEVEL: "trace",
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
        const orchestratorError = error as OrchestratorError;
        expect(orchestratorError.context?.["field"]).toBe("ORCHESTRATOR_LOG_LEVEL");
      }
    });

    it("throws OrchestratorError for invalid ORCHESTRATOR_HAS_UI", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_HAS_UI: "yes",
      };
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });

    it("includes field context for invalid hasUI", () => {
      try {
        loadConfig({
          ...minimalValidEnv(),
          ORCHESTRATOR_HAS_UI: "maybe",
        });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
        const orchestratorError = error as OrchestratorError;
        expect(orchestratorError.context?.["field"]).toBe("ORCHESTRATOR_HAS_UI");
      }
    });

    it("uses a config-specific error code", () => {
      // PI_CODING_AGENT_DIR is now optional, so we test an invalid LOG_LEVEL instead
      try {
        loadConfig({ ...minimalValidEnv(), ORCHESTRATOR_LOG_LEVEL: "invalid" });
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
        const orchestratorError = error as OrchestratorError;
        expect(orchestratorError.code).toMatch(/CONFIG/i);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-4: No filesystem access, no shell, no direct process.env
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-4: purity — only uses the supplied env record", () => {
    it("does not read process.env when env record lacks a key", () => {
      // Set a process.env value that config would pick up if it read process.env
      const originalValue = process.env["ORCHESTRATOR_MAX_WORKERS"];
      process.env["ORCHESTRATOR_MAX_WORKERS"] = "99";

      try {
        const config = loadConfig(minimalValidEnv());
        // If loadConfig read process.env, maxWorkers would be 99
        expect(config.maxWorkers).toBe(3);
      } finally {
        if (originalValue === undefined) {
          delete process.env["ORCHESTRATOR_MAX_WORKERS"];
        } else {
          process.env["ORCHESTRATOR_MAX_WORKERS"] = originalValue;
        }
      }
    });

    it("returns without importing fs, path, or child_process", async () => {
      // Read the source file and check for forbidden imports
      const { readFileSync } = await import("node:fs");
      const sourceContent = readFileSync(new URL("../../src/config.ts", import.meta.url), "utf-8");

      expect(sourceContent).not.toMatch(/from\s+["']node:fs["']/);
      expect(sourceContent).not.toMatch(/from\s+["']node:child_process["']/);
      expect(sourceContent).not.toMatch(/from\s+["']node:path["']/);
      expect(sourceContent).not.toMatch(/require\s*\(\s*["']fs["']\s*\)/);
      expect(sourceContent).not.toMatch(/require\s*\(\s*["']child_process["']\s*\)/);
      expect(sourceContent).not.toMatch(/process\.env/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AC-5: Shape matches Section 5.1
  // ═══════════════════════════════════════════════════════════════════════════

  describe("AC-5: TypeScript shape conformance", () => {
    it("returns an object assignable to OrchestratorConfig", () => {
      const config: OrchestratorConfig = loadConfig(minimalValidEnv());
      // Type check is compile-time; runtime check that all fields are present
      expect(config).toBeDefined();
      expect(typeof config.maxWorkers).toBe("number");
      expect(typeof config.logLevel).toBe("string");
      expect(typeof config.hasUI).toBe("boolean");
      expect(typeof config.piCodingAgentDir).toBe("string");
      expect(config.triage).toBeDefined();
    });

    it("triage sub-object is assignable to TriagePolicyConfig", () => {
      const config = loadConfig(minimalValidEnv());
      const triageConfig: TriagePolicyConfig = config.triage;
      expect(typeof triageConfig.maxSteersPerStep).toBe("number");
      expect(typeof triageConfig.maxRetries).toBe("number");
      expect(typeof triageConfig.escalationThreshold).toBe("number");
      expect(typeof triageConfig.staleThresholdMs).toBe("number");
      expect(typeof triageConfig.promptTimeoutMs).toBe("number");
      expect(typeof triageConfig.maxReviewLoops).toBe("number");
    });

    it("accepts all four valid logLevel values", () => {
      for (const level of ["debug", "info", "warn", "error"]) {
        const config = loadConfig({
          ...minimalValidEnv(),
          ORCHESTRATOR_LOG_LEVEL: level,
        });
        expect(config.logLevel).toBe(level);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Adversarial / Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe("adversarial edge cases", () => {
    it("ignores unknown env vars without error", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_UNKNOWN_SETTING: "something",
        TOTALLY_RANDOM_VAR: "42",
      };
      const config = loadConfig(env);
      expect(config.maxWorkers).toBe(3);
    });

    it("does not leak secret env vars into the config object", () => {
      const env = {
        ...minimalValidEnv(),
        API_KEY: "super-secret",
        OPENAI_API_KEY: "sk-xxx",
        ANTHROPIC_API_KEY: "sk-ant-xxx",
      };
      const config = loadConfig(env);
      const configJson = JSON.stringify(config);
      expect(configJson).not.toContain("super-secret");
      expect(configJson).not.toContain("sk-xxx");
      expect(configJson).not.toContain("sk-ant-xxx");
    });

    it("handles ORCHESTRATOR_MAX_WORKERS with leading/trailing whitespace", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_MAX_WORKERS: " 4 ",
      };
      // Should either parse successfully to 4 or throw OrchestratorError
      // Trimming is acceptable but it must not silently produce NaN
      try {
        const config = loadConfig(env);
        expect(config.maxWorkers).toBe(4);
      } catch (error) {
        expect(error).toBeInstanceOf(OrchestratorError);
      }
    });

    it("handles ORCHESTRATOR_LOG_LEVEL with wrong case", () => {
      const env = {
        ...minimalValidEnv(),
        ORCHESTRATOR_LOG_LEVEL: "DEBUG",
      };
      // Should throw because enum values are lowercase
      expect(() => loadConfig(env)).toThrow(OrchestratorError);
    });
  });
});
