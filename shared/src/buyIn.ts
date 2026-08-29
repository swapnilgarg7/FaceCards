import { MAX_BUY_IN, MAX_STACK, MIN_BUY_IN } from "./constants.js";

/**
 * How much a seat may add to its stack.
 *
 * The *bounds* are shared because both ends need the same answer to the same
 * question, for different reasons: the server to refuse anything outside them,
 * the client so the control it draws cannot aim at a number that would be
 * refused. A rejected buy-in is a worse experience than a slider that stops in
 * the right place.
 *
 * The *decision* is not shared. `server/src/rooms/buyIn.ts` owns whether a
 * request is accepted and when the chips land, and it re-derives everything
 * here rather than trusting a client that did the arithmetic itself. Sharing
 * the shape of a rule is not the same as sharing who enforces it.
 */

export interface BuyInContext {
  /** Chips currently behind the seat. */
  stack: number;
  /** Chips already bought and waiting for the hand in progress to end. */
  pending: number;
}

/**
 * The largest top-up this seat could legally ask for, or 0 if none.
 *
 * Bounded by both the per-buy-in cap and the room a seat has left under the
 * stack ceiling, so a winning player cannot keep reloading to stay the biggest
 * stack at the table.
 */
export function maxBuyIn(context: BuyInContext): number {
  const behind = context.stack + context.pending;
  return Math.max(0, Math.min(MAX_BUY_IN, MAX_STACK - behind));
}

/**
 * The smallest top-up this seat could legally ask for.
 *
 * A seat with nothing left is re-staking and owes the full minimum, because a
 * stack too short to raise with is not really back in the game. A seat that is
 * merely short is topping up and may add any whole chip it likes.
 */
export function minBuyIn(context: BuyInContext): number {
  return context.stack + context.pending === 0 ? MIN_BUY_IN : 1;
}
