import {
  MAX_STACK,
  maxBuyIn,
  minBuyIn,
  type BuyInContext,
} from "@facecards/shared";

/**
 * Whether a seat may put more chips behind it, and when they land.
 *
 * Pure, and separate from the room, because "how much may this player buy in
 * for" is a rule and rules are testable without a socket. The room decides
 * *that* someone asked; this decides whether the answer is yes.
 *
 * The bounds themselves live in `shared/src/buyIn.ts`, because the client
 * needs the same numbers to draw a control that cannot aim at an illegal
 * amount. What is deliberately *not* shared is this function: the client's
 * arithmetic is a courtesy to the player, and the server re-derives every part
 * of it from its own state rather than reading anything the client sent but
 * the amount.
 *
 * The one rule that is not about numbers is the important one: **table
 * stakes**. You play a hand with the chips that were in front of you when it
 * was dealt. Chips bought while a hand is running are real, and they are
 * accepted, but they sit to one side until the hand is over - otherwise a
 * player about to be called for their whole stack could reach into their
 * pocket and cover the bet after seeing the action, which is the oldest way
 * there is to cheat at poker.
 */

export interface BuyInRequest extends BuyInContext {
  /** Is this seat contesting the hand that is running right now? */
  inHand: boolean;
}

export type BuyInDecision =
  | {
      ok: true;
      amount: number;
      /**
       * False when the seat is in a live hand, in which case the chips are
       * held and applied before the next deal.
       */
      immediate: boolean;
    }
  | { ok: false; reason: string };

export function decideBuyIn(
  amount: unknown,
  context: BuyInRequest,
): BuyInDecision {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    return { ok: false, reason: "buy-in needs an amount" };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: "buy-in must be a whole number of chips" };
  }

  const min = minBuyIn(context);
  const max = maxBuyIn(context);

  if (max === 0) {
    return {
      ok: false,
      reason: `a seat cannot hold more than ${MAX_STACK} chips`,
    };
  }
  if (amount < min) return { ok: false, reason: `the minimum buy-in is ${min}` };
  if (amount > max) {
    return { ok: false, reason: `the most you can add right now is ${max}` };
  }

  return { ok: true, amount, immediate: !context.inHand };
}
