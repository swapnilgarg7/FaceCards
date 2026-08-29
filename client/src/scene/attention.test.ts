import { describe, expect, it } from "vitest";
import {
  HIGH_ANGLE,
  HYSTERESIS,
  MEDIUM_ANGLE,
  lookOffset,
  qualityForAngle,
  type StreamQuality,
} from "./attention.js";
import { assignSeats, seatForward } from "./layout.js";

const deg = (d: number) => (d * Math.PI) / 180;

describe("qualityForAngle", () => {
  it("gives the top layer to whoever you are looking at", () => {
    expect(qualityForAngle(0)).toBe("high");
    expect(qualityForAngle(deg(15))).toBe("high");
  });

  it("is symmetric: left and right are the same amount of looking", () => {
    for (const angle of [deg(15), deg(35), deg(120)]) {
      expect(qualityForAngle(angle)).toBe(qualityForAngle(-angle));
    }
  });

  it("steps down through the peripheral band", () => {
    expect(qualityForAngle(deg(35))).toBe("medium");
    expect(qualityForAngle(deg(120))).toBe("low");
    expect(qualityForAngle(Math.PI)).toBe("low");
  });

  it("keeps a level until the face is clear of the boundary", () => {
    const justOutside = HIGH_ANGLE + HYSTERESIS / 2;
    // Arriving fresh, it is peripheral.
    expect(qualityForAngle(justOutside)).toBe("medium");
    // Already high, it stays high rather than flapping on a resting head.
    expect(qualityForAngle(justOutside, "high")).toBe("high");
    // Far enough out and it drops regardless of what it was.
    expect(qualityForAngle(HIGH_ANGLE + HYSTERESIS * 2, "high")).toBe("medium");
  });

  it("applies the same hysteresis at the outer boundary", () => {
    const justOutside = MEDIUM_ANGLE + HYSTERESIS / 2;
    expect(qualityForAngle(justOutside)).toBe("low");
    expect(qualityForAngle(justOutside, "medium")).toBe("medium");
    expect(qualityForAngle(MEDIUM_ANGLE + HYSTERESIS * 2, "medium")).toBe("low");
  });

  it("never gets stuck: repeated application at one angle settles", () => {
    let quality: StreamQuality = "high";
    for (let i = 0; i < 20; i++) quality = qualityForAngle(deg(150), quality);
    expect(quality).toBe("low");
  });
});

describe("lookOffset", () => {
  const eye = { x: 0, z: 0 };

  it("is zero for something directly ahead", () => {
    expect(lookOffset(eye, { x: 0, z: -1 }, { x: 0, z: -3 })).toBeCloseTo(0);
  });

  it("is pi for something directly behind", () => {
    expect(lookOffset(eye, { x: 0, z: -1 }, { x: 0, z: 3 })).toBeCloseTo(
      Math.PI,
    );
  });

  it("measures a right angle as a right angle, either side", () => {
    expect(lookOffset(eye, { x: 0, z: -1 }, { x: 2, z: 0 })).toBeCloseTo(
      Math.PI / 2,
    );
    expect(lookOffset(eye, { x: 0, z: -1 }, { x: -2, z: 0 })).toBeCloseTo(
      Math.PI / 2,
    );
  });

  it("does not divide by zero on degenerate input", () => {
    expect(lookOffset(eye, { x: 0, z: -1 }, eye)).toBe(0);
    expect(lookOffset(eye, { x: 0, z: 0 }, { x: 1, z: 1 })).toBe(0);
  });
});

describe("attention over a real ring", () => {
  /**
   * The point of the whole layer: sitting still and facing the middle, a six
   * handed table must not have six people on the top layer. That is the frame
   * budget the plan warns about, spelled as a test.
   */
  it("puts at most a couple of faces on the top layer at rest", () => {
    const placed = assignSeats([0, 1, 2, 3, 4, 5]);
    const me = placed.get(0)!;
    const forward = seatForward(me);

    const levels = [...placed.values()]
      .filter((seat) => seat.index !== me.index)
      .map((seat) => qualityForAngle(lookOffset(me, forward, seat)));

    expect(levels.filter((q) => q === "high").length).toBeLessThanOrEqual(2);
    expect(levels).toContain("low");
  });

  it("upgrades whoever you turn towards", () => {
    const placed = assignSeats([0, 1, 2, 3, 4, 5]);
    const me = placed.get(0)!;
    const them = placed.get(3)!;

    // Turn to face them: forward is the direction from my eyes to their head.
    const facing = { x: them.x - me.x, z: them.z - me.z };
    expect(qualityForAngle(lookOffset(me, facing, them))).toBe("high");
  });
});
