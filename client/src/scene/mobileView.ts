/**
 * The two things a phone changes about the seated view: how you turn your
 * head, and how much of the room fits in front of it.
 *
 * Pure, and split out of `SeatedCamera` for the same reason `lookCurve.ts`
 * was: the property that matters here is that a finger can still reach every
 * seat at the table, and that is an assertion rather than something to
 * eyeball on a handset.
 */

import {
  MAX_LOOK_PITCH_DOWN,
  MAX_LOOK_PITCH_UP,
  MAX_LOOK_YAW,
} from "./layout.js";

/**
 * Field of view for a viewport of this shape.
 *
 * The desktop 55 degrees is chosen for a landscape window, where a wide table
 * fills the frame. Hold a phone upright and that same lens shows a column of
 * felt with the two players either side of you outside the frame entirely -
 * which on a product whose whole point is other people's faces is not a
 * cosmetic problem. Portrait therefore gets a much wider lens, and the
 * distortion that comes with it is a straight trade for having the table in
 * shot.
 *
 * Stepped rather than continuous: a fov that slid with every pixel of a
 * resize would breathe while the URL bar collapses.
 */
export function fitFov(width: number, height: number): number {
  const aspect = width / Math.max(1, height);
  if (aspect < 0.72) return 78; // phone upright
  if (aspect < 1.05) return 68; // tablet upright, or a very square window
  if (aspect < 1.45) return 60; // phone sideways, short and wide
  return 55; // the desktop lens
}

/**
 * Pixels of drag that sweep each axis end to end at the default sensitivity.
 *
 * Two numbers rather than one, because the two arcs are nothing like the same
 * size: 200 degrees of yaw against 64 of pitch. Driving both from a single
 * pixels-per-radian figure makes one of them useless - either the head snaps
 * a third of the way round the table for a flick of the thumb, or looking
 * down at your own cards takes a swipe longer than the screen.
 *
 * Yaw is a little over a phone screen wide, so turning to the player opposite
 * is one confident sweep and a nudge is still a nudge. Pitch is shorter than
 * the screen is tall, because the whole vertical arc is the felt at one end
 * and the pendant at the other and there is nothing in between worth a long
 * gesture.
 */
export const DRAG_YAW_SPAN_PX = 560;
export const DRAG_PITCH_SPAN_PX = 320;

/**
 * 0..1 from the settings slider -> how far a pixel of drag turns the head.
 *
 * Multiplies the spans above rather than the arc, so - exactly as on the
 * desktop curve - no setting can change how far round the table a player can
 * see. It only changes what it costs them to get there.
 */
export function dragLookScale(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.5 + s;
}

export interface LookAngles {
  yaw: number;
  pitch: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Move the look by a drag.
 *
 * Relative, unlike the cursor mapping, and that is the whole difference. A
 * cursor has a position on screen at all times and can be *pointed*; a finger
 * only exists while it is down, so an absolute mapping would snap the view to
 * wherever somebody happened to touch. Dragging accumulates instead, and
 * letting go leaves the head where it was put.
 *
 * Signs match the cursor path: drag right, look right. Positive yaw is to the
 * left (three.js signs, see `keyboardLook.ts`), hence the subtraction.
 *
 * The clamp is the same arc the cursor and the keys are held to, so no input
 * can see further round the table than any other.
 */
export function applyDragLook(
  current: LookAngles,
  dx: number,
  dy: number,
  scale: number,
): LookAngles {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return current;

  const yawPerPx = ((2 * MAX_LOOK_YAW) / DRAG_YAW_SPAN_PX) * scale;
  const pitchPerPx =
    ((MAX_LOOK_PITCH_UP + MAX_LOOK_PITCH_DOWN) / DRAG_PITCH_SPAN_PX) * scale;

  return {
    yaw: clamp(current.yaw - dx * yawPerPx, -MAX_LOOK_YAW, MAX_LOOK_YAW),
    pitch: clamp(
      current.pitch - dy * pitchPerPx,
      -MAX_LOOK_PITCH_DOWN,
      MAX_LOOK_PITCH_UP,
    ),
  };
}
