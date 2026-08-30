/**
 * Who pays the blinds, and who is dealt in at all.
 *
 * This is the part of Hold'em that has nothing to do with cards and almost
 * everything to do with people arriving and leaving, which is exactly what a
 * table of friends does all evening. It is separated from `engine.ts` because
 * it answers a different question - *who is in this hand and what do they owe
 * before it starts* - and because it is the half that is easy to get subtly,
 * expensively wrong.
 *
 * Three rules, all of them real casino procedure, all of them here because a
 * naive "move the button to the next occupied seat" gets each one backwards:
 *
 *  - **The big blind moves forward one live seat every hand, and is never
 *    dead.** It is the anchor. Everything else is derived from where it went,
 *    which is what makes it impossible for a player to be charged it twice in
 *    a row or to skip it by having a neighbour leave.
 *
 *  - **The small blind is a position, not a person.** Whoever paid the big
 *    blind last hand pays the small blind this hand. If they left in between,
 *    *nobody* posts it and the pot is simply that much smaller - a **dead
 *    small blind**. The alternative, sliding the small blind onto the next
 *    player along, would charge someone two blinds in two hands.
 *
 *  - **The button is a marker and may sit on an empty chair.** It follows the
 *    small blind position round, so it can land where a player used to be: a
 *    **dead button**. Moving it onto a live seat instead is the classic bug,
 *    because it drags the whole blind sequence with it and someone pays twice.
 *
 * There is deliberately **no waiting for the big blind**. Casino procedure
 * holds a player who joins mid-orbit, returns from sitting out, or rebuys after
 * busting out of the game until the big blind reaches them, so that nobody can
 * step in one place past the blinds, play the cheapest seat at the table, and
 * step out again before paying. That rule protects a game against strangers.
 * This is six friends on a video call, where the move it prevents is not one
 * anybody makes, and its cost is enormous: `nextBlinds` can only admit one
 * waiter per hand - the seat the blind happens to land on - so at a
 * seven-handed table, rebuying meant watching your friends play up to six more
 * hands before you saw a card. Anyone ready, connected and holding chips when
 * the deal comes round is dealt in, every time. That decision lives in one
 * place, the room's `eligiblePlayers`, and arrives here as `ready`.
 *
 * The consequence is that seats appear mid-rotation as a matter of course,
 * which is exactly what the button assertion further down exists to survive.
 *
 * Pure, like everything else in this directory: seat numbers in, seat numbers
 * out, no clock and no I/O.
 */

/** One seat's standing as the next hand is about to be arranged. */
export interface BlindSeat {
  seat: number;
  /**
   * Able and willing to be dealt in right now: connected, not sitting out,
   * and holding at least one chip. The room decides this; the rule below only
   * cares that it is a yes or a no.
   */
  ready: boolean;
}

/** Where the button and the blinds sit for one hand. */
export interface BlindPositions {
  /**
   * Seats dealt into this hand, ascending. Always at least two, and always
   * every ready seat - see the note above about not waiting for the blind.
   */
  dealt: number[];
  /**
   * The button. **May not be in `dealt`**: a dead button is a legal, ordinary
   * position and the engine walks the ring from it without needing it to be
   * a live seat.
   */
  button: number;
  /**
   * The small blind *position*, live or dead. Carried forward to place the
   * next hand's button, which is the only reason it is distinct from
   * `smallBlindSeat`.
   */
  smallBlindPos: number;
  /** Who actually posts the small blind, or null when the position is empty. */
  smallBlindSeat: number | null;
  /** Who posts the big blind. Never null: there is always a big blind. */
  bigBlindSeat: number;
}

/** The previous hand's arrangement, or null before a table's first hand. */
export type PreviousBlinds = Pick<
  BlindPositions,
  "button" | "smallBlindPos" | "bigBlindSeat"
>;

/** First seat in `ring` strictly clockwise of `from`, wrapping once. */
function firstAfter(ring: readonly number[], from: number): number | null {
  if (ring.length === 0) return null;
  return ring.find((seat) => seat > from) ?? ring[0]!;
}

/** Last seat in `ring` strictly counter-clockwise of `from`, wrapping once. */
function firstBefore(ring: readonly number[], from: number): number | null {
  if (ring.length === 0) return null;
  for (let i = ring.length - 1; i >= 0; i--) {
    if (ring[i]! < from) return ring[i]!;
  }
  return ring[ring.length - 1]!;
}

