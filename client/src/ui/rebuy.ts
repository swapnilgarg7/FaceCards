import { DEFAULT_BUY_IN, maxBuyIn, minBuyIn } from "@facecards/shared";
import type { SeatSnapshot } from "../net/useRoom.js";

/**
 * The offer to buy back in, made at the one moment it is actually wanted.
 *
 * Busting is the most fragile thirty seconds a player has at this table. The
 * hand they just lost is on screen, everybody is talking about it, and the
 * question in front of them - *am I still in this?* - had its answer buried in
 * a leaderboard panel they would have to go and open. Meanwhile the table can
 * deal on without them, because a seat with no chips is not one the next hand
 * waits for. That is the shape of somebody quietly leaving a poker night.
 *
 * So the answer is put in front of them, on the results screen, next to Next
 * round: one press to be back in the next hand, or ignore it and watch. It is
 * never a wall - the table is not held up for this decision, and the button
 * beside it still deals the next hand.
 *
 * **One press, not a form.** The full slider and typed amount still live in
 * the leaderboard for a player who wants an exact number; this is three
 * amounts a losing player might actually want and no steps in between,
 * because a rebuy is a round number far more often than it is not, and a seat
 * that has to build its number out of drags is a seat that stops bothering.
 *
 * Every amount here is one the server would accept: the bounds come from
 * `shared/src/buyIn.ts`, the same module the server checks against. Pure, so
 * every roster this can be offered to is testable without a DOM.
 */

export interface RebuyOffer {
  /** Render it at all. */
  show: boolean;
  /** Nothing behind the seat, and the table is about to deal without them. */
  busted: boolean;
  /** Chips already bought, arriving at the next deal. */
  pending: number;
  /** One-press amounts, ascending and distinct. Empty once they have bought. */
  presets: number[];
}

const HIDDEN: RebuyOffer = {
  show: false,
  busted: false,
  pending: 0,
  presets: [],
};

/**
 * What to offer this seat on the results screen.
 *
 * Only two states earn the space. A seat that busted is asked; a seat that has
 * already bought is *told*, because the one thing worse than not offering the
 * rebuy is offering it again to somebody who just took it and leaving them
 * unsure whether it registered. Everybody else - anyone still holding chips -
 * gets nothing here and uses the leaderboard, which is where topping up a live
 * stack has always belonged.
 */
export function rebuyOffer(me: SeatSnapshot | undefined): RebuyOffer {
  if (!me) return HIDDEN;

  const context = { stack: me.stack, pending: me.pendingBuyIn };

  if (me.pendingBuyIn > 0) {
    return { show: true, busted: me.stack === 0, pending: me.pendingBuyIn, presets: [] };
  }
  if (me.stack > 0) return HIDDEN;

  const min = minBuyIn(context);
  const max = maxBuyIn(context);
  // A table maximum that leaves no room is not an offer, and a button that
  // cannot succeed is the one thing this codebase never renders.
  if (max < min) return HIDDEN;

  return { show: true, busted: true, pending: 0, presets: presetsFor(min, max) };
}

/**
 * Minimum, the default stack, maximum - deduped and dropped when out of range.
 *
 * The middle one is `DEFAULT_BUY_IN` rather than something derived from the
 * table, because it is the stack everybody started the evening on: "same
 * again" is the thought a player who just busted actually has, and it needs
 * to be one press rather than a number they have to reconstruct.
 */
function presetsFor(min: number, max: number): number[] {
  const wanted = [min, DEFAULT_BUY_IN, max].filter(
    (amount) => amount >= min && amount <= max,
  );
  return [...new Set(wanted)].sort((a, b) => a - b);
}
