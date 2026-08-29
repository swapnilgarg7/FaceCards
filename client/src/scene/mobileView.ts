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
 * Pixels of drag that sweep the whole arc at the default sensitivity.
 *
 * Deliberately less than a screen's width: turning to look at the player
 * opposite must be one thumb movement, not three. It is the same reasoning as
 * `TRAVEL_PX` on the chip push, and the same number would be wrong here -
 * pushing chips wants deliberation, looking around does not.
 */
export const DRAG_SPAN_PX = 340;

/** 0..1 from the settings slider -> how far a pixel of drag turns the head. */
export function dragLookScale(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.55 + s * 1.1;
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

  const yawPerPx = ((2 * MAX_LOOK_YAW) / DRAG_SPAN_PX) * scale;
  const pitchPerPx =
    ((MAX_LOOK_PITCH_UP + MAX_LOOK_PITCH_DOWN) / DRAG_SPAN_PX) * scale;

  return {
    yaw: clamp(current.yaw - dx * yawPerPx, -MAX_LOOK_YAW, MAX_LOOK_YAW),
    pitch: clamp(
      current.pitch - dy * pitchPerPx,
      -MAX_LOOK_PITCH_DOWN,
      MAX_LOOK_PITCH_UP,
    ),
  };
}