/**
 * Arrange the next hand, or return null if there is no hand to arrange.
 *
 * Null means fewer than two seats are ready, which is the table's "waiting for
 * players" state rather than an error.
 */
export function nextBlinds(
  seats: readonly BlindSeat[],
  previous: PreviousBlinds | null,
): BlindPositions | null {
  const ready = [...seats]
    .filter((s) => s.ready)
    .sort((a, b) => a.seat - b.seat);
  if (ready.length < 2) return null;

  const readySeats = ready.map((s) => s.seat);

  // A table that has never dealt owes nobody anything: everyone who is here is
  // in, and the button starts on the lowest seat.
  if (!previous) {
    return arrange(readySeats, readySeats[0]!, true);
  }

  // The anchor. One live seat forward from wherever it was, every hand,
  // without exception - including onto a seat that is waiting for it, which is
  // precisely how waiting for the big blind ends.
  const bigBlindSeat = firstAfter(readySeats, previous.bigBlindSeat)!;

  // Everybody ready plays. The whole of "who is in this hand" is `ready`, and
  // it is answered one call up by the room.
  const dealt = readySeats;

  if (dealt.length === 2) {
    // Heads-up inverts everything: the button posts the small blind, so there
    // is no dead anything and the general construction below does not apply.
    const button = dealt.find((seat) => seat !== bigBlindSeat)!;
    return {
      dealt,
      button,
      smallBlindPos: button,
      smallBlindSeat: button,
      bigBlindSeat,
    };
  }

  // Whoever paid the big blind last hand owes the small blind this hand. If
  // they are gone, the position stays where it is and goes unpaid.
  const smallBlindPos = previous.bigBlindSeat;
  const smallBlindSeat =
    dealt.includes(smallBlindPos) && smallBlindPos !== bigBlindSeat
      ? smallBlindPos
      : null;

  // The button follows the small blind position round, empty chair or not -
  // *provided* the position it lands on is still the one immediately before
  // the small blind on this hand's ring.
  //
  // That proviso is the whole rule, and checking a weaker version of it is a
  // real bug rather than a theoretical one. It is tempting to only guard
  // against the button colliding with a blind, but the case that actually
  // bites is a seat being dealt in *between* the carried button and the small
  // blind: the button is then left two or more seats behind, and since
  // `openRound` walks the ring from the button, postflop action opens on the
  // stranded seat every street. They act first all hand and the seat on their
  // right gets last action it never paid for. `splitPot` reads the button too,
  // so the odd chip goes one chair early as well. Preflop order is derived
  // from the big blind rather than the button, so none of this shows up in a
  // fold-heavy hand - which is exactly why it needs an assertion rather than
  // an eyeball.
  //
  // Reachable whenever a seat rejoins mid-rotation which, with no waiting
  // rule, is every rebuy, every sit-in and every friend who arrives late.
  let button = previous.smallBlindPos;
  // With a dead small blind the first live seat clockwise of the button is the
  // big blind instead; the position it is measured against is the same either
  // way.
  const leftOfButton = smallBlindSeat ?? bigBlindSeat;
  if (firstAfter(dealt, button) !== leftOfButton) {
    // Put it back where it belongs: the last dealt seat before the small blind
    // position. Note this is only reached when the carried position is wrong,
    // so a legitimate dead button - one with no dealt seat between it and the
    // small blind - is left exactly where it is.
    button = firstBefore(dealt, smallBlindPos) ?? button;
  }

  return { dealt, button, smallBlindPos, smallBlindSeat, bigBlindSeat };
}

/** Button, small blind, big blind in consecutive live seats. */
function arrange(
  dealt: readonly number[],
  button: number,
  headsUpButtonIsSmall: boolean,
): BlindPositions {
  const seats = [...dealt];
  if (seats.length === 2 && headsUpButtonIsSmall) {
    const bigBlindSeat = firstAfter(seats, button)!;
    return {
      dealt: seats,
      button,
      smallBlindPos: button,
      smallBlindSeat: button,
      bigBlindSeat,
    };
  }
  const smallBlindPos = firstAfter(seats, button)!;
  const bigBlindSeat = firstAfter(seats, smallBlindPos)!;
  return {
    dealt: seats,
    button,
    smallBlindPos,
    smallBlindSeat: smallBlindPos,
    bigBlindSeat,
  };
}

