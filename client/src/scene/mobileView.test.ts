import { describe, expect, it } from "vitest";
import {
  DRAG_PITCH_SPAN_PX,
  DRAG_YAW_SPAN_PX,
  applyDragLook,
  dragLookScale,
  fitFov,
} from "./mobileView.js";
import {
  MAX_LOOK_PITCH_DOWN,
  MAX_LOOK_PITCH_UP,
  MAX_LOOK_YAW,
} from "./layout.js";

const ZERO = { yaw: 0, pitch: 0 };

describe("fitFov", () => {
  it("widens the lens as the viewport gets taller than it is wide", () => {
    // The fov is vertical, so a wide window already sees more of the table
    // sideways for free. It is only as the frame narrows that the players
    // either side of you leave the shot, which is what this buys back.
    const widening = [
      [390, 844], // phone upright
      [768, 1024], // tablet upright
      [1024, 768], // tablet sideways
      [1440, 900], // laptop
    ].map(([w, h]) => fitFov(w!, h!));

    for (let i = 1; i < widening.length; i++) {
      expect(widening[i]).toBeLessThan(widening[i - 1]!);
    }
  });

  it("keeps the desktop lens on anything at least as wide as a laptop", () => {
    expect(fitFov(1440, 900)).toBe(55);
    expect(fitFov(2560, 1440)).toBe(55);
    // A phone held sideways is wider than a laptop, not narrower: a vertical
    // fov of 55 shows it exactly as much table, and widening it here would
    // only push everything further away on the smallest screen there is.
    expect(fitFov(844, 390)).toBe(55);
  });

  it("survives a zero-height viewport rather than dividing by it", () => {
    expect(Number.isFinite(fitFov(390, 0))).toBe(true);
  });
});

describe("dragLookScale", () => {
  it("rises with sensitivity and clamps outside 0..1", () => {
    expect(dragLookScale(0)).toBeLessThan(dragLookScale(1));
    expect(dragLookScale(-5)).toBe(dragLookScale(0));
    expect(dragLookScale(5)).toBe(dragLookScale(1));
  });
});

describe("applyDragLook", () => {
  it("looks right when the finger drags right", () => {
    // Positive yaw is to the left, so looking right is a decrease.
    const next = applyDragLook(ZERO, 40, 0, 1);
    expect(next.yaw).toBeLessThan(0);
  });

  it("looks up when the finger drags up", () => {
    const next = applyDragLook(ZERO, 0, -40, 1);
    expect(next.pitch).toBeGreaterThan(0);
  });

  it("accumulates, so a long look is several drags", () => {
    let angles = ZERO;
    for (let i = 0; i < 4; i++) angles = applyDragLook(angles, 20, 0, 1);
    expect(angles.yaw).toBeCloseTo(applyDragLook(ZERO, 80, 0, 1).yaw, 10);
  });

  it("reaches each end of each arc in one span of drag", () => {
    // The seat opposite has to be one sweep away, or the product's one job -
    // looking at the person you are talking to - costs three.
    expect(applyDragLook(ZERO, -DRAG_YAW_SPAN_PX / 2, 0, 1).yaw).toBeCloseTo(
      MAX_LOOK_YAW,
      6,
    );
    expect(
      applyDragLook(ZERO, 0, DRAG_PITCH_SPAN_PX, 1).pitch,
    ).toBeCloseTo(-MAX_LOOK_PITCH_DOWN, 6);
  });

  it("gives the two axes their own rate rather than one shared one", () => {
    // The arcs differ by a factor of three, so a single pixels-per-radian
    // figure leaves one of them unusable. The same 60px of thumb turns the
    // head further in absolute terms sideways, and yet covers far more of the
    // much shorter vertical arc - which is what makes both feel right.
    const yaw = applyDragLook(ZERO, -60, 0, 1).yaw;
    const pitch = applyDragLook(ZERO, 0, -60, 1).pitch;
    expect(yaw).toBeGreaterThan(pitch);
    expect(yaw / MAX_LOOK_YAW).toBeLessThan(pitch / MAX_LOOK_PITCH_UP);
  });

  it("never leaves the arc the cursor and the keys are held to", () => {
    const far = applyDragLook(ZERO, -10000, -10000, 2);
    expect(far.yaw).toBeCloseTo(MAX_LOOK_YAW, 10);
    expect(far.pitch).toBeCloseTo(MAX_LOOK_PITCH_UP, 10);

    const other = applyDragLook(ZERO, 10000, 10000, 2);
    expect(other.yaw).toBeCloseTo(-MAX_LOOK_YAW, 10);
    expect(other.pitch).toBeCloseTo(-MAX_LOOK_PITCH_DOWN, 10);
  });

  it("ignores a non-finite delta rather than losing the look to NaN", () => {
    const angles = { yaw: 0.3, pitch: -0.1 };
    expect(applyDragLook(angles, Number.NaN, 0, 1)).toBe(angles);
  });
});
