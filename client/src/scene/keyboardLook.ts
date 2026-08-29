/**
 * Turning your head with the keys instead of the cursor.
 *
 * The seated look is an *absolute* mapping: cursor position picks an angle,
 * and `lookCurve.ts` exists to guarantee the edges of the viewport always
 * reach the edges of the arc. Keys cannot work that way - a key has no
 * position, only a duration - so they contribute a **relative offset** that is
 * added to whatever the cursor is asking for.
 *
 * Composing rather than replacing is what makes the two inputs coexist. Nudge
 * the view left with A and the cursor still steers from there; sweep the mouse
 * and the keyboard's contribution rides along instead of being cancelled by
 * the next stray pointer event. Neither input has a mode, and there is nothing
 * to switch between.
 *
 * The one subtlety is **windup**, and it is the reason this is a module with
 * tests rather than three lines in `useFrame`. If the offset were free to
 * accumulate past the arc, holding A against the clamp for two seconds would
 * bank two seconds of unreachable turn, and pressing D afterwards would do
 * nothing at all until the debt was paid off. `stepLookOffset` clamps the
 * *composed* angle and then stores back the offset that composition actually
 * used, so the keys stop having an effect at exactly the moment the view stops
 * moving, and reverse instantly.
 *
 * Pure: no three.js, no DOM, no clock. `useLookKeys` in `ui/` owns the
 * keyboard; this owns what the keyboard means.
 */

/**
 * Radians per second the view turns while a key is held, at the default
 * sensitivity.
 *
 * Chosen against the arc rather than picked by feel: `MAX_LOOK_YAW` is 100
 * degrees each way, so a shade under two radians a second sweeps from one
 * neighbour to the other in about a second - fast enough to follow a voice,
 * slow enough that you can stop on a face.
 */
export const KEY_YAW_SPEED = 1.75;

/**
 * Pitch is slower on purpose. Its arc is a third of the yaw's and it is mostly
 * used to glance down at the felt and back, which is a small, deliberate
 * movement rather than a sweep.
 */
export const KEY_PITCH_SPEED = 0.95;

/** How far the sensitivity setting is allowed to scale the key speeds. */
const SENSITIVITY_FLOOR = 0.6;
const SENSITIVITY_CEILING = 1.5;

/** Which way the held keys are asking the view to turn. Each axis is -1..1. */
export interface LookAxes {
  /** Positive is to the left, matching three.js's positive Y rotation. */
  yaw: number;
  /** Positive is up. */
  pitch: number;
}

export const NO_LOOK_AXES: LookAxes = { yaw: 0, pitch: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * The same setting that reshapes the cursor's response curve, applied to the
 * keys as a plain speed multiplier.
 *
 * It cannot be the same treatment: sensitivity changes the *curve* into the
 * arc for the cursor precisely so the arc itself never changes, and a key has
 * no curve to reshape. What both settings share is the intent - lower means a
 * more deliberate movement to cross the same distance - so it lands here as
 * how quickly the turn happens, never as how far it can reach.
 */
export function keyLookScale(sensitivity: number): number {
  const s = clamp(Number.isFinite(sensitivity) ? sensitivity : 0.5, 0, 1);
  return SENSITIVITY_FLOOR + (SENSITIVITY_CEILING - SENSITIVITY_FLOOR) * s;
}

/**
 * Advance one axis of the keyboard's offset by a frame.
 *
 * @param offset  where the keys had pushed this axis to, in radians.
 * @param axis    -1, 0 or 1: which way the held keys are pushing now.
 * @param speed   radians per second at full deflection.
 * @param delta   seconds since the last frame.
 * @param base    what the cursor is asking for on this axis, in radians.
 * @param min     the low end of the reachable arc.
 * @param max     the high end.
 * @returns the new offset, already reduced so that `base + offset` is inside
 *          the arc. Never banks turn it could not spend.
 */
export function stepLookOffset(
  offset: number,
  axis: number,
  speed: number,
  delta: number,
  base: number,
  min: number,
  max: number,
): number {
  // A frame that took a second - a background tab waking up, a stalled main
  // thread - must not teleport the view across the table.
  const step = clamp(Number.isFinite(delta) ? delta : 0, 0, 0.1);
  const moved = offset + clamp(axis, -1, 1) * speed * step;
  return clamp(base + moved, min, max) - base;
}
