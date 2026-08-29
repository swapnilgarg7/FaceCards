import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMOOTHING,
  stepFraming,
  type Framing,
  type SmoothOptions,
} from "./faceSmooth.js";

const start: Framing = { cx: 0.5, cy: 0.4, h: 0.3 };

const opts: SmoothOptions = {
  deadzone: 0.04,
  sizeDeadzone: 0.1,
  lambda: 4,
  sizeLambda: 2,
};

/** Runs `seconds` of frames at `hz` against a fixed target. */
function settle(
  from: Framing,
  target: Framing,
  seconds: number,
  hz = 60,
  options: SmoothOptions = opts,
): Framing {
  const delta = 1 / hz;
  let current = from;
  for (let i = 0; i < seconds * hz; i += 1) {
    current = stepFraming(current, target, options, delta);
  }
  return current;
}

describe("stepFraming", () => {
  it("ignores jitter inside the dead zone entirely", () => {
    // The whole point. A detector wobbling by a couple of pixels must move the
    // crop window by exactly nothing, not by a little.
    const jittered = { ...start, cx: start.cx + opts.deadzone * 0.7 };
    const next = stepFraming(start, jittered, opts, 1 / 60);
    expect(next.cx).toBe(start.cx);
    expect(next.cy).toBe(start.cy);
  });

  it("ignores small size noise too", () => {
    const noisy = { ...start, h: start.h * (1 + opts.sizeDeadzone * 0.5) };
    expect(stepFraming(start, noisy, opts, 1 / 60).h).toBe(start.h);
  });

  it("follows a real move, but only the part beyond the dead zone", () => {
    const moved = { ...start, cx: start.cx + 0.25 };
    const settled = settle(start, moved, 5);

    // It converges on the near edge of the dead zone, not on the target
    // itself: the window has caught up as soon as the face is comfortably
    // inside it, and chasing the last few pixels is what causes hunting.
    expect(settled.cx).toBeCloseTo(moved.cx - opts.deadzone, 2);
    expect(settled.cx).toBeGreaterThan(start.cx);
  });

  it("never overshoots the target", () => {
    const moved = { ...start, cx: 0.9, cy: 0.8, h: 0.5 };
    let current = start;
    for (let i = 0; i < 600; i += 1) {
      current = stepFraming(current, moved, opts, 1 / 60);
      expect(current.cx).toBeLessThanOrEqual(moved.cx + 1e-9);
      expect(current.cy).toBeLessThanOrEqual(moved.cy + 1e-9);
      expect(current.h).toBeLessThanOrEqual(moved.h + 1e-9);
    }
  });

  it("uses a radial dead zone, so diagonals are not privileged", () => {
    // Per-axis thresholds let a diagonal drift travel 1.4x as far before
    // anything happens, which reads as the window sticking on one side.
    const diagonal = opts.deadzone * 0.8;
    const target = {
      ...start,
      cx: start.cx + diagonal,
      cy: start.cy + diagonal,
    };
    const next = stepFraming(start, target, opts, 1 / 60);
    // Combined distance is 1.13x the dead zone, so this must move.
    expect(next.cx).toBeGreaterThan(start.cx);
  });

  it("settles to the same place at 30 Hz as at 144 Hz", () => {
    // Frame-rate independence is not cosmetic here: two people on different
    // machines are looking at the same table and must see the same framing.
    const moved = { ...start, cx: 0.85, h: 0.45 };
    const slow = settle(start, moved, 4, 30);
    const fast = settle(start, moved, 4, 144);

    expect(slow.cx).toBeCloseTo(fast.cx, 4);
    expect(slow.cy).toBeCloseTo(fast.cy, 4);
    expect(slow.h).toBeCloseTo(fast.h, 4);
  });

  it("moves size more slowly than position", () => {
    // A window that zooms as fast as it pans reads as breathing.
    const moved = { cx: start.cx + 0.3, cy: start.cy, h: start.h + 0.3 };
    const after = settle(start, moved, 0.3);

    const panned = (after.cx - start.cx) / 0.3;
    const zoomed = (after.h - start.h) / 0.3;
    expect(zoomed).toBeLessThan(panned);
  });

  it("does not divide by zero on a degenerate held size", () => {
    // Reachable only through a bug upstream, but the relative size dead zone
    // multiplies by the current height and this is the value that breaks it.
    const next = stepFraming({ ...start, h: 0 }, start, opts, 1 / 60);
    expect(Number.isFinite(next.h)).toBe(true);
    expect(next.h).toBeGreaterThan(0);
  });

  it("ships defaults that actually damp", () => {
    const moved = { ...start, cx: start.cx + 0.3 };
    const oneFrame = stepFraming(start, moved, DEFAULT_SMOOTHING, 1 / 60);
    // A single frame must cover only a small fraction of a big move, or the
    // smoothing is decorative.
    expect(oneFrame.cx - start.cx).toBeLessThan(0.05);
    expect(oneFrame.cx).toBeGreaterThan(start.cx);
  });
});
