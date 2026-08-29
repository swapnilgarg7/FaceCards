import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMOOTHING,
  stepFraming,
  type Framing,
  type SmoothOptions,
} from "./faceSmooth.js";

const start: Framing = { cx: 0.5, cy: 0.4, h: 0.3 };

const opts: SmoothOptions = {
  deadzone: 0.15,
  sizeDeadzone: 0.1,
  lambda: 4,
  settleLambda: 0.7,
  sizeLambda: 2,
};

/** The dead zone in frame units, for a face of `start`'s size. */
const deadzone = opts.deadzone * start.h;

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
  it("does not leave the window permanently off-centre", () => {
    // The bug this file exists to prevent. A dead zone that merely freezes has
    // steady-state error: the window rests one dead-zone radius from the face,
    // in whatever direction it last moved, forever. On screen that is "it
    // centred on me, then I shifted, and now it is off and stays off".
    const moved = { ...start, cx: start.cx + 0.25 };
    const settled = settle(start, moved, 12);

    expect(settled.cx).toBeCloseTo(moved.cx, 3);
    expect(settled.cy).toBeCloseTo(moved.cy, 3);
    expect(settled.h).toBeCloseTo(moved.h, 3);
  });

  it("barely reacts to jitter inside the dead zone", () => {
    // Not frozen any more, but a single frame of noise must be invisible:
    // well under a thousandth of the frame.
    const jittered = { ...start, cx: start.cx + deadzone * 0.7 };
    const next = stepFraming(start, jittered, opts, 1 / 60);
    expect(next.cx - start.cx).toBeLessThan(0.0005);
    expect(next.cx).toBeGreaterThan(start.cx);
  });

  it("converges on the mean of a jittering face, not away from it", () => {
    // The reason a slow creep is safe: damping at settleLambda is a low-pass
    // filter, so symmetric detector noise averages out instead of dragging
    // the window around with it.
    const truth = start.cx;
    let current = start;
    for (let i = 0; i < 60 * 8; i += 1) {
      // Deterministic alternating noise well inside the dead zone.
      const noise = (i % 2 === 0 ? 1 : -1) * deadzone * 0.8;
      current = stepFraming(
        current,
        { ...start, cx: truth + noise },
        opts,
        1 / 60,
      );
    }
    expect(current.cx).toBeCloseTo(truth, 2);
  });

  it("chases a real move quickly, then finishes the last bit slowly", () => {
    const moved = { ...start, cx: start.cx + 0.25 };

    // Most of the distance is covered fast, by the chase regime.
    const early = settle(start, moved, 1);
    expect(early.cx).toBeGreaterThan(start.cx + 0.18);

    // The remainder is inside the dead zone and closes at the settle rate,
    // which is slower but does not stop.
    const late = settle(start, moved, 6);
    expect(late.cx).toBeGreaterThan(early.cx);
    expect(late.cx).toBeCloseTo(moved.cx, 2);
  });

  it("scales the dead zone with the face, not the frame", () => {
    // Someone further from their camera has a smaller face and a tighter crop,
    // so an absolute dead zone would be far looser in the only units that
    // matter: the fraction of the visible window a wobble represents.
    const near: Framing = { cx: 0.5, cy: 0.4, h: 0.5 };
    const far: Framing = { cx: 0.5, cy: 0.4, h: 0.15 };

    // An offset inside the near dead zone but outside the far one.
    const offset = opts.deadzone * 0.3;
    const nearStep = stepFraming(near, { ...near, cx: near.cx + offset }, opts, 1 / 60);
    const farStep = stepFraming(far, { ...far, cx: far.cx + offset }, opts, 1 / 60);

    // The far face is outside its dead zone, so it moves decisively more.
    expect(farStep.cx - far.cx).toBeGreaterThan((nearStep.cx - near.cx) * 4);
  });

  it("never overshoots the target", () => {
    const moved = { ...start, cx: 0.9, cy: 0.8, h: 0.5 };
    let current = start;
    for (let i = 0; i < 900; i += 1) {
      current = stepFraming(current, moved, opts, 1 / 60);
      expect(current.cx).toBeLessThanOrEqual(moved.cx + 1e-9);
      expect(current.cy).toBeLessThanOrEqual(moved.cy + 1e-9);
      expect(current.h).toBeLessThanOrEqual(moved.h + 1e-9);
    }
  });

  it("uses a radial dead zone, so diagonals are not privileged", () => {
    // Per-axis thresholds let a diagonal drift travel 1.4x as far before
    // anything happens, which reads as the window sticking on one side. Each
    // axis here is inside the dead zone; together they are outside it, so the
    // diagonal must react and the single axis must not.
    const nudge = deadzone * 0.8;

    const oneAxis = stepFraming(start, { ...start, cx: start.cx + nudge }, opts, 1 / 60);
    const diagonal = stepFraming(
      start,
      { ...start, cx: start.cx + nudge, cy: start.cy + nudge },
      opts,
      1 / 60,
    );

    expect(diagonal.cx - start.cx).toBeGreaterThan(
      (oneAxis.cx - start.cx) * 1.5,
    );
  });

  it("settles to the same place at 30 Hz as at 144 Hz", () => {
    // Frame-rate independence is not cosmetic here: two people on different
    // machines are looking at the same table and must see the same framing.
    // The rate now varies with the error, so the two agree exactly only once
    // converged; mid-ramp they differ by a discretisation error too small to
    // see. Settled long enough to be at rest.
    const moved = { ...start, cx: 0.85, h: 0.45 };
    const slow = settle(start, moved, 12, 30);
    const fast = settle(start, moved, 12, 144);

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

  it("does not divide by zero on a degenerate size", () => {
    // Reachable only through a bug upstream, but the dead zones scale by
    // height and this is the value that breaks them.
    for (const bad of [
      stepFraming({ ...start, h: 0 }, start, opts, 1 / 60),
      stepFraming(start, { ...start, h: 0 }, opts, 1 / 60),
    ]) {
      expect(Number.isFinite(bad.cx)).toBe(true);
      expect(Number.isFinite(bad.h)).toBe(true);
    }
  });

  it("ships defaults that damp rather than snap", () => {
    const moved = { ...start, cx: start.cx + 0.3 };
    const oneFrame = stepFraming(start, moved, DEFAULT_SMOOTHING, 1 / 60);
    // A single frame must cover only a small fraction of a big move, or the
    // smoothing is decorative.
    expect(oneFrame.cx - start.cx).toBeLessThan(0.05);
    expect(oneFrame.cx).toBeGreaterThan(start.cx);
  });

  it("ships defaults that eventually centre", () => {
    const moved = { ...start, cx: start.cx + 0.2, cy: start.cy - 0.15 };
    const settled = settle(start, moved, 15, 60, DEFAULT_SMOOTHING);
    expect(settled.cx).toBeCloseTo(moved.cx, 3);
    expect(settled.cy).toBeCloseTo(moved.cy, 3);
  });
});
