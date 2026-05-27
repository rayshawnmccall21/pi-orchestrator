/**
 * Machine-readable error type for the pi-orchestrator package.
 *
 * All orchestrator modules throw `OrchestratorError` — never plain `Error` —
 * so callers can distinguish orchestrator failures from unexpected runtime
 * exceptions and route them to the correct handler.
 *
 * The `code` field enables programmatic error handling without string-matching
 * on `message`. Conventional codes use SCREAMING_SNAKE_CASE and are namespaced
 * by module (e.g., `"WORKFLOW_STEP_FAILED"`, `"DISPATCH_FAILED"`).
 */
export class OrchestratorError extends Error {
  /**
   * Create a structured orchestrator error with a machine-readable code.
   *
   * @param message - Human-readable description of what went wrong.
   * @param code - Machine-readable error code for programmatic handling.
   * @param context - Optional structured diagnostic payload — e.g., the
   *   dispatch ID that failed, the session that crashed, or the gate that blocked.
   */
  public constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OrchestratorError";
  }
}
