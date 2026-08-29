/**
 * Cursor position -> fraction of the look arc.
 *
 * Pure, and split out of the camera so the one property that matters can be
 * asserted rather than eyeballed: **the endpoints never move**. The look is an
 * absolute mapping from cursor position to head angle, so anything that scales
 * the output also scales the reachable arc, and a player whose arc shrank
 * below their neighbour's bearing could no longer look at them at all.
 * `layout.test.ts` guards the arc; this guards the curve into it.
 */

/** Fraction of the viewport, from the centre out, that maps to no turn. */
export const DEADZONE = 0.12;

/** Default sensitivity: the midpoint, i.e. a plain squared response. */
export const DEFAULT_SENSITIVITY = 0.5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Sensitivity 0 -> cubic (lazy near the centre, needs a deliberate move),
 * 0.5 -> squared, 1 -> linear (tracks the cursor closely).
 *
 * Changing the exponent is what lets sensitivity be a real control without
 * touching the arc: every exponent maps 0 to 0 and 1 to 1, so the edges of
 * the viewport still reach exactly the full turn at every setting.
 */
export function curveExponent(sensitivity: number): number {
  return 3 - 2 * clamp(sensitivity, 0, 1);
}

/**
 * @param n normalised cursor axis, -1 at one edge and 1 at the other.
 * @returns -1..1, the fraction of the maximum turn in that direction.
 */
export function lookResponse(n: number, sensitivity: number): number {
  if (!Number.isFinite(n)) return 0;

  const magnitude = Math.abs(n);
  if (magnitude <= DEADZONE) return 0;

  // Rescaled so the curve starts at zero as it leaves the deadzone. Without
  // this the head would jump the moment the cursor crossed the boundary.
  const past = clamp((magnitude - DEADZONE) / (1 - DEADZONE), 0, 1);
  return Math.sign(n) * past ** curveExponent(sensitivity);
}
