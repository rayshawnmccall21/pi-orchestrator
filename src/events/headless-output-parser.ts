/**
 * Parser for HeadlessWorkflowOutput JSON emitted by pi-bmad child workers.
 *
 * Extracts the last JSON object from child stdout that has the expected
 * schemaVersion tag. Handles partial output, multiple JSON objects, and
 * graceful degradation for corrupt or missing data.
 */

import type { HeadlessWorkflowOutput, HeadlessOutputParseResult } from "../shared/types.js";

/** Expected schema version for headless workflow output. */
const EXPECTED_SCHEMA_VERSION = "pi-bmad.headless-workflow-result.v1";

/** Valid status values for the output. */
const VALID_STATUSES = new Set(["success", "partial", "failed"]);

/** Valid exit codes. */
const VALID_EXIT_CODES = new Set([0, 1, 2]);

/**
 * Validate that a parsed object has the required HeadlessWorkflowOutput shape.
 *
 * @param candidate - The parsed JSON object to validate.
 *
 * @returns Validation error string, or null if valid.
 */
function validateShape(candidate: Record<string, unknown>): string | null {
  if (candidate["schemaVersion"] !== EXPECTED_SCHEMA_VERSION) {
    return `schemaVersion must be "${EXPECTED_SCHEMA_VERSION}", got "${String(candidate["schemaVersion"])}"`;
  }
  if (typeof candidate["workflow"] !== "string" || candidate["workflow"] === "") {
    return "workflow must be a non-empty string";
  }
  if (typeof candidate["returnType"] !== "string") {
    return "returnType must be a string";
  }
  if (!VALID_STATUSES.has(candidate["status"] as string)) {
    return `status must be success/partial/failed, got "${String(candidate["status"])}"`;
  }
  if (!VALID_EXIT_CODES.has(candidate["exitCode"] as number)) {
    return `exitCode must be 0/1/2, got ${String(candidate["exitCode"])}`;
  }
  if (!Array.isArray(candidate["completedSteps"])) {
    return "completedSteps must be an array";
  }
  if (!Array.isArray(candidate["failedSteps"])) {
    return "failedSteps must be an array";
  }
  if (typeof candidate["emittedAt"] !== "string") {
    return "emittedAt must be a string";
  }
  if (typeof candidate["durationMs"] !== "number") {
    return "durationMs must be a number";
  }
  return null;
}

/**
 * Parse HeadlessWorkflowOutput from child worker stdout.
 *
 * Scans the stdout text for JSON objects with the expected schemaVersion.
 * Takes the LAST matching object (in case the child emitted progress data before the final result).
 *
 * @param stdout - Raw stdout text from the child worker process.
 *
 * @returns A discriminated parse result.
 *
 * @example
 * ```typescript
 * const result = parseHeadlessOutput('{"schemaVersion":"pi-bmad.headless-workflow-result.v1",...}');
 * if (result.kind === "parsed") { console.log(result.output.workflow); }
 * ```
 */
export function parseHeadlessOutput(stdout: string): HeadlessOutputParseResult {
  if (stdout.trim() === "") {
    return { kind: "no-output", reason: "Child stdout was empty" };
  }

  // Find all JSON objects in the output (child may emit non-JSON lines too)
  const jsonCandidates: string[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      jsonCandidates.push(trimmed);
    }
  }

  if (jsonCandidates.length === 0) {
    return { kind: "no-output", reason: "No JSON objects found in child stdout" };
  }

  // Try each candidate from last to first (final result is most likely last)
  for (let candidateIndex = jsonCandidates.length - 1; candidateIndex >= 0; candidateIndex--) {
    const candidateLine = jsonCandidates[candidateIndex];
    if (candidateLine === undefined) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(candidateLine) as Record<string, unknown>;
    } catch (parseError: unknown) {
      continue; // Try the next candidate
    }

    if (parsed["schemaVersion"] !== EXPECTED_SCHEMA_VERSION) {
      continue; // Not a headless output — skip
    }

    const validationError = validateShape(parsed);
    if (validationError !== null) {
      return { kind: "invalid-schema", detail: validationError };
    }

    return {
      kind: "parsed",
      output: parsed as unknown as HeadlessWorkflowOutput,
    };
  }

  // Found JSON but none with our schemaVersion
  return { kind: "no-output", reason: "No JSON objects with expected schemaVersion found" };
}
