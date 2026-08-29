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
   * Dead zone radius, as a fraction of the *detected face height* rather than
   * of the frame. Scale matters: the crop window is only a fifth of the frame
   * wide, so a dead zone measured against the frame is several times larger
   * relative to what the viewer actually sees, and it is larger again for
   * someone sitting far from their camera. Measured against the face, it means
   * the same thing to everyone.
   */
  deadzone: number;
  /** The same idea for size: a fraction of the current face height. */
  sizeDeadzone: number;
  /** Approach rate for the centre, once outside the dead zone. */
  lambda: number;
  /**
   * Approach rate *inside* the dead zone. Small, but the important thing is
   * that it is not zero. See `stepFraming`.
   */
  settleLambda: number;
  /**
   * Approach rate for size. Deliberately slower than `lambda`: a window that
   * breathes in and out is more distracting than one that lags a lean-in.
   */
  sizeLambda: number;
}

/**
 * Tuned against a person sitting at a desk talking, which is the only pose
 * this app has. Loose enough that fidgeting moves nothing perceptible, tight
 * enough that turning to look at someone brings the framing with you.
 */
export const DEFAULT_SMOOTHING: SmoothOptions = {
  deadzone: 0.15,
  sizeDeadzone: 0.09,
  lambda: 3.6,
  // Fast enough that a shift in your chair is corrected within a second or so,
  // slow enough that detector noise moves the window by about a ten-thousandth
  // of the frame, which is four orders of magnitude below visible.
  settleLambda: 1.2,
  sizeLambda: 1.8,
};

/** Guards the scale-relative dead zones against a degenerate held height. */
const MIN_SCALE = 1e-6;

/**
 * One frame of framing. `current` is what is on screen, `target` is the latest
 * box from the tracker, and the result is what to draw next.
 *
 * Detections arrive at around a fifth of the frame rate; this runs every frame
 * against the most recent one, which is what turns 12 Hz measurements into
 * 60 Hz motion.
 *
 * The goal is *always* the face itself. What the dead zone changes is the
 * *rate*, not the destination.
 *
 * That distinction is the whole design, and getting it wrong is subtle enough
 * to be worth recording. The obvious implementation aims at the near edge of
 * the dead zone while outside it and freezes while inside. It does not work,
 * in two compounding ways. A frozen window has permanent steady-state error,
 * so it rests one dead-zone radius off-centre in whatever direction the face
 * last moved and stays there. Worse, the edge it aims for is an attractor:
 * damping approaches that edge asymptotically without ever crossing it, so the
 * distance converges to exactly the dead-zone radius, the "inside" case never
 * runs at all, and the window parks permanently off-centre. On screen that is
 * "it centred on me, then I shifted, and now it is off and will not come
 * back".
 *
 * So instead the rate ramps: barely moving for errors inside the dead zone,
 * up to a full chase once the error is comfortably outside it. Convergence is
 * exact because the target never stops being the target, and jitter is still
 * rejected because damping this slowly is a low-pass filter - symmetric
 * detector noise averages out over the second the creep takes, and what the
 * window converges on is the mean, which is where the face actually is.
 */
export function stepFraming(
  current: Framing,
  target: Framing,
  opts: SmoothOptions,
  delta: number,
): Framing {
  // Scaled to the face, not the frame: someone sitting far from the camera has
  // a smaller face and a tighter crop, and should get a proportionally smaller
  // dead zone, or their framing is looser than everyone else's.
  const scale = Math.max(target.h, MIN_SCALE);
  const deadzone = opts.deadzone * scale;

  // Radial rather than per-axis, so a diagonal drift is not allowed to travel
  // 1.4 times as far as a straight one before the window reacts.
  const distance = Math.hypot(
    target.cx - current.cx,
    target.cy - current.cy,
  );

  const lambda = rate(distance, deadzone, opts.settleLambda, opts.lambda);
  const sizeLambda = rate(
    Math.abs(target.h - current.h),
    opts.sizeDeadzone * scale,
    opts.settleLambda,
    opts.sizeLambda,
  );

  return {
    cx: damp(current.cx, target.cx, lambda, delta),
    cy: damp(current.cy, target.cy, lambda, delta),
    h: damp(current.h, target.h, sizeLambda, delta),
  };
}

/**
 * Approach rate for an error of `error`, ramping from `settle` to `chase`.
 *
 * Flat at `settle` inside the dead zone, flat at `chase` once the error is
 * twice the dead zone, and linear between, so there is no discontinuity for
 * a face hovering near the threshold to oscillate across.
 */
function rate(
  error: number,
  deadzone: number,
  settle: number,
  chase: number,
): number {
  if (deadzone <= 0) return chase;
  const t = Math.min(1, Math.max(0, (error - deadzone) / deadzone));
  return settle + (chase - settle) * t;
}
