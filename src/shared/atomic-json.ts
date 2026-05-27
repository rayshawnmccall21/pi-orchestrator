/**
 * Atomic JSON read/write/quarantine utility.
 *
 * Reads and writes JSON files with atomic rename semantics. On corrupt reads
 * or validation failures, the file is quarantined with a timestamped suffix
 * so evidence is preserved rather than silently overwritten.
 */

import { readFile, writeFile, rename, unlink, mkdir, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

/** Base radix for random suffix generation. */
const RANDOM_RADIX = 36;
/** Slice start for random suffix. */
const RANDOM_SLICE_START = 2;
/** Indentation for pretty-printed JSON output. */
const JSON_INDENT = 2;

/**
 * Options for creating an AtomicJsonStore.
 */
export interface AtomicJsonStoreOptions<T> {
  /** Optional validation hook. Returns true if parsed data is valid. */
  validate?: ((parsed: unknown) => parsed is T) | undefined;
}

/** Result of a read operation with quarantine tracking. */
export interface ReadOutcome<T> {
  /** Parsed data, or undefined if missing or quarantined. */
  data: T | undefined;
  /** Path to quarantined corrupt file, or null if no quarantine occurred. */
  quarantinedPath: string | null;
}

/**
 * Atomic JSON store for safe read/write/quarantine of JSON files.
 */
export interface AtomicJsonStore<T = unknown> {
  /** Read and parse JSON. Returns undefined if missing or quarantined. */
  read(): Promise<T | undefined>;
  /** Read with quarantine tracking. Returns data and quarantine path if corruption was detected. */
  readWithOutcome?(): Promise<ReadOutcome<T>>;
  /** Write JSON atomically via tmp-file-then-rename. */
  write(data: T): Promise<void>;
}

/**
 * Creates an AtomicJsonStore for the given file path.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param options - Optional validation hook.
 *
 * @returns An AtomicJsonStore instance.
 *
 * @example
 * ```typescript
 * const store = createAtomicJsonStore("/path/to/state.json");
 * const data = await store.read();
 * await store.write({ key: "value" });
 * ```
 */
export function createAtomicJsonStore<T = unknown>(
  filePath: string,
  options?: AtomicJsonStoreOptions<T>,
): AtomicJsonStore<T> {
  return {
    async read(): Promise<T | undefined> {
      const outcome = await readAndValidateJsonFull(filePath, options);
      return outcome.data;
    },
    async readWithOutcome(): Promise<ReadOutcome<T>> {
      return readAndValidateJsonFull(filePath, options);
    },
    async write(data: T): Promise<void> {
      return writeAtomicJson(filePath, data);
    },
  };
}

/**
 * Read, parse, and optionally validate a JSON file. Quarantines on
 * corrupt JSON or validation failure. Returns full outcome including
 * quarantine path for callers that need evidence.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param options - Optional validation hook.
 *
 * @returns Read outcome with data and quarantine tracking.
 *
 * @example
 * ```typescript
 * const outcome = await readAndValidateJsonFull("/path/to/state.json");
 * ```
 */
async function readAndValidateJsonFull<T>(
  filePath: string,
  options?: AtomicJsonStoreOptions<T>,
): Promise<ReadOutcome<T>> {
  const exists = await fileExists(filePath);
  if (!exists) {
    return { data: undefined, quarantinedPath: null };
  }

  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf-8");
  } catch {
    return { data: undefined, quarantinedPath: null };
  }

  const parseResult = safeJsonParse(rawContent);
  if (!parseResult.ok) {
    const quarantinedPath = await quarantineFile(filePath);
    return { data: undefined, quarantinedPath };
  }

  return applyValidation(filePath, parseResult.value, options);
}

/**
 * Apply the optional validation hook and quarantine on failure.
 *
 * When a validator is provided and the data passes, the typeguard
 * narrows the return type. Without a validator, the unknown value is
 * returned directly (the caller's T defaults to unknown).
 *
 * @param filePath - Path used for quarantine on failure.
 * @param parsed - The parsed JSON value.
 * @param options - Optional validation hook.
 *
 * @returns Read outcome with validated data and quarantine tracking.
 *
 * @example
 * ```typescript
 * const outcome = await applyValidation(path, data, options);
 * ```
 */
async function applyValidation<T>(
  filePath: string,
  parsed: unknown,
  options?: AtomicJsonStoreOptions<T>,
): Promise<ReadOutcome<T>> {
  if (options?.validate === undefined) {
    // No validator — T is unknown by default, so this is safe.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- T defaults to unknown; no validator means no narrowing needed.
    return { data: parsed as T, quarantinedPath: null };
  }
  if (options.validate(parsed)) {
    return { data: parsed, quarantinedPath: null };
  }
  const quarantinedPath = await quarantineFile(filePath);
  return { data: undefined, quarantinedPath };
}

/**
 * Write JSON atomically via tmp-file-then-rename.
 *
 * @param filePath - Absolute path to the JSON file.
 * @param data - Data to serialize and write.
 *
 * @example
 * ```typescript
 * await writeAtomicJson("/path/to/state.json", { key: "value" });
 * ```
 */
async function writeAtomicJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });

  const timestamp = String(Date.now());
  const randomSuffix = Math.random().toString(RANDOM_RADIX).slice(RANDOM_SLICE_START);
  const tmpFileName = `${basename(filePath)}.${timestamp}.${randomSuffix}.tmp`;
  const tmpPath = join(dirname(filePath), tmpFileName);
  const content = JSON.stringify(data, undefined, JSON_INDENT);
  try {
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, filePath);
  } catch (writeError: unknown) {
    try {
      await unlink(tmpPath);
    } catch {
      // Ignore cleanup failures.
    }
    throw writeError;
  }
}

/**
 * Quarantine a file by renaming it with a timestamped suffix.
 * Preserves the original content as evidence.
 *
 * @param filePath - Path to the file to quarantine.
 *
 * @returns The quarantine path on success, or null if quarantine failed.
 *
 * @example
 * ```typescript
 * await quarantineFile("/path/to/corrupt.json");
 * ```
 */
async function quarantineFile(filePath: string): Promise<string | null> {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const quarantineFileName = `${basename(filePath)}.quarantine.${timestamp}`;
  const quarantinePath = join(dirname(filePath), quarantineFileName);
  try {
    await rename(filePath, quarantinePath);
    return quarantinePath;
  } catch {
    try {
      const content = await readFile(filePath, "utf-8");
      await writeFile(quarantinePath, content, "utf-8");
      return quarantinePath;
    } catch {
      // Quarantine best-effort — do not throw.
      return null;
    }
  }
}

/** Result of a safe JSON parse attempt. */
type SafeParseResult = { ok: true; value: unknown } | { ok: false };

/**
 * Safely parse JSON without throwing.
 *
 * @param raw - Raw JSON string.
 *
 * @returns A discriminated result indicating success or failure.
 *
 * @example
 * ```typescript
 * const result = safeJsonParse('{"key":"value"}');
 * ```
 */
function safeJsonParse(raw: string): SafeParseResult {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse returns any; we immediately wrap in unknown-typed field.
    const parsed = JSON.parse(raw);
    const result: SafeParseResult = { ok: true, value: parsed };
    return result;
  } catch {
    return { ok: false };
  }
}

/**
 * Check if a file exists on disk.
 *
 * @param filePath - Absolute path to check.
 *
 * @returns True if the file exists.
 *
 * @example
 * ```typescript
 * const exists = await fileExists("/path/to/file");
 * ```
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
