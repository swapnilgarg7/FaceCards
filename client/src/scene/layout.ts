import { MAX_PLAYERS } from "@facecards/shared";

/**
 * Table and seat geometry. Pure numbers and pure functions, no three.js import,
 * so the layout can be unit-tested without a renderer.
 *
 * Everything here is a tuning knob. Eye-line is the single most fragile thing
 * in the product: a face plane at the wrong height or angle reads instantly as
 * a floating TV rather than a person. `EYE_HEIGHT` is deliberately shared by
 * the camera rig and the avatar face plane, because the moment those two
 * numbers can drift apart, every seat is looking slightly over everyone's head.
 */

/** Metres. A real poker table is about 0.76 m tall, so this is life-size. */
export const TABLE = {
  radiusX: 1.3,
  radiusZ: 0.92,
  /** Top of the felt. */
  topY: 0.76,
  railTube: 0.08,
} as const;

/** How far a seated player sits back from the table edge. */
export const SEAT_OUTSET = 0.28;

/**
 * Seated eye height above the floor. Both the camera and the centre of every
 * face plane live at exactly this height, which is what makes eye-lines line
 * up across the table.
 */
export const EYE_HEIGHT = 1.17;

const TAU = Math.PI * 2;

/**
 * Seats occupy an arc, not the full ring.
 *
 * A true circle puts the widest seats far enough round that you have to turn
 * your whole body, and at higher seat counts it eventually puts someone behind
 * you. Leaving a gap on the dealer side fans everyone into a horseshoe, so
 * every face is inside a comfortable head-turn from every other seat.
 */
export const SEAT_ARC_SPAN = (280 * Math.PI) / 180;

/** Bearing of the gap in the horseshoe. The board and dealer live here. */
export const DEALER_BEARING = Math.PI / 2;

/**
 * How far the seated look can turn. Not arbitrary: at six seats the player
 * beside you is about 80 degrees off your resting forward, because that is
 * where a neighbour physically sits, and a view that cannot reach them cannot
 * hold a conversation with them. `layout.test.ts` asserts every seat stays
 * reachable inside this clamp, so shrinking it breaks a test rather than
 * quietly making someone unlookable-at.
 */
export const MAX_LOOK_YAW = (100 * Math.PI) / 180;

/** Asymmetric on purpose: you look down at cards far more than you look up. */
export const MAX_LOOK_PITCH_UP = (14 * Math.PI) / 180;
export const MAX_LOOK_PITCH_DOWN = (50 * Math.PI) / 180;

export interface Seat {
  index: number;
  /** Floor position of the seat. */
  x: number;
  z: number;
  /** Y rotation that points the seat's forward (-Z) at the table centre. */
  yaw: number;
  /** Eye height, shared by the camera and the face plane. */
  eyeY: number;
}

/**
 * Fixed seats around the table.
 *
 * Data-driven on purpose: the spec ships 2 to 6 but wants the architecture
 * ready for 10, and no scene code should have to change to get there. Seats
 * are laid out for the table's full capacity, not for who is currently in the
 * room, because a seat is fixed for the session (spec section 2) and must not
 * move under a player when someone else joins.
 */
export function seatLayout(count: number = MAX_PLAYERS): Seat[] {
  const gap = TAU - SEAT_ARC_SPAN;
  const start = DEALER_BEARING + gap / 2;
  const step = SEAT_ARC_SPAN / count;

  const seats: Seat[] = [];
  for (let index = 0; index < count; index++) {
    // Half-step in, so the fan is symmetric about the gap for any count.
    const bearing = start + (index + 0.5) * step;
    const x = (TABLE.radiusX + SEAT_OUTSET) * Math.cos(bearing);
    const z = (TABLE.radiusZ + SEAT_OUTSET) * Math.sin(bearing);

    seats.push({
      index,
      x,
      z,
      // A three.js object faces its local -Z. Rotating by atan2(x, z) turns
      // that forward vector onto the direction from the seat to the origin.
      yaw: Math.atan2(x, z),
      eyeY: EYE_HEIGHT,
    });
  }
  return seats;
}

/** Unit forward vector (world XZ) for a seat, i.e. where that player looks. */
export function seatForward(seat: Seat): { x: number; z: number } {
  return { x: -Math.sin(seat.yaw), z: -Math.cos(seat.yaw) };
}

/**
 * Signed horizontal angle from `from`'s resting forward to `to`'s head.
 *
 * This is the number the seat layout exists to keep small: it is how far a
 * player has to turn to look someone in the eye. Positive is to the left.
 */
export function bearingBetweenSeats(from: Seat, to: Seat): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const forward = seatForward(from);
  // atan2 of the cross and dot products, which stays well-conditioned near
  // both zero and pi where a plain acos does not.
  const cross = forward.x * dz - forward.z * dx;
  const dot = forward.x * dx + forward.z * dz;
  return Math.atan2(cross, dot);
}
