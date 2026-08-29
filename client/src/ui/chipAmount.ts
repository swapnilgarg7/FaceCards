/**
 * Typing a chip amount, and what is wrong with it when something is.
 *
 * Two controls in the product ask a player for a number of chips - the raise
 * field on the action bar and the buy-in field on the standings panel - and
 * both of them face the same problem: a slider cannot land on the exact amount
 * somebody has in mind, and a keyboard can land on an amount that is not
 * legal. So the field takes anything, and this module decides what it means.
 *
 * The bounds are always the server's. `minRaiseTo` and `maxRaiseTo` come down
 * in the snapshot and `minBuyIn`/`maxBuyIn` are the same shared functions the
 * server checks against, so nothing here is a second opinion about a rule: it
 * is the same answer, said early, so that a player is told "you cannot raise
 * to 102, the smallest raise is to 200" while they are still typing rather
 * than after the server has bounced it. The server still re-derives all of it
 * when the intent arrives, exactly as it does for the buttons.
 *
 * Pure, and no React import, so every wording and every edge of the range can
 * be tested without a DOM.
 */

export interface AmountBounds {
  /** Smallest legal amount. */
  min: number;
  /** Largest legal amount. */
  max: number;
}

/**
 * Why a typed amount cannot be sent.
 *
 * A code rather than a sentence, because the raise field and the buy-in field
 * describe the same problem in different words: "the smallest raise is to 200"
 * and "the smallest buy-in is 200" are the same fact about different things.
 */
export type AmountProblem =
  | "empty"
  | "not-a-number"
  | "fractional"
  | "below-min"
  | "above-max";

export interface ParsedAmount {
  /**
   * The number the player typed, if they typed one at all.
   *
   * Present even when the amount is illegal - a value that is merely too small
   * is still a value, and the slider next to the field has to stay somewhere
   * sensible while it is being corrected.
   */
  value: number | null;
  /** Null when the amount is legal and ready to send. */
  problem: AmountProblem | null;
}

/** Digits, and the separators a person types without thinking about them. */
const NUMERIC = /^\d+(\.\d+)?$/;

/**
 * What a typed amount means against the bounds the server published.
 *
 * Order matters: a fraction is reported as a fraction rather than as being out
 * of range, because "whole chips only" is the useful thing to say about 102.5
 * even when 102.5 is also below the minimum.
 */
export function parseChipAmount(
  text: string,
  bounds: AmountBounds,
): ParsedAmount {
  const cleaned = text.replace(/[\s,_]/g, "");
  if (cleaned === "") return { value: null, problem: "empty" };
  if (!NUMERIC.test(cleaned)) return { value: null, problem: "not-a-number" };

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { value: null, problem: "not-a-number" };
  // Chips are indivisible, and the server refuses a raise that is not a whole
  // number of them before it looks at the range at all.
  if (!Number.isInteger(value)) {
    return { value: Math.floor(value), problem: "fractional" };
  }
  if (value < bounds.min) return { value, problem: "below-min" };
  if (value > bounds.max) return { value, problem: "above-max" };
  return { value, problem: null };
}

/** Hold a value inside the bounds. Used by the sizing keys and the slider. */
export function clampChips(value: number, bounds: AmountBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

/** Every chip count a player reads, grouped the same way. */
export function formatChips(value: number): string {
  return value.toLocaleString();
}

/**
 * What is wrong with a typed raise, in the words the table uses.
 *
 * `increment` is the size of the last raise - `minRaiseTo - currentBet` - and
 * it is named in the message because "you cannot raise to 102" is confusing
 * until you are told that the raise before yours was 100.
 */
export function raiseProblemText(
  problem: AmountProblem,
  bounds: AmountBounds,
  increment = 0,
): string {
  const min = formatChips(bounds.min);
  const max = formatChips(bounds.max);
  switch (problem) {
    case "empty":
      return `Type an amount between ${min} and ${max}.`;
    case "not-a-number":
    case "fractional":
      return `Whole chips only, between ${min} and ${max}.`;
    case "below-min":
      return increment > 0
        ? `The last raise was ${formatChips(increment)}, so the smallest raise is to ${min}.`
        : `The smallest raise is to ${min}.`;
    case "above-max":
      return `You have ${max} behind, so that is the most you can raise to.`;
  }
}

/** What is wrong with a typed buy-in, in the words the standings panel uses. */
export function buyInProblemText(
  problem: AmountProblem,
  bounds: AmountBounds,
): string {
  const min = formatChips(bounds.min);
  const max = formatChips(bounds.max);
  switch (problem) {
    case "empty":
      return `Type an amount between ${min} and ${max}.`;
    case "not-a-number":
    case "fractional":
      return `Whole chips only, between ${min} and ${max}.`;
    case "below-min":
      return `The smallest buy-in from here is ${min}.`;
    case "above-max":
      return `The most you can add right now is ${max}.`;
  }
}
