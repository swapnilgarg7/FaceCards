import { type Card } from "./cards.js";
import { type HandState } from "./engine.js";
import {
  HandCategory,
  categoryOf,
  evaluate,
  type HandCategoryValue,
} from "./evaluate.js";

/**
 * A decided hand, told as facts rather than as a sentence.
 *
 * Poker Moments - the winner card, the reaction strip, "THE RIVER CHOSE
 * VIOLENCE" - are a client feature, and every one of them is a joke about a
 * poker situation. Working out *which* situation is a poker question: whether
 * a hand was a bluff that got called, whether the river turned it over,
 * whether the player who just lost their last chip is out of the game. So it
 * is answered here, next to the engine that already knows, and the client is
 * handed the answer.
 *
 * Two rules this file exists to hold, and neither is negotiable:
 *
 *  - **Nothing here may describe a card that is not already public.** Hand
 *    strength is published only for a seat in `result.showdown`, whose cards
 *    the whole table is about to see anyway. A hand that ended on folds gets
 *    `showed: false`, `category: -1` and no bluff, however obvious the bluff
 *    was, because "he had nothing" is a statement about two private cards and
 *    a caption is not a good enough reason to make it.
 *  - **Nothing here decides anything.** No chip moves because of a story. It
 *    is read after `finish()` has already paid the pots, and if it threw the
 *    hand would still be correctly settled.
 *
 * Pure: `HandState` in, plain data out. No clock, no randomness, no I/O - so
 * every classification below is a table-driven test rather than something you
 * have to reproduce at a real table to see.
 */

/** What happened to one seat. Mirrors `HandNote` in `shared/`. */
export interface SeatStory {
  seat: number;
  /** Chips won across every pot. Zero for a loser. */
  won: number;
  /** Chips put in across the whole hand. */
  committed: number;
  allIn: boolean;
  /** Finished with nothing behind. */
  busted: boolean;
  /** Made the last bet or raise of the hand. */
  aggressor: boolean;
  /** The largest single call this seat made. */
  biggestCall: number;
  /** Reached a showdown, so this seat's cards are in `reveals`. */
  showed: boolean;
  /** `HandCategory` of what it showed, or -1 for a seat that never showed. */
  category: number;
  /** Was ahead after the turn and lost on the river. Showdown seats only. */
  rivered: boolean;
}

export interface HandStory {
  seats: SeatStory[];
  /** Seat whose bluff got called, or -1. Never set without a showdown. */
  bluffCaughtSeat: number;
}

/** No seat. Matches `NO_SEAT` in the mirror and `actingSeat`'s convention. */
const NO_SEAT = -1;

/**
 * The strongest hand that still counts as "he had nothing".
 *
 * One pair is in, and that is the interesting half of the line. A player who
 * fires three streets with second pair and gets looked up was not bluffing in
 * the technical sense, but the caption the table wants is still "the audacity"
 * rather than a cooler - and the alternative threshold, high card only, fires
 * about twice an evening and makes the whole category feel broken.
 *
 * What keeps it honest is the *other* half of the test, in `bluffCaught`: they
 * also have to have been the one doing the betting, after the flop, and have
 * lost. Someone who checks down a pair of fours and loses is not accused of
 * anything.
 */
const BLUFF_CEILING: HandCategoryValue = HandCategory.Pair;

/** Board cards visible at the turn. A hand that ended earlier has no river. */
const TURN_BOARD = 4;
const RIVER_BOARD = 5;

/**
 * Read the story off a finished hand.
 *
 * Throws nothing and returns an empty story for a hand that has not finished:
 * the caller is a mirror running at the end of a payout, and a story is the
 * least important thing on that screen.
 */
