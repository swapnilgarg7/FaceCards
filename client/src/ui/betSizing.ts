import { DENOMINATIONS, type Denomination } from "../scene/chips.js";

/**
 * The sizes a player actually reaches for, and the chips they build them from.
 *
 * Every poker client that people enjoy sizing bets in offers the same three
 * ways in, and this module is the first two of them:
 *
 * - **Pot fractions.** "Half pot" is how the bet is thought about at the
 *   table; 137 is only ever the answer, never the question. One press has to
 *   land it, because the alternative is arithmetic in the head of somebody on
 *   a thirty-second clock.
 * - **Chips.** Five hundreds is a bet you can *count out* rather than compute,
 *   which is the whole reason a real table has denominations at all. Tapping
 *   the same four colours that are already piled on the felt is the shortest
 *   path there is on a phone, and it needs no keyboard.
 *
 * The third way is the field, which is `chipAmount.ts` and was already there.
 *
 * Pure, and no React or three.js import, so every size can be checked against
 * whatever the server might say without a DOM. Nothing here decides what is
 * *legal*: `minRaiseTo` and `maxRaiseTo` are the server's, every amount is
 * clamped into them, and the server re-derives all of it when the intent
 * arrives - exactly as it does for the buttons.
 */

/** What the sizes are computed from. A `RoomSnapshot` satisfies it. */
export interface SizingInput {
  /** Everything committed this hand, this street's bets included. */
  pot: number;
  /** The amount to match this round. Zero when nobody has bet yet. */
  currentBet: number;
  /** What calling costs this seat right now. */
  callAmount: number;
  bigBlind: number;
  minRaiseTo: number;
  maxRaiseTo: number;
}

/** One press, one size. */
export interface SizingPreset {
  /** Stable across renders and used to pick the key chip. */
  id: string;
  /** What the player is choosing, in the words a card room uses. */
  label: string;
  /** Raise-to, already inside the server's bounds. */
  amount: number;
}

/**
 * The fractions offered, smallest first.
 *
 * Three, not six. Every extra pill is another thing to read on a clock, and
 * half / three-quarter / pot is the spread that actually gets used - anything
 * between two of them is a slider drag or a typed number away.
 */
export const POT_FRACTIONS = [
  { id: "half", label: "½ Pot", of: 0.5 },
  { id: "threeQuarter", label: "¾ Pot", of: 0.75 },
  { id: "pot", label: "Pot", of: 1 },
] as const;

/**
 * Raise-to for a bet of `fraction` of the pot.
 *
 * The pot a bet is measured against is the pot *after the call*, which is the
 * definition every card room uses and the only one that makes "pot" mean what
 * a player expects: call the 10 first, then bet what is out there. Preflop
 * heads-up at 10/20 that makes a pot raise 60, which is the number a player
 * would have got with a pencil.
 */
export function potRaiseTo(input: SizingInput, fraction: number): number {
  const potAfterCall = input.pot + input.callAmount;
  return holdInBounds(
    input,
    Math.round(input.currentBet + fraction * potAfterCall),
  );
}

/**
 * Every one-press size for this decision, cheapest first, ending at all-in.
 *
 * A fraction that clamps onto the minimum or onto all-in is dropped rather
 * than drawn twice: preflop a half-pot raise usually *is* the minimum, and two
 * adjacent buttons that send the identical amount are two buttons a player has
 * to compare before pressing either.
 */
export function sizingPresets(input: SizingInput): SizingPreset[] {
  const { minRaiseTo: min, maxRaiseTo: max } = input;
  if (max < min) return [];
  // The only raise available is the whole stack, so there is one thing to say
  // about it and "Min" is not it.
  if (max === min) return [{ id: "allIn", label: "All in", amount: max }];

  const presets: SizingPreset[] = [{ id: "min", label: "Min", amount: min }];
  const seen = new Set<number>([min, max]);

  for (const fraction of POT_FRACTIONS) {
    const amount = potRaiseTo(input, fraction.of);
    if (seen.has(amount)) continue;
    seen.add(amount);
    presets.push({ id: fraction.id, label: fraction.label, amount });
  }

  presets.push({ id: "allIn", label: "All in", amount: max });
  return presets;
}

/**
 * The 1 chip is change, never a chip you push forward.
 *
 * `scene/chips.ts` keeps it for the odd chip of a split pot and refuses to
 * build a pile from it, and a tray is a pile: a tray with a 1 in it invites
 * somebody to tap it forty times.
 */
export const TRAY_MIN_DENOMINATION = 5;

/**
 * The chips laid out in front of the player, smallest first.
 *
 * The same denominations and the same colours that are already stacked on the
 * felt, because a tray whose chips are not the table's chips is a second
 * currency to learn. Denominations bigger than the stack are left out: a chip
 * that can only ever mean all-in is a chip that lies about what it adds.
 */
export function trayChips(maxRaiseTo: number): Denomination[] {
  const fits = DENOMINATIONS.filter(
    (denom) => denom >= TRAY_MIN_DENOMINATION && denom <= maxRaiseTo,
  );
  // DENOMINATIONS is largest first, and a tray reads the other way round.
  return fits.reverse();
}

/**
 * The amount after a chip is added to it.
 *
 * Capped at all-in, because past that the chip is not worth what it says. Not
 * held *up* to the minimum, which is the point: a player who cleared the field
 * to count out five hundreds passes through 100, 200, 300 on the way, and a
 * floor would silently turn the first tap into a min-raise and the count into
 * nonsense. Below the minimum the field simply says so and the raise stays
 * dead, which is what it already does for a typed amount.
 */
export function withChip(
  amount: number,
  denom: number,
  maxRaiseTo: number,
): number {
  const from = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return Math.min(maxRaiseTo, from + denom);
}

/**
 * The slider's detents.
 *
 * A raise-to is thought about in big blinds, so that is what the drag lands
 * on - one press of the arrow key and one pixel of drag mean the same size,
 * and the handle stops where a bet would be announced rather than on 1,337.
 * Both ends stay reachable: rounding can only ever push a value past a bound,
 * and the clamp brings it back.
 */
export function snapChips(value: number, input: SizingInput): number {
  const step = Math.max(1, input.bigBlind);
  return holdInBounds(input, Math.round(value / step) * step);
}

function holdInBounds(input: SizingInput, value: number): number {
  return Math.min(input.maxRaiseTo, Math.max(input.minRaiseTo, value));
}

/** A denomination as it is printed on the chip: "500", "1K", "2.5K". */
export function chipFace(denom: number): string {
  if (denom < 1000) return String(denom);
  const thousands = denom / 1000;
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
}
