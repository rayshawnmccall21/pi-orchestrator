/**
 * Unit tests for shared/paths.ts — OrchestratorPaths resolution.
 * Covers AC-1: resolveOrchestratorPaths with package root, project root, env.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { resolveOrchestratorPaths } from "../../../src/shared/paths.js";

describe("paths", () => {
  let tempDir: string;
  let packageRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paths-test-"));
    packageRoot = path.join(tempDir, "package");
    projectRoot = path.join(tempDir, "project");
    // Set up minimal package structure
    await fs.mkdir(path.join(packageRoot, "prompts"), { recursive: true });
    await fs.writeFile(path.join(packageRoot, "prompts", "ORCHESTRATOR.md"), "# Default prompt");
    await fs.mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("resolveOrchestratorPaths", () => {
    it("resolves stateRoot to <projectRoot>/.pi/orchestrator/ by default", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.stateRoot).toBe(path.join(projectRoot, ".pi", "orchestrator"));
    });

    it("resolves logRoot to <stateRoot>/logs/", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.logRoot).toBe(path.join(projectRoot, ".pi", "orchestrator", "logs"));
    });

    it("resolves pipelineStatePath inside stateRoot", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.pipelineStatePath).toBe(
        path.join(projectRoot, ".pi", "orchestrator", "pipeline-state.json"),
      );
    });

    it("resolves worktreeRegistryPath inside stateRoot", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.worktreeRegistryPath).toBe(
        path.join(projectRoot, ".pi", "orchestrator", "worktree-registry.json"),
      );
    });

    it("resolves promptPath to package default when no project override exists", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.promptPath).toBe(path.join(packageRoot, "prompts", "ORCHESTRATOR.md"));
    });

    it("resolves promptPath to project override when present", async () => {
      const overridePath = path.join(projectRoot, ".pi", "orchestrator", "ORCHESTRATOR.md");
      await fs.mkdir(path.dirname(overridePath), { recursive: true });
      await fs.writeFile(overridePath, "# Project override");

      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.promptPath).toBe(overridePath);
    });

    it("resolves worktreeBase to <projectRoot>/.trees by default", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.worktreeBase).toBe(path.join(projectRoot, ".trees"));
    });

    it("resolves worktreeBase from ORCHESTRATOR_WORKTREE_BASE env", async () => {
      const customBase = path.join(tempDir, "custom-trees");
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: { ORCHESTRATOR_WORKTREE_BASE: customBase },
      });
      expect(paths.worktreeBase).toBe(customBase);
    });

    it("creates stateRoot directory if missing", async () => {
      await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const stateRoot = path.join(projectRoot, ".pi", "orchestrator");
      const stat = await fs.stat(stateRoot);
      expect(stat.isDirectory()).toBe(true);
    });

    it("creates logRoot directory if missing", async () => {
      await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const logRoot = path.join(projectRoot, ".pi", "orchestrator", "logs");
      const stat = await fs.stat(logRoot);
      expect(stat.isDirectory()).toBe(true);
    });

    it("does NOT create worktreeBase directory", async () => {
      await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const worktreeBase = path.join(projectRoot, ".trees");
      await expect(fs.stat(worktreeBase)).rejects.toThrow();
    });

    it("stores packageRoot as provided", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.packageRoot).toBe(packageRoot);
    });

    it("stores projectRoot as provided", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      expect(paths.projectRoot).toBe(projectRoot);
    });

    it("resolves childProjectRoot within a worktree path", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const worktreePath = "/tmp/trees/worker-abc";
      expect(paths.childProjectRoot(worktreePath)).toBe(worktreePath);
    });

    it("resolves childBmadStatePath within a worktree path", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const worktreePath = "/tmp/trees/worker-abc";
      expect(paths.childBmadStatePath(worktreePath)).toBe(
        path.join(worktreePath, ".pi", "state", "bmad", "session-state.json"),
      );
    });

    it("applies stateRoot override from env", async () => {
      const customStateRoot = path.join(tempDir, "custom-state");
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: { ORCHESTRATOR_STATE_ROOT: customStateRoot },
      });
      expect(paths.stateRoot).toBe(customStateRoot);
    });

    it("does NOT contain legacy repoRoot/orchestrator path patterns", async () => {
      const paths = await resolveOrchestratorPaths({
        packageRoot,
        projectRoot,
        env: {},
      });
      const allPaths = [
        paths.stateRoot,
        paths.logRoot,
        paths.pipelineStatePath,
        paths.worktreeRegistryPath,
        paths.promptPath,
      ];
      for (const resolvedPath of allPaths) {
        expect(resolvedPath).not.toContain("/orchestrator/.pi/");
      }
    });
  });
});
