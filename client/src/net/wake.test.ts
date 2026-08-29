import { describe, expect, it } from "vitest";
import { WAKE_ESTIMATE_MS, wakeFraction, wakeSecondsLeft } from "./wake.js";

describe("wakeFraction", () => {
  it("starts empty", () => {
    expect(wakeFraction(0)).toBe(0);
  });

  it("reaches 0.9 at the estimate, leaving room to keep moving", () => {
    expect(wakeFraction(WAKE_ESTIMATE_MS)).toBeCloseTo(0.9, 5);
  });

  it("never arrives, however long the wait runs", () => {
    for (const minutes of [1, 2, 5, 30, 24 * 60]) {
      const f = wakeFraction(minutes * 60_000);
      expect(f).toBeLessThan(1);
      expect(f).toBeGreaterThan(0);
    }
  });

  it("only ever moves forward", () => {
    let previous = -1;
    for (let ms = 0; ms <= 5 * WAKE_ESTIMATE_MS; ms += 250) {
      const f = wakeFraction(ms);
      expect(f).toBeGreaterThanOrEqual(previous);
      previous = f;
    }
  });

  it("keeps moving past the estimate rather than freezing", () => {
    const at = wakeFraction(WAKE_ESTIMATE_MS);
    const later = wakeFraction(WAKE_ESTIMATE_MS + 10_000);
    expect(later).toBeGreaterThan(at);
  });

  it("treats nonsense input as no progress rather than NaN in the style", () => {
    expect(wakeFraction(Number.NaN)).toBe(0);
    expect(wakeFraction(-5)).toBe(0);
    expect(wakeFraction(1_000, 0)).toBe(0);
  });
});

describe("wakeSecondsLeft", () => {
  it("counts down", () => {
    expect(wakeSecondsLeft(0)).toBe(60);
    expect(wakeSecondsLeft(20_000)).toBe(40);
  });

  it("floors at zero rather than going negative once overdue", () => {
    expect(wakeSecondsLeft(WAKE_ESTIMATE_MS + 30_000)).toBe(0);
  });
});
