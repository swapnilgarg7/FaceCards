import { describe, expect, it } from "vitest";
import {
  arc,
  dealSchedule,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  jitter,
  jitterSigned,
  progress,
} from "./tween.js";

describe("progress", () => {
  it("clamps to 0..1", () => {
    expect(progress(-5, 100)).toBe(0);
    expect(progress(50, 100)).toBe(0.5);
    expect(progress(500, 100)).toBe(1);
  });

  it("treats a zero duration as already finished", () => {
    expect(progress(0, 0)).toBe(1);
  });
});

describe("easings", () => {
  it.each([easeInOutCubic, easeOutCubic, easeOutBack])(
    "starts at 0 and ends at 1",
    (ease) => {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
    },
  );

  it("eases in and out symmetrically", () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 10);
  });

  it("spends its speed early on the out curve", () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.5);
  });

  it("overshoots and comes back", () => {
    const peak = Math.max(
      ...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)),
    );
    expect(peak).toBeGreaterThan(1);
  });
});

describe("arc", () => {
  const from = { x: 0, y: 0.8, z: 0 };
  const to = { x: 2, y: 0.8, z: -1 };

  it("starts and ends exactly on its endpoints", () => {
    expect(arc(from, to, 0.4, 0)).toEqual(from);
    const end = arc(from, to, 0.4, 1);
    expect(end.x).toBeCloseTo(to.x, 10);
    expect(end.y).toBeCloseTo(to.y, 10);
    expect(end.z).toBeCloseTo(to.z, 10);
  });

  it("lifts to exactly `lift` at the midpoint", () => {
    expect(arc(from, to, 0.4, 0.5).y).toBeCloseTo(1.2, 10);
  });

  it("leaves and lands flat rather than vertically", () => {
    // A card skimmed across felt leaves the deck moving mostly sideways. The
    // rise over the first 1% of the flight must not dominate the travel.
    const early = arc(from, to, 0.4, 0.01);
    expect(early.y - from.y).toBeLessThan(0.02);
    expect(early.x - from.x).toBeGreaterThan(0);
  });
});

describe("dealSchedule", () => {
  it("goes round twice rather than dealing two at a time", () => {
    const steps = dealSchedule([0, 1, 2], 0, 100);
    expect(steps.map((s) => s.slot)).toEqual([1, 2, 0, 1, 2, 0]);
    expect(steps.map((s) => s.cardIndex)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it("starts left of the button", () => {
    expect(dealSchedule([0, 1, 2, 3], 2, 100)[0]).toEqual({
      slot: 3,
      cardIndex: 0,
      delayMs: 0,
    });
  });

  it("wraps the small blind round past the end of the ring", () => {
    expect(dealSchedule([0, 1, 2], 2, 100)[0]?.slot).toBe(0);
  });

  it("staggers evenly and deals every card exactly once", () => {
    const steps = dealSchedule([0, 1, 2, 3, 4, 5], 3, 80);
    expect(steps).toHaveLength(12);
    expect(steps.map((s) => s.delayMs)).toEqual([
      0, 80, 160, 240, 320, 400, 480, 560, 640, 720, 800, 880,
    ]);
    const keys = new Set(steps.map((s) => `${s.slot}:${s.cardIndex}`));
    expect(keys.size).toBe(12);
  });

  it("falls back to slot 0 when the button is not in the ring", () => {
    // Before the first hand `buttonSeat` is -1. A legible deal beats a throw.
    expect(dealSchedule([0, 1], -1, 100)[0]?.slot).toBe(0);
  });

  it("deals nothing to an empty table", () => {
    expect(dealSchedule([], 0, 100)).toEqual([]);
  });
});

describe("jitter", () => {
  it("is stable for a given seed", () => {
    expect(jitter(7)).toBe(jitter(7));
  });

  it("stays inside 0..1 and spreads across it", () => {
    const values = Array.from({ length: 400 }, (_, i) => jitter(i));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    // Not a randomness test, just a guard against a hash that collapses: a
    // constant would put every chip at exactly the same angle.
    expect(new Set(values).size).toBeGreaterThan(390);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it("signs and scales", () => {
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(jitterSigned(i, 0.05))).toBeLessThanOrEqual(0.05);
    }
  });
});
