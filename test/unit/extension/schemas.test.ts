/**
 * Unit tests for extension/schemas.ts — TypeBox tool parameter schemas.
 *
 * Covers AC-2 (invalid params → structured errors, no action executed).
 *
 * @see R-S14 story acceptance criteria
 */

import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════
// Imports — will fail until schemas.ts is created
// ═══════════════════════════════════════════════════════════════════════════

import {
  orchestrateToolParameters,
  ORCHESTRATE_TOOL_NAME,
} from "../../../src/extension/schemas.js";
import { Value } from "typebox/value";

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("extension/schemas.ts", () => {
  describe("schema exports", () => {
    it("exports orchestrateToolParameters as a TypeBox schema object", () => {
      expect(orchestrateToolParameters).toBeDefined();
      expect(typeof orchestrateToolParameters).toBe("object");
    });

    it("exports ORCHESTRATE_TOOL_NAME as a string constant", () => {
      expect(ORCHESTRATE_TOOL_NAME).toBe("orchestrate");
    });
  });

  describe("valid action parameters (AC-1 foundation)", () => {
    const validActions = [
      "start",
      "status",
      "list",
      "steer",
      "pause",
      "resume",
      "abort",
      "escalate",
      "result",
    ] as const;

    for (const action of validActions) {
      it(`accepts action="${action}" as valid`, () => {
        const params = { action };
        const isValid = Value.Check(orchestrateToolParameters, params);
        expect(isValid).toBe(true);
      });
    }

    it("accepts start with scope parameter", () => {
      const params = { action: "start", scope: "full" };
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(true);
    });

    it("accepts steer with sessionId and message", () => {
      const params = { action: "steer", sessionId: "sess-1", message: "fix test" };
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(true);
    });

    it("accepts abort with optional reason", () => {
      const params = { action: "abort", reason: "manual stop" };
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(true);
    });
  });

  describe("invalid parameters rejection (AC-2)", () => {
    it("rejects missing action field", () => {
      const params = {};
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(false);
    });

    it("rejects unknown action value", () => {
      const params = { action: "destroy" };
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(false);
    });

    it("rejects numeric action", () => {
      const params = { action: 42 };
      const isValid = Value.Check(orchestrateToolParameters, params);
      expect(isValid).toBe(false);
    });

    it("returns structured errors for invalid params", () => {
      const params = { action: "not-real" };
      const errors = [...Value.Errors(orchestrateToolParameters, params)];
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toHaveProperty("message");
      expect(errors[0]).toHaveProperty("instancePath");
    });
  });
});
