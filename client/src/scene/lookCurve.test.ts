import { describe, expect, it } from "vitest";
import {
  DEADZONE,
  DEFAULT_SENSITIVITY,
  curveExponent,
  lookResponse,
} from "./lookCurve.js";

const SENSITIVITIES = [0, 0.25, DEFAULT_SENSITIVITY, 0.75, 1];

describe("lookResponse", () => {
  it("reaches the full arc at every sensitivity", () => {
    // The invariant the whole curve is shaped around. If sensitivity could
    // shrink the reachable arc, a low setting would leave the player beside
    // you permanently unlookable-at, and seatLayout's guarantee would be void.
    for (const sensitivity of SENSITIVITIES) {
      expect(lookResponse(1, sensitivity)).toBeCloseTo(1);
      expect(lookResponse(-1, sensitivity)).toBeCloseTo(-1);
    }
  });

  it("holds still inside the deadzone", () => {
    for (const sensitivity of SENSITIVITIES) {
      expect(lookResponse(0, sensitivity)).toBe(0);
      expect(lookResponse(DEADZONE * 0.9, sensitivity)).toBe(0);
      expect(lookResponse(-DEADZONE * 0.9, sensitivity)).toBe(0);
    }
  });

  it("leaves the deadzone continuously, with no jump", () => {
    for (const sensitivity of SENSITIVITIES) {
      const justOutside = lookResponse(DEADZONE + 1e-6, sensitivity);
      expect(Math.abs(justOutside)).toBeLessThan(1e-3);
    }
  });

  it("is monotonic and symmetric", () => {
    for (const sensitivity of SENSITIVITIES) {
      let previous = 0;
      for (let n = 0; n <= 1; n += 0.05) {
        const value = lookResponse(n, sensitivity);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-12);
        expect(lookResponse(-n, sensitivity)).toBeCloseTo(-value);
        previous = value;
      }
    }
  });

  it("turns further for the same cursor position as sensitivity rises", () => {
    // What the slider is actually for: the same hand movement, more turn.
    const halfway = 0.5;
    const low = lookResponse(halfway, 0);
    const mid = lookResponse(halfway, DEFAULT_SENSITIVITY);
    const high = lookResponse(halfway, 1);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(high);
  });

  it("clamps a sensitivity outside 0..1 rather than inverting the curve", () => {
    expect(curveExponent(-5)).toBe(curveExponent(0));
    expect(curveExponent(9)).toBe(curveExponent(1));
    expect(lookResponse(0.5, 9)).toBeCloseTo(lookResponse(0.5, 1));
  });

  it("survives a cursor position that is not a number", () => {
    // getBoundingClientRect on a detached canvas yields NaN, and a NaN here
    // would propagate into camera.rotation and blank the scene permanently.
    expect(lookResponse(Number.NaN, DEFAULT_SENSITIVITY)).toBe(0);
  });
});
