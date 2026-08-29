import { describe, expect, it } from "vitest";
import { dampAngle, shortestAngleDelta } from "./damp.js";

const TAU = Math.PI * 2;

describe("shortestAngleDelta", () => {
  it("takes the short way across the pi seam", () => {
    // The case that matters: two bearings a hair apart, either side of the
    // seam. Going the long way would spin an avatar almost fully round.
    const delta = shortestAngleDelta(3.1, -3.1);
    expect(Math.abs(delta)).toBeLessThan(0.1);
    expect(delta).toBeGreaterThan(0);

    const back = shortestAngleDelta(-3.1, 3.1);
    expect(Math.abs(back)).toBeLessThan(0.1);
    expect(back).toBeLessThan(0);
  });

  it("is never longer than half a turn", () => {
    for (let from = -TAU; from <= TAU; from += 0.37) {
      for (let to = -TAU; to <= TAU; to += 0.41) {
        expect(Math.abs(shortestAngleDelta(from, to))).toBeLessThanOrEqual(
          Math.PI + 1e-9,
        );
      }
    }
  });

  it("lands on the target, modulo a full turn", () => {
    for (let from = -6; from <= 6; from += 0.53) {
      for (let to = -6; to <= 6; to += 0.61) {
        const arrived = from + shortestAngleDelta(from, to);
        const off = Math.abs(((arrived - to) % TAU) / TAU);
        expect(Math.min(off, 1 - off)).toBeLessThan(1e-9);
      }
    }
  });

  it("does not move when already there", () => {
    expect(shortestAngleDelta(1.2, 1.2)).toBeCloseTo(0);
  });
});

describe("dampAngle", () => {
  it("approaches the target without overshooting", () => {
    let angle = 0;
    const target = 2.4;
    for (let step = 0; step < 200; step++) {
      angle = dampAngle(angle, target, 4, 1 / 60);
      expect(angle).toBeLessThanOrEqual(target + 1e-9);
    }
    expect(angle).toBeCloseTo(target, 3);
  });

  it("settles in the same wall-clock time at any frame rate", () => {
    // Otherwise the table re-seats at one speed on a 144 Hz machine and
    // another on a 30 Hz one, and no two clients agree on the motion.
    const run = (fps: number) => {
      let angle = 0;
      for (let step = 0; step < fps; step++) {
        angle = dampAngle(angle, 1, 4, 1 / fps);
      }
      return angle;
    };
    expect(run(30)).toBeCloseTo(run(144), 4);
  });

  it("crosses the seam the short way", () => {
    const stepped = dampAngle(3.1, -3.1, 4, 1 / 60);
    // Should push past pi, not swing back down through zero.
    expect(stepped).toBeGreaterThan(3.1);
  });

  it("stays put when it is already at the target", () => {
    expect(dampAngle(1.5, 1.5, 4, 1 / 60)).toBeCloseTo(1.5);
  });
});
