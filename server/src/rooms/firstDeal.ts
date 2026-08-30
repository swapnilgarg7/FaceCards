import { FIRST_HAND_GRACE_MS, HAND_START_DELAY_MS } from "@facecards/shared";

/**
 * How long to hold a deal that has just become possible.
 *
 * There is exactly one moment in an evening where "enough players" and "the
 * table" are different sets: the first hand. Every later deal follows a hand
 * everybody just watched, so the roster is already settled and the two-second
 * beat is only there so the felt is not cleared out from under the last click.
 *
 * The first deal is not like that. People arrive over a minute, find their
 * camera, say hello, and press Play in whatever order they get to it. Firing
 * two seconds after the *second* Play deals a heads-up hand to the two fastest
 * clickers - and because a seat that misses a hand then waits for the big
 * blind, the other five join back one per hand rather than all at once. The
 * table spends its first ten minutes watching two people play.
 *
 * So: before a table has dealt anything, wait the long grace unless everyone
 * who is here and able has already said they are ready, in which case there is
 * nothing left to wait for and the normal beat runs. The grace is a backstop
 * for a friend who wandered off, not the usual path.
 *
 * Pure: seat facts in, milliseconds out, no clock and no room.
 */

/** One seat as the room sees it when a deal becomes possible. */
export interface DealSeat {
  /** Has pressed Play. */
  ready: boolean;
  /** Socket is live. A dropped seat cannot press anything. */
  connected: boolean;
  /** Has chosen to be dealt out. */
  sittingOut: boolean;
  /** Has chips, or chips arriving at the next deal. */
  funded: boolean;
}

/**
 * Milliseconds to wait before dealing.
 *
 * `hasDealt` is the table's whole history: once one hand has been played the
 * roster question is settled and this is a constant.
 */
export function dealDelayMs(
  seats: readonly DealSeat[],
  hasDealt: boolean,
): number {
  if (hasDealt) return HAND_START_DELAY_MS;
  return seats.every(isSettled) ? HAND_START_DELAY_MS : FIRST_HAND_GRACE_MS;
}

/**
 * Whether this seat is done deciding, either way.
 *
 * A seat nobody is waiting on is one that has said yes, or one that could not
 * say anything useful if it wanted to. Sitting out and being broke are both
 * answers; a closed laptop is not a person about to press Play. Holding the
 * whole table for any of them would hand one absent friend a veto over the
 * evening, which is what the grace deadline is there to prevent.
 */
function isSettled(seat: DealSeat): boolean {
  if (seat.ready) return true;
  return !seat.connected || seat.sittingOut || !seat.funded;
}
