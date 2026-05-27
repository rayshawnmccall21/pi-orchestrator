/**
 * Behavioral tests for OrchestratorError (errors.ts).
 *
 * These tests verify the runtime behavior of OrchestratorError:
 * instantiation, inheritance, field access, and polymorphic catch.
 *
 * They MUST FAIL before errors.ts is implemented and PASS deterministically
 * once it is. No LLM required — all assertions are synchronous.
 *
 * Scenarios covered:
 *   - orchestrator-error-instantiates-with-code      (AC-2)
 *   - orchestrator-error-has-optional-context        (AC-2)
 *   - orchestrator-error-context-is-not-required     (AC-2)
 *   - orchestrator-error-thrown-and-caught-polymorphically (AC-2 adversarial)
 */

import { describe, it, expect } from "vitest";
import { OrchestratorError } from "../../../src/shared/errors.js";

describe("OrchestratorError", () => {
  describe("instantiation with required code", () => {
    it("preserves message passed to constructor", () => {
      const err = new OrchestratorError("something went wrong", "WORKFLOW_STEP_FAILED");
      expect(err.message).toBe("something went wrong");
    });

    it("preserves code passed to constructor", () => {
      const err = new OrchestratorError("something went wrong", "WORKFLOW_STEP_FAILED");
      expect(err.code).toBe("WORKFLOW_STEP_FAILED");
    });

    it("code is never undefined when provided", () => {
      const err = new OrchestratorError("msg", "MY_CODE");
      expect(err.code).not.toBeUndefined();
      expect(err.code).not.toBeNull();
    });

    it("name is OrchestratorError, not Error", () => {
      const err = new OrchestratorError("msg", "CODE");
      expect(err.name).toBe("OrchestratorError");
    });
  });

  describe("inheritance — IS-A Error", () => {
    it("is an instance of OrchestratorError", () => {
      const err = new OrchestratorError("msg", "CODE");
      expect(err instanceof OrchestratorError).toBe(true);
    });

    it("is an instance of Error (polymorphic catch works)", () => {
      const err = new OrchestratorError("msg", "CODE");
      expect(err instanceof Error).toBe(true);
    });

    it("has a stack trace (Error prototype chain)", () => {
      const err = new OrchestratorError("msg", "CODE");
      expect(err.stack).toBeDefined();
    });
  });

  describe("optional context field", () => {
    it("stores structured context when provided", () => {
      const err = new OrchestratorError("dispatch failed", "DISPATCH_FAILED", {
        dispatchId: "d-001",
        sessionId: "s-abc",
      });
      expect(err.context).toEqual({ dispatchId: "d-001", sessionId: "s-abc" });
    });

    it("context is undefined when omitted", () => {
      const err = new OrchestratorError("compile error", "TYPECHECK_FAILED");
      expect(err.context).toBeUndefined();
    });

    it("context can hold nested objects", () => {
      const ctx = { outer: { inner: 42 }, list: [1, 2, 3] };
      const err = new OrchestratorError("msg", "CODE", ctx);
      expect(err.context).toEqual(ctx);
    });
  });

  describe("throw / catch semantics (adversarial)", () => {
    it("can be thrown and caught as Error (polymorphic catch)", () => {
      let caught: unknown = null;
      try {
        throw new OrchestratorError("not found", "WORKER_NOT_FOUND");
      } catch (e: unknown) {
        caught = e;
      }

      expect(caught instanceof Error).toBe(true);
      expect(caught instanceof OrchestratorError).toBe(true);
    });

    it("code is accessible after instanceof narrowing", () => {
      let code: string | undefined;
      try {
        throw new OrchestratorError("dispatch error", "DISPATCH_FAILED", { id: "d-1" });
      } catch (e: unknown) {
        if (e instanceof OrchestratorError) {
          code = e.code;
        }
      }
      expect(code).toBe("DISPATCH_FAILED");
    });

    it("message is accessible after instanceof narrowing", () => {
      let message: string | undefined;
      try {
        throw new OrchestratorError("merge conflict detected", "MERGE_CONFLICT");
      } catch (e: unknown) {
        if (e instanceof OrchestratorError) {
          message = e.message;
        }
      }
      expect(message).toBe("merge conflict detected");
    });

    it("context is accessible after instanceof narrowing", () => {
      let context: Record<string, unknown> | undefined;
      try {
        throw new OrchestratorError("blocked", "GATE_BLOCKED", { gate: "story-to-dev" });
      } catch (e: unknown) {
        if (e instanceof OrchestratorError) {
          context = e.context;
        }
      }
      expect(context).toEqual({ gate: "story-to-dev" });
    });

    it("does NOT swallow Error message — error.message is the constructor message", () => {
      const err = new OrchestratorError("original message", "CODE");
      // super(message) must be called — message should not be replaced
      expect(err.message).toBe("original message");
    });
  });

  describe("error code conventions", () => {
    it("accepts SCREAMING_SNAKE_CASE codes (convention)", () => {
      const err = new OrchestratorError("error", "WORKER_POOL_EXHAUSTED");
      expect(err.code).toBe("WORKER_POOL_EXHAUSTED");
    });

    it("accepts namespaced codes with colons (convention)", () => {
      // Some teams use namespace:ERROR_CODE format
      const err = new OrchestratorError("error", "STATE:WRITE_DENIED");
      expect(err.code).toBe("STATE:WRITE_DENIED");
    });

    it("preserves code verbatim — no transformation", () => {
      const raw = "my-custom-code_123";
      const err = new OrchestratorError("msg", raw);
      expect(err.code).toBe(raw);
    });
  });
});
