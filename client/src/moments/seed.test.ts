import { describe, expect, it } from "vitest";
import { momentSeed, seededRandom } from "./seed.js";
import { NO_CAPTIONS, pickCaption, type CaptionMemory } from "./captions.js";

/**
 * The property this whole module exists for: two browsers that share a room
 * code and a hand number produce the same words and the same treatment,
 * without exchanging a single byte about it.
 */

describe("momentSeed", () => {
  it("is the same on every client for the same hand", () => {
    expect(momentSeed("ABCDEF", 7)).toBe(momentSeed("ABCDEF", 7));
  });

  it("moves for the next hand", () => {
    expect(momentSeed("ABCDEF", 7)).not.toBe(momentSeed("ABCDEF", 8));
  });

  it("moves for another table playing the same hand", () => {
    expect(momentSeed("ABCDEF", 7)).not.toBe(momentSeed("QRSTVW", 7));
  });

  it("does not put consecutive hands next to each other", () => {
    // A seed that merely counts up produces generators whose first draw also
    // counts up, which is how you get the same treatment four hands running.
    const first = [1, 2, 3, 4, 5, 6].map(
      (hand) => seededRandom(momentSeed("ABCDEF", hand))(),
    );
    expect(new Set(first.map((v) => Math.floor(v * 6))).size).toBeGreaterThan(2);
  });

  it("is a whole number in unsigned 32-bit range", () => {
    for (const hand of [0, 1, 999, 100_000]) {
      const seed = momentSeed("ZZZZZZ", hand);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe("seededRandom", () => {
  it("replays exactly", () => {
    const a = seededRandom(12345);
    const b = seededRandom(12345);
    const left = Array.from({ length: 50 }, a);
    const right = Array.from({ length: 50 }, b);
    expect(left).toEqual(right);
  });

  it("stays inside the range every caller assumes", () => {
    const next = seededRandom(momentSeed("ABCDEF", 3));
    for (let i = 0; i < 5000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is spread out enough to choose between six things", () => {
    const next = seededRandom(99);
    const buckets = new Array(6).fill(0);
    for (let i = 0; i < 6000; i++) buckets[Math.floor(next() * 6)]! += 1;
    // Nothing rigorous - just that no bucket is starved or hogged, which is
    // what a bad mix would show as.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(700);
      expect(count).toBeLessThan(1300);
    }
  });
});

describe("two clients at one table", () => {
  it("write the same captions, given the same history", () => {
    // The end-to-end property. Two independent "browsers" walk the same hands
    // with their own memories, and must land on the same words every time.
    const play = () => {
      let memory: CaptionMemory = NO_CAPTIONS;
      const said: string[] = [];
      for (let hand = 1; hand <= 20; hand++) {
        const random = seededRandom(momentSeed("ABCDEF", hand));
        for (const pools of [["winner"], ["bluff", "loss", "bro"], ["reaction"]] as const) {
          const choice = pickCaption({
            pools: [...pools],
            memory,
            handNumber: hand,
            random,
          });
          memory = choice.memory;
          said.push(choice.text);
        }
      }
      return said;
    };
    expect(play()).toEqual(play());
  });

  it("still says different things from one hand to the next", () => {
    // Determinism must not collapse into saying one thing forever, which is
    // the way this fix could quietly undo the anti-repetition it sits on top
    // of: same seed, same first candidate, same line every hand.
    let memory: CaptionMemory = NO_CAPTIONS;
    const said: string[] = [];
    for (let hand = 1; hand <= 12; hand++) {
      const choice = pickCaption({
        pools: ["loss"],
        memory,
        handNumber: hand,
        random: seededRandom(momentSeed("ABCDEF", hand)),
      });
      memory = choice.memory;
      said.push(choice.text);
    }
    expect(new Set(said).size).toBeGreaterThan(6);
  });
});
