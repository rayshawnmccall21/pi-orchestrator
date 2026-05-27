/**
 * Unit tests for shared/atomic-json.ts — AtomicJsonStore.
 * Covers AC-2: quarantine on corrupt reads, schema validation failures,
 * and graceful missing-file handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { createAtomicJsonStore } from "../../../src/shared/atomic-json.js";

describe("AtomicJsonStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-json-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("read", () => {
    it("returns undefined when the file does not exist", async () => {
      const storePath = path.join(tempDir, "nonexistent.json");
      const store = createAtomicJsonStore(storePath);
      const result = await store.read();
      expect(result).toBeUndefined();
    });

    it("does not create a quarantine file when the file is missing", async () => {
      const storePath = path.join(tempDir, "nonexistent.json");
      const store = createAtomicJsonStore(storePath);
      await store.read();
      const files = await fs.readdir(tempDir);
      expect(files).toHaveLength(0);
    });

    it("reads and parses valid JSON", async () => {
      const storePath = path.join(tempDir, "valid.json");
      const data = { key: "value", count: 42 };
      await fs.writeFile(storePath, JSON.stringify(data));
      const store = createAtomicJsonStore(storePath);
      const result = await store.read();
      expect(result).toEqual(data);
    });

    it("quarantines corrupt JSON with timestamped evidence", async () => {
      const storePath = path.join(tempDir, "corrupt.json");
      await fs.writeFile(storePath, "{not valid json");
      const store = createAtomicJsonStore(storePath);
      const result = await store.read();
      expect(result).toBeUndefined();

      // Verify quarantine file exists with timestamp suffix
      const files = await fs.readdir(tempDir);
      const quarantineFiles = files.filter((f) => f.startsWith("corrupt.json.quarantine."));
      expect(quarantineFiles.length).toBeGreaterThanOrEqual(1);

      // Verify quarantine preserves original corrupt content
      const quarantineContent = await fs.readFile(path.join(tempDir, quarantineFiles[0]!), "utf-8");
      expect(quarantineContent).toBe("{not valid json");
    });

    it("quarantines data that fails a validation hook", async () => {
      const storePath = path.join(tempDir, "invalid-schema.json");
      const data = { schemaVersion: "wrong-version" };
      await fs.writeFile(storePath, JSON.stringify(data));

      const validator = (parsed: unknown): parsed is { schemaVersion: "v1" } => {
        return (
          typeof parsed === "object" &&
          parsed !== null &&
          "schemaVersion" in parsed &&
          (parsed as { schemaVersion: string }).schemaVersion === "v1"
        );
      };
      const store = createAtomicJsonStore(storePath, { validate: validator });
      const result = await store.read();
      expect(result).toBeUndefined();

      // Verify quarantine
      const files = await fs.readdir(tempDir);
      const quarantineFiles = files.filter((f) => f.startsWith("invalid-schema.json.quarantine."));
      expect(quarantineFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT silently overwrite corrupt data", async () => {
      const storePath = path.join(tempDir, "corrupt2.json");
      await fs.writeFile(storePath, "broken{{{");
      const store = createAtomicJsonStore(storePath);
      await store.read();

      // Original file should be gone (moved to quarantine), not overwritten
      const files = await fs.readdir(tempDir);
      const quarantineFiles = files.filter((f) => f.startsWith("corrupt2.json.quarantine."));
      expect(quarantineFiles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("write", () => {
    it("writes JSON atomically (file appears after write completes)", async () => {
      const storePath = path.join(tempDir, "output.json");
      const store = createAtomicJsonStore(storePath);
      const data = { key: "value" };
      await store.write(data);
      const content = await fs.readFile(storePath, "utf-8");
      expect(JSON.parse(content)).toEqual(data);
    });

    it("overwrites existing content atomically", async () => {
      const storePath = path.join(tempDir, "overwrite.json");
      const store = createAtomicJsonStore(storePath);
      await store.write({ old: true });
      await store.write({ new: true });
      const content = await fs.readFile(storePath, "utf-8");
      expect(JSON.parse(content)).toEqual({ new: true });
    });

    it("creates parent directories if missing", async () => {
      const storePath = path.join(tempDir, "deep", "nested", "file.json");
      const store = createAtomicJsonStore(storePath);
      await store.write({ nested: true });
      const content = await fs.readFile(storePath, "utf-8");
      expect(JSON.parse(content)).toEqual({ nested: true });
    });

    it("no tmp file remains after successful write", async () => {
      const storePath = path.join(tempDir, "clean.json");
      const store = createAtomicJsonStore(storePath);
      await store.write({ clean: true });
      const files = await fs.readdir(tempDir);
      const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });
});
