/**
 * Whether the table's first hand is still waiting for the room.
 *
 * There is exactly one moment in an evening where "enough players" and "the
 * table" are different sets: the first hand. Every later deal follows a hand
 * everybody just watched, so the roster is already settled.
 *
 * The first deal is not like that. People arrive over a minute, find their
 * camera, say hello, and press Play in whatever order they get to it. Dealing
 * as soon as two seats are ready starts a heads-up hand between the two
 * fastest clickers while everyone else is still clicking - and the four people
 * who then watch a hand they thought they had joined is the worst first
 * impression this product can make. A poker night starts when the people at
 * the table are ready, which is a sentence somebody says out loud.
 *
 * So there is no timeout here and deliberately so: the table waits for the
 * room, however long the room takes. The escape hatch is not a deadline, it is
 * the three ways a seat stops being someone we are waiting on - it drops, it
 * sits out, or it has no chips - so one friend who wandered off cannot hold
 * the evening hostage once they close the tab or sit out.
 *
 * Pure: seat facts in, a yes or a no out, no clock and no room.
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
 * Hold the very first deal until every seat that could press Play has.
 *
 * `hasDealt` is the table's whole history: once one hand has been played the
 * roster question is settled and this is always false.
 */
export function holdForTable(
  seats: readonly DealSeat[],
  hasDealt: boolean,
): boolean {
  if (hasDealt) return false;
  return !seats.every(isSettled);
}

/**
 * Whether this seat is done deciding, either way.
 *
 * A seat nobody is waiting on is one that has said yes, or one that could not
 * say anything useful if it wanted to. Sitting out and being broke are both
 * answers; a closed laptop is not a person about to press Play. Waiting on any
 * of them would hand one absent friend a veto over the evening, and with no
 * deadline behind this that veto would be permanent.
 */
function isSettled(seat: DealSeat): boolean {
  if (seat.ready) return true;
  return !seat.connected || seat.sittingOut || !seat.funded;
}
