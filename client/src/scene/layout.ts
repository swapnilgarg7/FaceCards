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

/**
 * Metres. Round, not oval, and deliberately smaller than a real card-room
 * table so faces read at conversational distance.
 *
 * Round is a sightline decision, not a styling one. On an ellipse, evenly
 * spaced players are not evenly spaced *to each other*: three of them sit at
 * 24 and 36 degrees rather than a matched 30, and whoever draws the short axis
 * is closer to the felt than everyone else. On a circle every arrangement is a
 * regular polygon, so nobody has a worse seat than anybody else.
 */
export const TABLE = {
  radius: 1.02,
  /** Top of the felt. */
  topY: 0.76,
  railTube: 0.08,
} as const;

/** How far a seated player sits back from the table edge. */
export const SEAT_OUTSET = 0.26;

/**
 * Seated eye height above the floor. Both the camera and the centre of every
 * face plane live at exactly this height, which is what makes eye-lines line
 * up across the table.
 */
export const EYE_HEIGHT = 1.17;

const TAU = Math.PI * 2;

/**
 * Where slot 0 sits. Every other slot is measured from here, so the first
 * person at the table never moves as the room fills up around them.
 */
export const FIRST_SEAT_BEARING = 0;

/**
 * How far the seated look can turn. A ring keeps every face well inside this,
 * but the clamp is what guarantees it: `layout.test.ts` asserts every seat is
 * reachable, so shrinking this breaks a test rather than quietly making
 * someone unlookable-at.
 */
export const MAX_LOOK_YAW = (100 * Math.PI) / 180;

/** Asymmetric on purpose: you look down at cards far more than you look up. */
export const MAX_LOOK_PITCH_UP = (14 * Math.PI) / 180;
export const MAX_LOOK_PITCH_DOWN = (50 * Math.PI) / 180;

export interface Seat {
  /** Ring slot, 0-based. Not the server's seat index; see `assignSeats`. */
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
 * `count` players spread evenly around the whole table.
 *
 * Everyone faces the centre, so spreading evenly is also what puts faces in
 * front of faces: two players land exactly opposite and meet head-on, three
 * make an equilateral triangle, four a square. The widest turn anyone has to
 * make works out at exactly `90 - 180/count` degrees, so it grows slowly and
 * predictably: 0 at two players, 30 at three, 45 at four, 60 at six. A face
 * plane is a flat quad, so it stays legible for as long as that number stays
 * small. Crowding players onto part of the ring instead would push everyone
 * into each other's periphery for no gain.
 *
 * The layout therefore depends on **how many people are actually here**, not
 * on the table's capacity. Filling fixed slots of a six-seat table means the
 * first two arrivals sit shoulder to shoulder staring at the felt, which is
 * exactly the failure this replaced.
 */
export function seatLayout(count: number): Seat[] {
  if (count < 1) return [];

  const step = TAU / count;
  const seats: Seat[] = [];

  for (let index = 0; index < count; index++) {
    const bearing = FIRST_SEAT_BEARING + index * step;
    const seatRadius = TABLE.radius + SEAT_OUTSET;
    const x = seatRadius * Math.cos(bearing);
    const z = seatRadius * Math.sin(bearing);

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

/**
 * Server seat index -> where that player sits right now.
 *
 * The server owns seat *identity* (who holds a seat, and that they keep it for
 * the session). This owns seat *placement*, which has to re-flow as the roster
 * changes or a table of two is a table of two people sitting side by side.
 *
 * Ordering by seat index rather than by join time or map iteration order is
 * what makes this agree across clients: every client is looking at the same
 * player set, so every client must derive the same ring, or eye-lines meet
 * nowhere. Lower seat indices take lower slots, so the player who was here
 * first keeps slot 0 and does not move when the room grows.
 */
export function assignSeats(seatIndices: readonly number[]): Map<number, Seat> {
  const ordered = [...new Set(seatIndices)].sort((a, b) => a - b);
  const ring = seatLayout(ordered.length);

  const placed = new Map<number, Seat>();
  ordered.forEach((seatIndex, slot) => {
    const seat = ring[slot];
    if (seat) placed.set(seatIndex, seat);
  });
  return placed;
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
