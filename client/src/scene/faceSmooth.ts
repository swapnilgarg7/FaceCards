/**
 * Detected face box -> framing you can stand to look at.
 *
 * This is the part that decides whether tracking reads as a person or as a
 * bug. A detector's output wobbles by a few pixels every frame even when the
 * subject is holding perfectly still, and a crop window driven straight off it
 * makes every face on the table vibrate. That is strictly worse than the fixed
 * crop it replaces.
 *
 * So the window is not a servo following the box. It is a lazy camera
 * operator: nothing moves while the face stays inside a dead zone around the
 * current framing, and once the face leaves it, only the part of the error
 * *beyond* the dead zone gets chased, smoothly. Small jitter is therefore not
 * attenuated, it is ignored outright, and a real head movement still lands.
 *
 * Pure maths, no three.js and no clock of its own: `delta` comes from the
 * caller's frame loop.
 */

import { damp } from "./damp.js";
import type { FaceBox } from "./faceBox.js";

/** Same shape as a `FaceBox`, but held and interpolated rather than measured. */
export type Framing = FaceBox;

export interface SmoothOptions {
  /**
   * How far the face may drift, in fractions of the frame, before the window
   * moves at all. Roughly the radius of "they shifted in their chair".
   */
  deadzone: number;
  /**
   * The same idea for size, but relative: a fraction of the current face
   * height. Distance estimates are noisier than position, so this is looser.
   */
  sizeDeadzone: number;
  /** Approach rate for the centre, once outside the dead zone. */
  lambda: number;
  /**
   * Approach rate for size. Deliberately slower than `lambda`: a window that
   * breathes in and out is more distracting than one that lags a lean-in.
   */
  sizeLambda: number;
}

/**
 * Tuned against a person sitting at a desk talking, which is the only pose
 * this app has. Loose enough that fidgeting moves nothing, tight enough that
 * turning to look at someone brings the framing with you.
 */
export const DEFAULT_SMOOTHING: SmoothOptions = {
  deadzone: 0.035,
  sizeDeadzone: 0.09,
  lambda: 3.6,
  sizeLambda: 1.8,
};

/**
 * Pull `target` back toward `current` by `slack`, returning what is left. Zero
 * inside the dead zone, and continuous as it crosses the edge, so the window
 * eases out of rest instead of snapping the moment the threshold is passed.
 */
function beyond(current: number, target: number, slack: number): number {
  const delta = target - current;
  const distance = Math.abs(delta);
  if (distance <= slack) return current;
  return current + delta * ((distance - slack) / distance);
}

/**
 * One frame of framing. `current` is what is on screen, `target` is the latest
 * box from the tracker, and the result is what to draw next.
 *
 * Detections arrive at around a tenth of the frame rate; this runs every frame
 * against the most recent one, which is what turns 10 Hz measurements into
 * 60 Hz motion.
 */
export function stepFraming(
  current: Framing,
  target: Framing,
  opts: SmoothOptions,
  delta: number,
): Framing {
  // Radial rather than per-axis, so a diagonal drift is not allowed to travel
  // 1.4 times as far as a straight one before the window reacts.
  const dx = target.cx - current.cx;
  const dy = target.cy - current.cy;
  const distance = Math.hypot(dx, dy);

  let goalX = current.cx;
  let goalY = current.cy;
  if (distance > opts.deadzone) {
    const reach = (distance - opts.deadzone) / distance;
    goalX = current.cx + dx * reach;
    goalY = current.cy + dy * reach;
  }

  const goalH = beyond(
    current.h,
    target.h,
    opts.sizeDeadzone * Math.max(current.h, 1e-6),
  );

  return {
    cx: damp(current.cx, goalX, opts.lambda, delta),
    cy: damp(current.cy, goalY, opts.lambda, delta),
    h: damp(current.h, goalH, opts.sizeLambda, delta),
  };
}
