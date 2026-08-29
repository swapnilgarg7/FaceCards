/**
 * The room around the table, as numbers.
 *
 * Pure, no three.js import; `RoomShell.tsx` builds what this describes. Two
 * rules live here, and both of them are rules the *art* has to obey rather
 * than rules about art.
 *
 * **1. The room is round, and every fixture is a ring.** Not a style choice -
 * the same argument `seatLayout` already makes. A neon sign on one wall is
 * behind somebody. A brass sconce at one bearing is over one person's shoulder
 * and nowhere near anyone else's. Anything that is not rotationally symmetric
 * quietly picks a favourite seat, and this product cannot afford that: the
 * whole point is that nobody has a worse seat than anybody else. So the sign
 * is a race, the sconces are a ring of eight, and the cove runs all the way
 * round.
 *
 * **2. Nothing that glows may sit in the face band.** A face plane is 0.34m
 * tall centred on `EYE_HEIGHT`, and the speaking halo behind it is a little
 * taller. Anything emissive at that height, at the far side of a room five
 * metres across, sits directly behind somebody's head and haloes it. Every
 * emissive fixture in the room therefore declares its vertical extent, and
 * `FIXTURES` is checked against `faceBand()` by both the unit tests and
 * `verify:phase5`. This is the mechanical form of the phase-5 exit criterion
 * "faces and cards are still the two most legible things on screen".
 */

import { EYE_HEIGHT } from "./layout.js";
import { FACE_PLANE_HEIGHT } from "./body.js";

/** Inside face of the wall. Far enough back that the fog does the far work. */
export const ROOM_RADIUS = 3.6;
export const ROOM_HEIGHT = 3.05;

/** Dark panelled dado, capped just above the table so it reads under the rail. */
export const WAINSCOT_HEIGHT = 0.82;
/** The brass capping rail on top of the panelling. */
export const WAINSCOT_CAP = 0.02;

/** Radial divisions for the wall and ceiling. */
export const ROOM_SEGMENTS = 48;

/**
 * How far a fixture may be from the wall before it stops being background.
 * Nothing in this file is closer to a seat than a seat is to the table.
 */
export const FIXTURE_INSET = 0.12;

/**
 * A glowing thing, and the band of height it occupies.
 *
 * `y` is the centre, `halfHeight` the extent including whatever glow sprite
 * rides with it, because the halo is what would actually land on a face.
 */
export interface Fixture {
  id: string;
  y: number;
  halfHeight: number;
  /** Distance from the room axis. Zero for the pendant over the table. */
  radius: number;
  /** Emissive colour, as it appears in the scene. */
  colour: string;
}

/**
 * How much taller than the face plane the speaking halo is. Kept in step with
 * the quad in `Avatar.tsx`: the halo is the outermost thing a face occupies,
 * so it is the halo, not the face, that sets the band.
 */
export const HALO_SCALE = 1.24;

/**
 * Slack beyond the halo's own edge, because a light that stops a millimetre
 * short of a face still lands on it. Six centimetres at four metres is a
 * couple of degrees, which is enough to keep a glow off a cheek.
 */
export const FACE_BAND_MARGIN = 0.06;

/** The vertical band that must stay dark, halo and margin included. */
export function faceBand(): { low: number; high: number } {
  const half = (FACE_PLANE_HEIGHT * HALO_SCALE) / 2 + FACE_BAND_MARGIN;
  return { low: EYE_HEIGHT - half, high: EYE_HEIGHT + half };
}

/**
 * Every emissive fixture in the room, table included.
 *
 * The table's own neon race is listed here rather than in `tableProfile.ts`
 * because this is the list the face-band rule is checked against, and a rule
 * with two lists is a rule with a hole in it.
 */
export const FIXTURES: readonly Fixture[] = [
  {
    // The pooled light over the table. The shade is the visible fixture; the
    // spotlight that does the real work hangs inside it.
    id: "pendant",
    y: 2.12,
    halfHeight: 0.19,
    radius: 0,
    colour: "#ffdca8",
  },
  {
    // High neon race, up where the wall meets the ceiling cove.
    id: "cornice-neon",
    y: 2.58,
    halfHeight: 0.14,
    radius: ROOM_RADIUS - FIXTURE_INSET,
    colour: "#ff4d8d",
  },
  {
    // Low cove washing the floor. Below the table, so it silhouettes the
    // apron and never reaches a face.
    id: "floor-cove",
    y: 0.14,
    halfHeight: 0.1,
    radius: ROOM_RADIUS - FIXTURE_INSET,
    colour: "#3aa0ff",
  },
  {
    // Brass sconces on the pilasters. High on the wall, above every head.
    id: "sconces",
    y: 1.94,
    halfHeight: 0.16,
    radius: ROOM_RADIUS - 0.16,
    colour: "#ffbe63",
  },
  {
    // The table's own race, tucked under the rail lip. See `tableProfile.ts`.
    id: "table-neon",
    y: 0.708,
    halfHeight: 0.05,
    radius: 1.075,
    colour: "#ff4d8d",
  },
];

/** True when a fixture's glow is entirely clear of the face band. */
export function clearsFaceBand(fixture: Fixture): boolean {
  const band = faceBand();
  const low = fixture.y - fixture.halfHeight;
  const high = fixture.y + fixture.halfHeight;
  return high <= band.low || low >= band.high;
}

/** How many pilasters ring the room. Eight, so no seat faces a blank wall. */
export const PILASTER_COUNT = 8;

/**
 * Background motion, and its ceiling.
 *
 * `plan.md`: "Background elements may animate subtly but must never pull
 * attention off faces and cards." That is a real constraint with a number
 * attached, so it gets one: no background element may vary its emissive
 * intensity by more than this fraction, and none may move at all. Neon breathes
 * because real neon does; nothing in this room swings, spins or flickers.
 */
export const AMBIENT_MOTION_MAX = 0.06;

/**
 * Slow neon breath, in [1 - AMBIENT_MOTION_MAX, 1 + AMBIENT_MOTION_MAX].
 *
 * Two incommensurate periods, for the same reason the room murmur uses three:
 * a single sine has a period the eye finds, and a found period is a thing that
 * is moving rather than a room that is alive. Pure, so the bound is a test
 * rather than a hope.
 */
export function neonBreath(seconds: number, phase = 0): number {
  const slow = Math.sin(seconds * 0.31 + phase);
  const slower = Math.sin(seconds * 0.113 + phase * 1.7);
  return 1 + ((slow * 0.6 + slower * 0.4) * AMBIENT_MOTION_MAX);
}
