/**
 * Hand evaluation: the best five-card hand out of seven, as a single
 * comparable integer.
 *
 * Why hand-rolled rather than `poker-evaluator` (which the tech-decisions doc
 * originally pinned): that package ships a 130 MB Two-Plus-Two lookup table
 * and `readFileSync`s all of it at import time. That is an I/O import inside
 * `poker/`, which this project forbids, and 130 MB resident on a 512 MB free
 * tier buys nothing at this workload. A showdown is at most 21 combinations
 * times six players, roughly a hundred evaluations a few times a minute. The
 * O(1) advantage is real and irrelevant here; auditability is not.
 *
 * Scoring: the category in the high digit, then exactly five kicker ranks
 * packed into nibbles, most significant first. Fixed width means two scores
 * compare with `<` regardless of category, and within a category the kickers
 * break ties in the order poker actually reads them.
 */
import {
  RANK_NAMES,
  RANK_NAMES_PLURAL,
  rankOf,
  suitOf,
  type Card,
} from "./cards.js";

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  ThreeOfAKind: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  FourOfAKind: 7,
  StraightFlush: 8,
} as const;

export type HandCategoryValue =
  (typeof HandCategory)[keyof typeof HandCategory];

export interface HandValue {
  /** Higher is better. Comparable across categories. */
  score: number;
  category: HandCategoryValue;
  /** The five cards that made the score, ordered by how the hand reads. */
  cards: Card[];
}

/** Packs a category plus its kickers into one comparable integer. */
function pack(category: HandCategoryValue, kickers: readonly number[]): number {
  if (kickers.length > 5) throw new RangeError("at most five kickers");
  let score: number = category;
  for (let i = 0; i < 5; i++) {
    // Fixed five slots, zero-padded. A padding zero is only ever compared
    // against another padding zero, because the number of meaningful kickers
    // is fixed by the category and scores are only tie-broken within one.
    score = score * 16 + (kickers[i] ?? 0);
  }
  return score;
}

/**
 * Highest card of a straight in `ranks` (descending, distinct), or -1.
 * A-2-3-4-5 is a straight to the five: the one place an ace plays low.
 */
function straightHigh(ranks: readonly number[]): number {
  for (let i = 0; i + 4 < ranks.length; i++) {
    if (ranks[i]! - ranks[i + 4]! === 4) return ranks[i]!;
  }
  const wheel = [12, 3, 2, 1, 0];
  if (wheel.every((r) => ranks.includes(r))) return 3;
  return -1;
}

/** Score exactly five cards. Exported so the ranking table can be tested directly. */
export function evaluate5(cards: readonly Card[]): number {
  if (cards.length !== 5) throw new RangeError("evaluate5 needs five cards");

  const counts = new Array<number>(13).fill(0);
  const suitCounts = new Array<number>(4).fill(0);
  for (const card of cards) {
    counts[rankOf(card)]!++;
    suitCounts[suitOf(card)]!++;
  }

  const isFlush = suitCounts.some((n) => n === 5);
  const distinct: number[] = [];
  for (let r = 12; r >= 0; r--) if (counts[r]! > 0) distinct.push(r);

  const high = straightHigh(distinct);

  if (isFlush && high >= 0) return pack(HandCategory.StraightFlush, [high]);

  // Rank groups ordered by count first, then by rank. That single ordering
  // produces the correct kicker sequence for every paired category, which is
  // why there is no per-category kicker assembly below.
  const grouped = distinct
    .slice()
    .sort((a, b) => counts[b]! - counts[a]! || b - a);

  const topCount = counts[grouped[0]!]!;
  const secondCount = grouped.length > 1 ? counts[grouped[1]!]! : 0;

  if (topCount === 4) {
    return pack(HandCategory.FourOfAKind, [grouped[0]!, grouped[1]!]);
  }
  if (topCount === 3 && secondCount === 2) {
    return pack(HandCategory.FullHouse, [grouped[0]!, grouped[1]!]);
  }
  if (isFlush) return pack(HandCategory.Flush, distinct);
  if (high >= 0) return pack(HandCategory.Straight, [high]);
  if (topCount === 3) {
    return pack(HandCategory.ThreeOfAKind, grouped.slice(0, 3));
  }
  if (topCount === 2 && secondCount === 2) {
    return pack(HandCategory.TwoPair, grouped.slice(0, 3));
  }
  if (topCount === 2) return pack(HandCategory.Pair, grouped.slice(0, 4));
  return pack(HandCategory.HighCard, distinct);
}

