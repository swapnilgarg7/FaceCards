/**
 * The hero asset, as a cross-section.
 *
 * Pure numbers and pure functions, no three.js import, in the same spirit as
 * `layout.ts`, `body.ts` and `chips.ts`. `PokerTable.tsx` revolves what this
 * describes into a lathe.
 *
 * A table is a surface of revolution, so the honest way to author one is a
 * profile: a list of (radius, height) points swept around Y. That is also what
 * the plan asked for - "lathe an oval/octagon profile in Blender, export
 * glTF" - minus the round trip through a file. Turning it here rather than
 * importing it keeps the proportions *numbers*, which means the one thing that
 * actually matters about them can be asserted rather than eyeballed:
 *
 * **The rail must not reach the game.** Hole cards lie at
 * `TABLE.radius - HOLE_INSET`, a stack sits at `TABLE.radius - STACK_INSET`
 * plus its sideways spread, and both are drawn from the seat's bearing with no
 * idea a rail exists. If the padded rail creeps inward by two centimetres
 * during an art pass, the top of everyone's hand disappears under it and
 * nothing in the type system notices. `tableProfile.test.ts` and
 * `verify:phase5` both check that clearance against the real anchors.
 *
 * Heights are **offsets from `TABLE.topY`**, not absolute, so the felt stays
 * the datum: raising the table raises everything on it, and the one number the
 * whole scene is built around (`EYE_HEIGHT`) keeps its relationship to it.
 */

import { TABLE } from "./layout.js";

/** A point on the cross-section: radius out from the axis, height above the felt. */
export interface ProfilePoint {
  r: number;
  /** Metres above `TABLE.topY`. Negative is below the playing surface. */
  y: number;
}

/**
 * Where the felt stops and the rail begins.
 *
 * Set from the game, not from taste: hole cards reach
 * `TABLE.radius - 0.17 + CARD_HEIGHT / 2` = 0.894, so the felt has to run past
 * that with a margin a card can be nudged into. The old torus rail happened to
 * have its inner edge at 0.94, which is where this lands too - the difference
 * is that it is now derived and checked instead of coincidental.
 */
export const FELT_RADIUS = 0.9;

/** Inner edge of the padded rail, just outside the felt. */
export const RAIL_INNER = 0.912;

/** Highest point of the padded rail, and the widest part of the table. */
export const RAIL_CROWN_R = TABLE.radius;
export const RAIL_CROWN_Y = 0.062;

/** Outer edge of the rail, where it turns down into the apron. */
export const RAIL_OUTER = 1.1;

/**
 * The gold inlay: a hairline race between the felt and the rail, which is the
 * detail that reads as "premium" at a glance and costs one ring of triangles.
 */
export const INLAY_INNER = 0.882;
export const INLAY_OUTER = 0.9;

/**
 * The neon race. Tucked under the lip of the rail, pointing down and out, so
 * what a player sees is the light on the apron rather than the tube.
 *
 * Its height is load-bearing: see `decor.ts` and the face-band rule. A glowing
 * ring at eye level would halo every face across the table, which is the one
 * thing the art direction may not do.
 */
export const NEON_RADIUS = 1.075;
export const NEON_Y = -0.052;
export const NEON_TUBE = 0.009;

/**
 * The padded rail, bottom to top.
 *
 * Order matters: `LatheGeometry` derives its normals as `(dy, -dx)` along the
 * profile, so a profile that runs upward faces outward. Reversing this list
 * turns the table inside out.
 *
 * The shape is a real card-room rail rather than a torus: it climbs from the
 * felt in a shallow curve, crowns where a forearm rests, and rolls over to a
 * squarer outer edge. A torus is symmetric, which makes it read as a tube
 * lying on a disc; the asymmetry is what makes it read as upholstery.
 */
export function railProfile(): ProfilePoint[] {
  return [
    // Underside of the rail, sunk just below the felt so no seam shows.
    { r: RAIL_INNER, y: -0.012 },
    { r: RAIL_INNER, y: 0.004 },
    // The climb. Two intermediate points, because one gives a visible crease
    // where the eye expects a roll.
    { r: 0.941, y: 0.026 },
    { r: 0.975, y: 0.05 },
    { r: RAIL_CROWN_R, y: RAIL_CROWN_Y },
    { r: 1.062, y: 0.056 },
    { r: 1.09, y: 0.038 },
    // The outer lip, nearly vertical, where the leather is pulled under.
    { r: RAIL_OUTER, y: 0.014 },
    { r: RAIL_OUTER, y: -0.012 },
  ];
}

/**
 * The wooden apron and the underside, bottom to top.
 *
 * Separate from the rail because it is a different material, and a lathe
 * carries one. Two meshes is also two draw calls rather than a grouped
 * geometry with two, so nothing is lost.
 */
export function apronProfile(): ProfilePoint[] {
  return [
    // Underside, closed in towards the pedestal so the table is not a shell
    // with a visible hollow when someone leans back.
    { r: 0.34, y: -0.2 },
    { r: 1.02, y: -0.2 },
    { r: 1.062, y: -0.185 },
    // The apron face: a shallow outward swell, the wooden band under the rail.
    { r: 1.086, y: -0.13 },
    { r: RAIL_OUTER, y: -0.06 },
    { r: RAIL_OUTER, y: -0.012 },
  ];
}

/**
 * The pedestal, bottom to top: a turned column on a weighted foot.
 *
 * Barely visible from a seated eye-line - you see it under the table opposite,
 * through the gap between the apron and the floor - which is exactly why it is
 * cheap and why it is still here. An unfinished stump under the table opposite
 * you is the sort of thing nobody points at and everybody registers.
 */
export function pedestalProfile(): ProfilePoint[] {
  const top = -0.2;
  return [
    { r: 0.0, y: -TABLE.topY },
    { r: 0.42, y: -TABLE.topY },
    { r: 0.42, y: -TABLE.topY + 0.03 },
    { r: 0.3, y: -TABLE.topY + 0.055 },
    { r: 0.19, y: -TABLE.topY + 0.11 },
    { r: 0.16, y: -TABLE.topY + 0.3 },
    { r: 0.21, y: top - 0.09 },
    { r: 0.34, y: top - 0.01 },
    { r: 0.34, y: top },
  ];
}

/** Triangles a profile costs at `segments` radial divisions. */
export function profileTriangles(
  points: readonly ProfilePoint[],
  segments: number,
): number {
  return Math.max(0, points.length - 1) * segments * 2;
}

/** Radial divisions. One number, so every lathed part stays concentric. */
export const TABLE_SEGMENTS = 56;

/**
 * Every triangle the table costs, so the 15k budget in `plan.md` is a number
 * this file can be held to rather than a note in a document.
 *
 * Counts the lathes, the felt disc, the inlay ring and the neon torus.
 */
export function tableTriangles(): number {
  const lathes =
    profileTriangles(railProfile(), TABLE_SEGMENTS) +
    profileTriangles(apronProfile(), TABLE_SEGMENTS) +
    profileTriangles(pedestalProfile(), TABLE_SEGMENTS);
  const felt = TABLE_SEGMENTS;
  const inlay = TABLE_SEGMENTS * 2;
  // Torus: radial segments x tubular segments x 2.
  const neon = 8 * TABLE_SEGMENTS * 2;
  return lathes + felt + inlay + neon;
}

/** `plan.md`: "Hero table under 15k tris." */
export const TABLE_TRIANGLE_BUDGET = 15_000;
