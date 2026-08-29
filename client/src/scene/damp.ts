/**
 * Frame-rate independent damping.
 *
 * `THREE.MathUtils.damp` covers the scalar case, and `damp` below is the same
 * formula. It is restated here so that scene maths which is otherwise pure -
 * framing, cropping, smoothing - can be unit-tested without importing a
 * renderer to get at one line of arithmetic.
 *
 * `dampAngle` is the part three.js has no equivalent for. An angle has a seam:
 * damping a yaw of 3.1 toward -3.1 the naive way spins the long way round,
 * almost a full turn, when the two are a few degrees apart. Seats sit at every
 * bearing round the table, so re-seating crosses that seam routinely.
 */

const TAU = Math.PI * 2;

/**
 * Exponential approach. `lambda` is the rate: higher settles faster. The
 * `1 - exp(-lambda * dt)` form is what makes this independent of frame rate,
 * so a 144 Hz machine and a 30 Hz one take the same wall-clock time to arrive,
 * and it never overshoots.
 */
export function damp(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  return current + (target - current) * (1 - Math.exp(-lambda * delta));
}

/**
 * Signed shortest way from `from` to `to`, always within -pi..pi.
 */
export function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

/** Exponential approach along the short arc. See `damp` for the rate. */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number,
): number {
  return current + shortestAngleDelta(current, target) * (1 - Math.exp(-lambda * delta));
}
