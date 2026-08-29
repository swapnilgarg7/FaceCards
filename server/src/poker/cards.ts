/**
 * Card representation.
 *
 * A card is a single integer 0..51, packed as `rank * 4 + suit`. Ranks run
 * 0..12 for deuce..ace, suits 0..3 for clubs, diamonds, hearts, spades.
 *
 * The integer form is what the evaluator sorts and compares; the string form
 * ("As", "Td", "2c") is what tests read and what crosses the wire. Nothing in
 * this directory does I/O, so both forms are pure functions of each other.
 */

/** A card, 0..51. */
export type Card = number;

/** Index order matches the numeric rank: 0 is a deuce, 12 is an ace. */
export const RANKS = "23456789TJQKA" as const;
/** Index order matches the numeric suit. */
export const SUITS = "cdhs" as const;

export const DECK_SIZE = 52;

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

/** True for a value that is actually a card and not just a number. */
export function isCard(value: unknown): value is Card {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < DECK_SIZE
  );
}

export function cardToString(card: Card): string {
  if (!isCard(card)) throw new RangeError(`not a card: ${String(card)}`);
  return `${RANKS[rankOf(card)]}${SUITS[suitOf(card)]}`;
}

/**
 * Parse "As" / "td" / "2C". Throws rather than returning a sentinel: a
 * mis-parsed card that silently becomes a deuce is the kind of bug that only
 * shows up as a wrong winner three hands later.
 */
export function cardFromString(text: string): Card {
  if (typeof text !== "string" || text.length !== 2) {
    throw new RangeError(`not a card string: ${String(text)}`);
  }
  const rank = RANKS.indexOf(text[0]!.toUpperCase());
  const suit = SUITS.indexOf(text[1]!.toLowerCase());
  if (rank < 0 || suit < 0) throw new RangeError(`not a card string: ${text}`);
  return makeCard(rank, suit);
}

export function cardsToStrings(cards: readonly Card[]): string[] {
  return cards.map(cardToString);
}

export function cardsFromString(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(cardFromString);
}

/** A fresh ordered deck. Ordered, not shuffled: shuffling is a separate step. */
export function makeDeck(): Card[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i);
}

/** Long rank name, for the plural forms a showdown description needs. */
export const RANK_NAMES = [
  "Deuce", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Jack", "Queen", "King", "Ace",
] as const;

export const RANK_NAMES_PLURAL = [
  "Deuces", "Threes", "Fours", "Fives", "Sixes", "Sevens", "Eights",
  "Nines", "Tens", "Jacks", "Queens", "Kings", "Aces",
] as const;
