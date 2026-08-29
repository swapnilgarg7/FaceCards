/**
 * Deterministic motion: easing, arcs, and a schedule of when each card leaves
 * the dealer's hand.
 *
 * Pure arithmetic and no three.js import, so the shapes that decide how a deal
 * *reads* can be unit-tested without a renderer, exactly as `layout.ts` and
 * `body.ts` are.
 *
 * Deterministic is the word that matters. `damp` in `damp.ts` is the right
 * tool for a thing chasing a target that keeps moving - a head following a
 * cursor, a chip following a pot that is still growing - because it has no end
 * time and never overshoots. It is the wrong tool for a deal, because two
 * clients that started their frame loops a few milliseconds apart would draw
 * two different arcs and land at two different moments. A tween with a stated
 * start, end and duration draws the same motion on every machine, which is
 * what the phase-4 brief asks for.
 *
 * Everything below is a function of `t` in 0..1. Nothing here holds state.
 */

/** Clamp to 0..1. Progress past the end of a tween is not motion. */
export function progress(elapsed: number, duration: number): number {
  if (duration <= 0) return 1;
  return Math.min(1, Math.max(0, elapsed / duration));
}

/**
 * Slow in, slow out. The standard cubic, which is what a hand that starts at
 * rest and stops at rest actually does.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Fast out, slow in. For a card that has been *flicked*: all its speed is
 * spent at the start and it coasts into place.
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Overshoots slightly and settles back. A chip landing on a stack. */
export function easeOutBack(t: number, overshoot = 1.35): number {
  const c = overshoot + 1;
  const u = t - 1;
  return 1 + c * u * u * u + overshoot * u * u;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Position along a card's flight: a straight line in the plane of the table,
 * plus a parabola of height `lift` on top of it.
 *
 * A parabola rather than a circular arc because a card skimmed across felt
 * leaves and lands flat, and `4t(1-t)` is zero with a non-zero slope at both
 * ends. A circular arc arrives vertically, which reads as a card being lowered
 * by a crane.
 */
export function arc(from: Vec3, to: Vec3, lift: number, t: number): Vec3 {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t + lift * 4 * t * (1 - t),
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * Milliseconds between two cards of a deal, and between two cards of a flop.
 *
 * They live here rather than in the component that animates them because the
 * *sound* has to land with the card. `audio/cues.ts` schedules a deal click per
 * card off these same two numbers, and a card that arrives 90ms after its own
 * click is worse than no click at all.
 */
export const DEAL_STEP_MS = 92;
export const FLOP_STEP_MS = 115;

/** One card's place in the deal: which seat, which of its cards, and when. */
export interface DealStep {
  /** Index into the ring returned by `seatLayout`. */
  slot: number;
  /** 0 or 1: first card round or second. */
  cardIndex: number;
  /** Milliseconds after the deal begins that this card leaves the deck. */
  delayMs: number;
}

/**
 * The order a dealer actually deals in: one card to every live seat starting
 * left of the button, then round again for the second.
 *
 * Two rounds rather than two cards per player is not a detail. Dealing both of
 * someone's cards before moving on is how a machine deals; going round twice
 * is how the game is dealt, and it is the difference between the animation
 * reading as a dealer and reading as a loop.
 *
 * `slots` is expected in ring order and `buttonSlot` is where the button sits
 * in that ring, so the first card goes to `buttonSlot + 1`. A button outside
 * the ring (before the first hand) deals from slot 0, which is a legible
 * fallback rather than a crash.
 */
export function dealSchedule(
  slots: readonly number[],
  buttonSlot: number,
  stepMs: number,
  cardsPerPlayer = 2,
): DealStep[] {
  if (slots.length === 0) return [];

  const start = slots.includes(buttonSlot)
    ? (slots.indexOf(buttonSlot) + 1) % slots.length
    : 0;

  const steps: DealStep[] = [];
  let n = 0;
  for (let cardIndex = 0; cardIndex < cardsPerPlayer; cardIndex++) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[(start + i) % slots.length];
      if (slot === undefined) continue;
      steps.push({ slot, cardIndex, delayMs: n * stepMs });
      n++;
    }
  }
  return steps;
}

/**
 * A small, stable pseudo-random number in 0..1 for an integer key.
 *
 * Chips are not laid perfectly square and cards are not squared to the felt,
 * and a scene where every one of them is reads as a spreadsheet. This gives
 * each instance its own tilt without storing one: the same index yields the
 * same value on every client and every frame, so nothing jitters and nothing
 * has to be persisted.
 *
 * Integer hash rather than `Math.random()` precisely because it is repeatable.
 */
export function jitter(seed: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** `jitter` remapped to -amount..+amount. */
export function jitterSigned(seed: number, amount: number): number {
  return (jitter(seed) * 2 - 1) * amount;
}