export function categoryOf(score: number): HandCategoryValue {
  return Math.floor(score / 16 ** 5) as HandCategoryValue;
}

/** The five packed kicker ranks, most significant first. */
export function kickersOf(score: number): number[] {
  const out: number[] = [];
  for (let i = 4; i >= 0; i--) out.push(Math.floor(score / 16 ** i) % 16);
  return out;
}

/** All 21 five-card subsets of seven, built once at module load. */
const COMBOS_7_CHOOSE_5: readonly (readonly number[])[] = (() => {
  const combos: number[][] = [];
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 4; b++)
      for (let c = b + 1; c < 5; c++)
        for (let d = c + 1; d < 6; d++)
          for (let e = d + 1; e < 7; e++) combos.push([a, b, c, d, e]);
  return combos;
})();

/**
 * Best five-card hand from five, six or seven cards.
 *
 * Exhaustive subsets rather than a bit-twiddled seven-card evaluator, for the
 * same reason the betting logic is hand-rolled: the cost is invisible at this
 * scale, and this version is readable by someone auditing a disputed pot.
 */
export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError(`evaluate needs 5 to 7 cards, got ${cards.length}`);
  }
  if (new Set(cards).size !== cards.length) {
    throw new RangeError("duplicate card in evaluate");
  }

  if (cards.length === 5) {
    const score = evaluate5(cards);
    return {
      score,
      category: categoryOf(score),
      cards: orderForDisplay(cards, score),
    };
  }

  const combos =
    cards.length === 7
      ? COMBOS_7_CHOOSE_5
      : COMBOS_7_CHOOSE_5.filter((combo) => combo.every((i) => i < 6));

  let bestScore = -1;
  let bestCards: Card[] = [];
  const hand = new Array<Card>(5);
  for (const combo of combos) {
    for (let i = 0; i < 5; i++) hand[i] = cards[combo[i]!]!;
    const score = evaluate5(hand);
    if (score > bestScore) {
      bestScore = score;
      bestCards = hand.slice();
    }
  }
  return {
    score: bestScore,
    category: categoryOf(bestScore),
    cards: orderForDisplay(bestCards, bestScore),
  };
}

/** Sort the winning five so the cards that named the hand come first. */
function orderForDisplay(cards: readonly Card[], score: number): Card[] {
  const order = kickersOf(score);
  const place = (card: Card) => {
    const i = order.indexOf(rankOf(card));
    return i < 0 ? order.length : i;
  };
  return cards.slice().sort((a, b) => place(a) - place(b) || rankOf(b) - rankOf(a));
}

/** "Full House, Kings full of Threes". Shown only at a real showdown. */
export function describeHand(value: HandValue): string {
  const k = kickersOf(value.score);
  const one = (i: number) => RANK_NAMES[k[i]!] ?? "?";
  const many = (i: number) => RANK_NAMES_PLURAL[k[i]!] ?? "?";

  switch (value.category) {
    case HandCategory.StraightFlush:
      return k[0] === 12 ? "Royal Flush" : `Straight Flush, ${one(0)} high`;
    case HandCategory.FourOfAKind:
      return `Four of a Kind, ${many(0)}`;
    case HandCategory.FullHouse:
      return `Full House, ${many(0)} full of ${many(1)}`;
    case HandCategory.Flush:
      return `Flush, ${one(0)} high`;
    case HandCategory.Straight:
      return `Straight, ${one(0)} high`;
    case HandCategory.ThreeOfAKind:
      return `Three of a Kind, ${many(0)}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${many(0)} and ${many(1)}`;
    case HandCategory.Pair:
      return `Pair of ${many(0)}`;
    default:
      return `High Card, ${one(0)}`;
  }
}
