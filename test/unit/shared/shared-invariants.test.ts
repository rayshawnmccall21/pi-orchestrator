/**
 * Invariant tests for shared utilities.
 * INV-1: No direct child_process imports outside process.ts.
 * INV-2: No `any` type in shared source files.
 * INV-SHELL-SAFETY: No `shell: true` or `exec(`/`execSync` in shared files.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SHARED_DIR = path.resolve(import.meta.dirname, "../../../src/shared");

const SHARED_FILES = [
  "paths.ts",
  "atomic-json.ts",
  "jsonl-log.ts",
  "process.ts",
  "git.ts",
  "tmux.ts",
];

function readSharedFile(filename: string): string {
  return fs.readFileSync(path.join(SHARED_DIR, filename), "utf-8");
}

describe("shared utility invariants", () => {
  describe("INV-1: no child_process imports outside process.ts", () => {
    it("paths.ts does not import child_process", () => {
      const content = readSharedFile("paths.ts");
      expect(content).not.toContain("child_process");
    });

    it("atomic-json.ts does not import child_process", () => {
      const content = readSharedFile("atomic-json.ts");
      expect(content).not.toContain("child_process");
    });

    it("jsonl-log.ts does not import child_process", () => {
      const content = readSharedFile("jsonl-log.ts");
      expect(content).not.toContain("child_process");
    });

    it("git.ts does not import child_process", () => {
      const content = readSharedFile("git.ts");
      expect(content).not.toContain("child_process");
    });

    it("tmux.ts does not import child_process", () => {
      const content = readSharedFile("tmux.ts");
      expect(content).not.toContain("child_process");
    });
  });

  describe("INV-2: no any in shared source files", () => {
    for (const filename of SHARED_FILES) {
      it(`${filename} contains no ': any' outside comments`, () => {
        const content = readSharedFile(filename);
        const lines = content.split("\n");
        for (const line of lines) {
          // Skip comment lines
          const trimmed = line.trim();
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          // Check for `: any` pattern (type annotation)
          expect(line).not.toMatch(/:\s*any\b/);
          // Check for `as any` pattern (type assertion)
          expect(line).not.toMatch(/as\s+any\b/);
        }
      });
    }
  });

  describe("INV-SHELL-SAFETY: no shell strings in shared files", () => {
    for (const filename of SHARED_FILES) {
      it(`${filename} does not use shell: true`, () => {
        const content = readSharedFile(filename);
        expect(content).not.toMatch(/shell\s*:\s*true/);
      });
    }

    it("process.ts does not use exec( or execSync", () => {
      const content = readSharedFile("process.ts");
      // Should use spawn/spawnSync patterns, not exec/execSync
      expect(content).not.toMatch(/\bexec\(/);
      expect(content).not.toMatch(/\bexecSync\(/);
    });
  });
});
