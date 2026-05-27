/**
 * Package bootstrap smoke test.
 *
 * Verifies that the pi-orchestrator package skeleton is installed correctly
 * and that basic module resolution will work for future story implementations.
 * Satisfies the "vitest unit command succeeds with placeholder tests" scenario
 * from the R-S1 E2E test plan.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Resolve the package root from this test file's location:
// test/unit/package-bootstrap.test.ts → ../../ → pi-orchestrator/
const testFileDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(testFileDir, "..", "..");

function readJson(relativePath: string): Record<string, unknown> {
  const absolutePath = join(packageRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf-8")) as Record<string, unknown>;
}

describe("pi-orchestrator package bootstrap", () => {
  describe("package root structure", () => {
    it("package.json exists at package root", () => {
      expect(existsSync(join(packageRoot, "package.json"))).toBe(true);
    });

    it("src/extension/index.ts exists at the pi.extensions entry path", () => {
      expect(existsSync(join(packageRoot, "src", "extension", "index.ts"))).toBe(true);
    });

    it("skills/pi-orchestrator/SKILL.md exists at the pi.skills path", () => {
      expect(existsSync(join(packageRoot, "skills", "pi-orchestrator", "SKILL.md"))).toBe(true);
    });

    it("prompts/ORCHESTRATOR.md exists at the pi.prompts path", () => {
      expect(existsSync(join(packageRoot, "prompts", "ORCHESTRATOR.md"))).toBe(true);
    });
  });

  describe("package manifest correctness", () => {
    it("package name is pi-orchestrator", () => {
      const manifest = readJson("package.json");
      expect(manifest["name"]).toBe("pi-orchestrator");
    });

    it("package type is module", () => {
      const manifest = readJson("package.json");
      expect(manifest["type"]).toBe("module");
    });

    it("pi.extensions entry points to src/extension/index.ts", () => {
      const manifest = readJson("package.json");
      const piField = manifest["pi"] as Record<string, unknown>;
      const extensions = piField["extensions"] as string[];
      expect(extensions).toContain("./src/extension/index.ts");
    });
  });
});
