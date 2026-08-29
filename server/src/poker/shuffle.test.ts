import { describe, expect, it } from "vitest";
import { secureRandomInt } from "../rng.js";
import { DECK_SIZE, makeDeck } from "./cards.js";
import { shuffled, type RandomInt } from "./shuffle.js";

/** Deterministic stand-in for the CSPRNG. */
function seededRandomInt(seed: number): RandomInt {
  let state = seed >>> 0;
  return (maxExclusive) => {
    // xorshift32: not cryptographic, which is exactly why it is only ever
    // used here and never wired into a room.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % maxExclusive;
  };
}

describe("shuffled", () => {
  it("keeps every card exactly once", () => {
    const deck = shuffled(makeDeck(), seededRandomInt(1));
    expect(deck).toHaveLength(DECK_SIZE);
    expect(new Set(deck).size).toBe(DECK_SIZE);
  });

  it("does not mutate its input", () => {
    const original = makeDeck();
    const copy = original.slice();
    shuffled(original, seededRandomInt(7));
    expect(original).toEqual(copy);
  });

  it("is a function of the generator, so a hand can be replayed in a test", () => {
    expect(shuffled(makeDeck(), seededRandomInt(42))).toEqual(
      shuffled(makeDeck(), seededRandomInt(42)),
    );
    expect(shuffled(makeDeck(), seededRandomInt(42))).not.toEqual(
      shuffled(makeDeck(), seededRandomInt(43)),
    );
  });

  it("rejects a generator that returns out of range", () => {
    expect(() => shuffled(makeDeck(), () => 999)).toThrow(/out of range/);
    expect(() => shuffled(makeDeck(), () => -1)).toThrow(/out of range/);
  });

  it("leaves a one-card and an empty list alone", () => {
    expect(shuffled([], seededRandomInt(1))).toEqual([]);
    expect(shuffled([5], seededRandomInt(1))).toEqual([5]);
  });
});

describe("the real generator", () => {
  it("stays in range and covers the range", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = secureRandomInt(52);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(52);
      seen.add(value);
    }
    expect(seen.size).toBe(52);
  });

  it("does not put a card back in its starting position too often", () => {
    // A Fisher-Yates over 52 cards leaves roughly one card in place per
    // shuffle. A broken shuffle (or a no-op generator) leaves dozens.
    let fixedPoints = 0;
    const rounds = 200;
    for (let i = 0; i < rounds; i++) {
      const deck = shuffled(makeDeck(), secureRandomInt);
      for (let j = 0; j < DECK_SIZE; j++) if (deck[j] === j) fixedPoints++;
    }
    expect(fixedPoints).toBeLessThan(rounds * 4);
  });
});