export function handStory(state: HandState): HandStory {
  const result = state.result;
  if (!result) return { seats: [], bluffCaughtSeat: NO_SEAT };

  const wonBySeat = new Map<number, number>();
  for (const award of result.awards) {
    wonBySeat.set(award.seat, (wonBySeat.get(award.seat) ?? 0) + award.amount);
  }

  const shown = new Map(result.showdown.map((entry) => [entry.seat, entry]));
  const rivered = riveredSeats(state);

  // The last bet or raise anybody made. Not the biggest: the story of a hand
  // is told forwards, and whoever put the last chips in is the one the table
  // was answering when it decided to call.
  let aggressorSeat = NO_SEAT;
  let aggressorStreet: string | null = null;
  const biggestCall = new Map<number, number>();
  for (const action of state.history) {
    if (action.aggressive) {
      aggressorSeat = action.seat;
      aggressorStreet = action.street;
    }
    if (action.type === "call") {
      biggestCall.set(
        action.seat,
        Math.max(biggestCall.get(action.seat) ?? 0, action.paid),
      );
    }
  }

  const seats: SeatStory[] = [];
  for (const seatIndex of state.order) {
    const seat = state.seats.get(seatIndex);
    if (!seat) continue;
    const entry = shown.get(seatIndex);
    seats.push({
      seat: seatIndex,
      won: wonBySeat.get(seatIndex) ?? 0,
      committed: seat.totalCommitted,
      allIn: seat.status === "allin",
      // `finish()` has already credited the pots, so this is the stack the
      // player is left looking at rather than the one they had mid-hand.
      busted: seat.stack === 0,
      aggressor: seatIndex === aggressorSeat,
      biggestCall: biggestCall.get(seatIndex) ?? 0,
      showed: entry !== undefined,
      category: entry ? categoryOf(entry.score) : NO_SEAT,
      rivered: rivered.has(seatIndex),
    });
  }

  return {
    seats,
    bluffCaughtSeat: bluffCaught(
      seats,
      aggressorSeat,
      aggressorStreet,
      shown.size > 0,
    ),
  };
}

/**
 * The seat that got caught.
 *
 * Four conditions, all of them necessary:
 *
 *  - there was a showdown, so nothing below leaks a private card;
 *  - the seat we are about to name *showed*, for the same reason;
 *  - it made the last bet or raise, and made it after the flop - a preflop
 *    raiser who gets three callers and loses is not bluffing, they are
 *    playing a hand;
 *  - it lost, holding at most a pair.
 */
function bluffCaught(
  seats: readonly SeatStory[],
  aggressorSeat: number,
  aggressorStreet: string | null,
  showdown: boolean,
): number {
  if (!showdown || aggressorSeat === NO_SEAT) return NO_SEAT;
  if (aggressorStreet === null || aggressorStreet === "preflop") return NO_SEAT;
  const story = seats.find((s) => s.seat === aggressorSeat);
  if (!story?.showed) return NO_SEAT;
  if (story.won > 0) return NO_SEAT;
  return story.category <= BLUFF_CEILING ? aggressorSeat : NO_SEAT;
}

/**
 * Who was in front at the turn and lost anyway.
 *
 * Re-evaluates every showdown hand against the first four board cards and
 * compares the winner there to the winner on the river. A seat is "rivered"
 * when it was the sole best hand at the turn and did not win the hand.
 *
 * Sole best on purpose: a player who was chopping at the turn and lost on the
 * river got no worse than they were promised, and calling that a suckout
 * cheapens the caption for the times it really happened.
 *
 * Only runs on a board that reached five cards. Everything it reads is a card
 * that is about to be published in `reveals`.
 */
function riveredSeats(state: HandState): Set<number> {
  const out = new Set<number>();
  const result = state.result;
  if (!result || result.showdown.length < 2) return out;
  if (state.board.length !== RIVER_BOARD) return out;

  const turnBoard = state.board.slice(0, TURN_BOARD);
  let bestScore = -1;
  let bestSeats: number[] = [];
  for (const entry of result.showdown) {
    const value = evaluate([...entry.hole, ...turnBoard] as Card[]);
    if (value.score > bestScore) {
      bestScore = value.score;
      bestSeats = [entry.seat];
    } else if (value.score === bestScore) {
      bestSeats.push(entry.seat);
    }
  }
  if (bestSeats.length !== 1) return out;

  const leader = bestSeats[0]!;
  const wonAtRiver = new Set(
    result.awards.filter((a) => a.amount > 0).map((a) => a.seat),
  );
  if (!wonAtRiver.has(leader)) out.add(leader);
  return out;
}
