/**
 * Import independence tests for R-S2 (AC-3, INV-1, INV-2).
 * Uses path.resolve() to detect imports that escape pi-orchestrator/.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync, realpathSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testFileDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(join(testFileDir, "..", "..", ".."));
const worktreeRoot = resolve(join(packageRoot, ".."));

interface Violation {
  file: string;
  line: number;
  content: string;
}

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectTsFiles(full));
    else if (entry.name.endsWith(".ts")) results.push(full);
  }
  return results;
}

function scanForEscapingImports(dir: string): Violation[] {
  const violations: Violation[] = [];
  const files = collectTsFiles(dir);
  const importRe = /(?:^|\s)(?:import|export)[^'"]*from\s+['"](\.[^'"]+)['"]/gm;

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const fileDir = dirname(file);
    let match: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((match = importRe.exec(source)) !== null) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      const bare = specifier.replace(/\.js$/, "");
      const resolvedPath = resolve(fileDir, bare);
      if (!resolvedPath.startsWith(packageRoot + "/") && resolvedPath !== packageRoot) {
        const lineNum = source.slice(0, match.index).split("\n").length;
        const lines = source.split("\n");
        violations.push({ file, line: lineNum, content: (lines[lineNum - 1] ?? "").trim() });
      }
    }
  }
  return violations;
}

function scanForAnyKeyword(filePath: string): Violation[] {
  const source = readFileSync(filePath, "utf-8");
  const hits: Violation[] = [];
  source.split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const noStr = t.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '""');
    if (/\bany\b/.test(noStr)) hits.push({ file: filePath, line: i + 1, content: t });
  });
  return hits;
}

const fmt = (vs: Violation[]) => vs.map((v) => `  ${v.file}:${v.line}: ${v.content}`).join("\n");

describe("import independence — AC-3, INV-1 BLOCKING", () => {
  it("src/ has ZERO imports escaping pi-orchestrator/", () => {
    const d = join(packageRoot, "src");
    if (!existsSync(d)) return;
    const vs = scanForEscapingImports(d);
    if (vs.length > 0)
      expect.fail(`BLOCKING (INV-1): ${vs.length} escaping import(s):\n${fmt(vs)}`);
    expect(vs).toHaveLength(0);
  });

  it("test/ has ZERO imports escaping pi-orchestrator/", () => {
    const d = join(packageRoot, "test");
    if (!existsSync(d)) return;
    const vs = scanForEscapingImports(d);
    if (vs.length > 0)
      expect.fail(`BLOCKING (INV-1): ${vs.length} escaping import(s):\n${fmt(vs)}`);
    expect(vs).toHaveLength(0);
  });
});

describe("adversarial: test support files — INV-1", () => {
  const sup = join(packageRoot, "test", "support");

  for (const name of ["mock-state.ts", "test-fixtures.ts", "mock-adapters.ts"]) {
    it(`${name} does not escape the package`, () => {
      const p = join(sup, name);
      if (!existsSync(p)) return;
      const vs = scanForEscapingImports(sup).filter((v) => v.file === p);
      if (vs.length > 0) expect.fail(`BLOCKING: ${name} escapes package:\n${fmt(vs)}`);
      expect(vs).toHaveLength(0);
    });
  }
});

describe("no 'any' in owned files — AC-5, INV-2 BLOCKING", () => {
  it("types.ts has zero 'any' in non-comment code", () => {
    const p = join(packageRoot, "src", "shared", "types.ts");
    if (!existsSync(p)) return;
    const hits = scanForAnyKeyword(p);
    if (hits.length > 0) expect.fail(`BLOCKING (INV-2): ${hits.length} 'any':\n${fmt(hits)}`);
    expect(hits).toHaveLength(0);
  });

  it("errors.ts has zero 'any' in non-comment code", () => {
    const p = join(packageRoot, "src", "shared", "errors.ts");
    if (!existsSync(p)) return;
    const hits = scanForAnyKeyword(p);
    if (hits.length > 0) expect.fail(`BLOCKING (INV-2): ${hits.length} 'any':\n${fmt(hits)}`);
    expect(hits).toHaveLength(0);
  });
});

describe("root types file not deleted — AC-4", () => {
  it("pi-bmad root src/types.ts still exists", () => {
    const p = join(worktreeRoot, "src", "types.ts");
    expect(existsSync(p)).toBe(true);
    if (existsSync(p)) expect(statSync(p).size).toBeGreaterThan(0);
  });
});

describe("owned files exist — AC-1, AC-2", () => {
  it("src/shared/types.ts exists and is non-empty", () => {
    const p = join(packageRoot, "src", "shared", "types.ts");
    expect(existsSync(p)).toBe(true);
    if (existsSync(p)) expect(statSync(p).size).toBeGreaterThan(0);
  });

  it("src/shared/errors.ts exists and is non-empty", () => {
    const p = join(packageRoot, "src", "shared", "errors.ts");
    expect(existsSync(p)).toBe(true);
    if (existsSync(p)) expect(statSync(p).size).toBeGreaterThan(0);
  });

  it("types.ts resolves inside pi-orchestrator/ (not a symlink)", () => {
    const p = join(packageRoot, "src", "shared", "types.ts");
    if (!existsSync(p)) return;
    expect(realpathSync(p).startsWith(packageRoot)).toBe(true);
  });
});
