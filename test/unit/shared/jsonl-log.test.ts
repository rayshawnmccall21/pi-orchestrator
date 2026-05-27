/**
 * Unit tests for shared/jsonl-log.ts — JsonlLogWriter.
 * Covers AC-3: append events, rotation at size limit, max file count.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { createJsonlLogWriter } from "../../../src/shared/jsonl-log.js";

describe("JsonlLogWriter", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jsonl-log-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("append", () => {
    it("appends a JSONL line to the log file", async () => {
      const logPath = path.join(tempDir, "test.jsonl");
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 1024 * 1024,
        maxFileCount: 3,
      });
      await writer.append({ kind: "test", message: "hello" });
      await writer.close();

      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual({
        kind: "test",
        message: "hello",
      });
    });

    it("appends multiple lines sequentially", async () => {
      const logPath = path.join(tempDir, "multi.jsonl");
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 1024 * 1024,
        maxFileCount: 3,
      });
      await writer.append({ seq: 1 });
      await writer.append({ seq: 2 });
      await writer.append({ seq: 3 });
      await writer.close();

      const content = await fs.readFile(logPath, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
    });
  });

  describe("rotation", () => {
    it("rotates when size exceeds configured max", async () => {
      const logPath = path.join(tempDir, "rotate.jsonl");
      // Set a very small max to trigger rotation quickly
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 50,
        maxFileCount: 5,
      });

      // Write enough data to exceed the limit
      for (let index = 0; index < 10; index++) {
        await writer.append({ index, padding: "data-to-fill-space" });
      }
      await writer.close();

      // Active file should be small (recent data)
      const activeContent = await fs.readFile(logPath, "utf-8");
      // The active file shouldn't have all 10 entries
      const activeLines = activeContent.trim().split("\n").filter(Boolean);
      expect(activeLines.length).toBeLessThan(10);

      // Rotated archive(s) should exist
      const files = await fs.readdir(tempDir);
      const rotatedFiles = files.filter(
        (f) => f.startsWith("rotate.jsonl.") && f !== "rotate.jsonl",
      );
      expect(rotatedFiles.length).toBeGreaterThanOrEqual(1);
    });

    it("retains at most maxFileCount files", async () => {
      const logPath = path.join(tempDir, "limited.jsonl");
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 40,
        maxFileCount: 3,
      });

      // Write enough data to trigger many rotations
      for (let index = 0; index < 50; index++) {
        await writer.append({
          index,
          padding: "fill-data-to-trigger-rotation",
        });
      }
      await writer.close();

      const files = await fs.readdir(tempDir);
      const logFiles = files.filter((f) => f.startsWith("limited.jsonl"));
      // At most 3 total files (active + rotated archives)
      expect(logFiles.length).toBeLessThanOrEqual(3);
    });

    it("old events are not in the active file after rotation", async () => {
      const logPath = path.join(tempDir, "old-events.jsonl");
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 60,
        maxFileCount: 5,
      });

      // Write first batch
      await writer.append({ batch: "first", index: 0 });
      await writer.append({ batch: "first", index: 1 });
      // Force size to exceed so rotation happens
      for (let index = 0; index < 10; index++) {
        await writer.append({
          batch: "second",
          index,
          padding: "extra-fill-data",
        });
      }
      await writer.close();

      // The active file should not contain first-batch events
      const activeContent = await fs.readFile(logPath, "utf-8");
      const activeLines = activeContent.trim().split("\n").filter(Boolean);
      const hasBatchFirst = activeLines.some((line) => {
        const parsed = JSON.parse(line);
        return parsed.batch === "first";
      });
      expect(hasBatchFirst).toBe(false);
    });
  });

  describe("close", () => {
    it("flushes pending writes on close", async () => {
      const logPath = path.join(tempDir, "close.jsonl");
      const writer = createJsonlLogWriter(logPath, {
        maxBytes: 1024 * 1024,
        maxFileCount: 3,
      });
      await writer.append({ final: true });
      await writer.close();

      const content = await fs.readFile(logPath, "utf-8");
      expect(content).toContain("final");
    });
  });
});
