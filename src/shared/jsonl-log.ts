/**
 * JSONL append and rotation utility.
 *
 * Appends newline-delimited JSON events to a log file. When file size
 * exceeds a configured maximum, the active file is rotated to a
 * timestamped archive. Rotation retains at most maxFileCount files.
 */

import { appendFile, rename, stat, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";

/**
 * Configuration for JSONL log rotation.
 */
export interface JsonlLogConfig {
  /** Maximum bytes before the active file is rotated. */
  maxBytes: number;
  /** Maximum number of log files to retain (active + archives). */
  maxFileCount: number;
}

/**
 * JSONL log writer with append and rotation support.
 */
export interface JsonlLogWriter {
  /** Append a JSON-serializable event as a single JSONL line. */
  append(event: Record<string, unknown>): Promise<void>;
  /** Flush and close the writer. */
  close(): Promise<void>;
}

/**
 * Creates a JSONL log writer with rotation support.
 *
 * @param logPath - Absolute path to the active log file.
 * @param config - Rotation configuration.
 *
 * @returns A JsonlLogWriter instance.
 *
 * @example
 * ```typescript
 * const writer = createJsonlLogWriter("/path/to/log.jsonl", {
 *   maxBytes: 50 * 1024 * 1024,
 *   maxFileCount: 5,
 * });
 * await writer.append({ kind: "event", data: "hello" });
 * await writer.close();
 * ```
 */
export function createJsonlLogWriter(logPath: string, config: JsonlLogConfig): JsonlLogWriter {
  let closed = false;

  return {
    async append(event: Record<string, unknown>): Promise<void> {
      if (closed) {
        return;
      }

      const currentSize = await getFileSize(logPath);
      if (currentSize >= config.maxBytes) {
        await rotateLog(logPath, config.maxFileCount);
      }

      const line = JSON.stringify(event) + "\n";
      await appendFile(logPath, line, "utf-8");
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- Interface requires Promise for future flush support.
    async close(): Promise<void> {
      closed = true;
    },
  };
}

/**
 * Get the size of a file in bytes, returning 0 if the file does not exist.
 *
 * @param filePath - Absolute path to the file.
 *
 * @returns File size in bytes, or 0 if missing.
 *
 * @example
 * ```typescript
 * const size = await getFileSize("/path/to/file");
 * ```
 */
async function getFileSize(filePath: string): Promise<number> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.size;
  } catch {
    return 0;
  }
}

/**
 * Rotate the active log file to a timestamped archive, then prune
 * excess archives to stay within maxFileCount.
 *
 * @param logPath - Absolute path to the active log file.
 * @param maxFileCount - Maximum total files to retain.
 *
 * @example
 * ```typescript
 * await rotateLog("/path/to/log.jsonl", 5);
 * ```
 */
async function rotateLog(logPath: string, maxFileCount: number): Promise<void> {
  const logDir = dirname(logPath);
  const logBaseName = basename(logPath);
  const timestamp = String(Date.now());
  const archivePath = join(logDir, `${logBaseName}.${timestamp}`);

  try {
    await rename(logPath, archivePath);
  } catch {
    return;
  }

  await writeFile(logPath, "", "utf-8");
  await pruneArchives(logDir, logBaseName, maxFileCount);
}

/**
 * Remove oldest archives so that total file count (active + archives)
 * does not exceed maxFileCount.
 *
 * @param logDir - Directory containing the log files.
 * @param logBaseName - Base name of the active log file.
 * @param maxFileCount - Maximum total files to retain.
 *
 * @example
 * ```typescript
 * await pruneArchives("/path/to/logs", "audit.jsonl", 5);
 * ```
 */
async function pruneArchives(
  logDir: string,
  logBaseName: string,
  maxFileCount: number,
): Promise<void> {
  try {
    const entries = await readdir(logDir);
    const archiveFiles = entries
      .filter((entry) => entry.startsWith(`${logBaseName}.`) && entry !== logBaseName)
      .sort();

    const maxArchives = maxFileCount - 1;
    const toDelete = archiveFiles.slice(0, Math.max(0, archiveFiles.length - maxArchives));

    for (const archiveFile of toDelete) {
      try {
        await unlink(join(logDir, archiveFile));
      } catch {
        // Best-effort pruning.
      }
    }
  } catch {
    // Best-effort pruning.
  }
}
