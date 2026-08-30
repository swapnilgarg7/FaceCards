import { describe, expect, it } from "vitest";
import {
  CAPTIONS,
  COOLDOWN_HANDS,
  NO_CAPTIONS,
  pickCaption,
  type CaptionCategory,
  type CaptionMemory,
} from "./captions.js";

/**
 * The two things that can go wrong with generated copy: it says the same thing
 * twice, or it says the wrong thing. Both are tested here, and neither needs a
 * browser, a camera or a hand of poker to reproduce.
 */

/** A generator that walks a fixed list, so a "random" pick is a chosen pick. */
function sequence(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/** Deal `count` captions in a row, threading the memory the way the app does. */
function run(
  pools: readonly CaptionCategory[],
  count: number,
  random: () => number,
): string[] {
  let memory: CaptionMemory = NO_CAPTIONS;
  const out: string[] = [];
  for (let hand = 1; hand <= count; hand++) {
    const choice = pickCaption({ pools, memory, handNumber: hand, random });
    memory = choice.memory;
    out.push(choice.text);
  }
  return out;
}

describe("the library itself", () => {
  it("has lines in every drawer", () => {
    // An empty category is a blank caption over somebody's face at the loudest
    // moment of the evening. The exhaustive `Record` makes a *missing* one a
    // compile error; this catches the one that is present and empty.
    for (const [category, lines] of Object.entries(CAPTIONS)) {
      expect(lines.length, category).toBeGreaterThan(4);
    }
  });

  it("has no duplicate lines inside a drawer", () => {
    // A line listed twice is silently twice as likely, which is the exact
    // failure the cooldown exists to prevent, arriving through the back door.
    for (const [category, lines] of Object.entries(CAPTIONS)) {
      expect(new Set(lines).size, category).toBe(lines.length);
    }
  });
});

describe("not repeating itself", () => {
  it("never repeats a line inside the cooldown", () => {
    // Always takes the first candidate, which is the worst case: a generator
    // that is not random at all still must not repeat, because it is the
    // cooldown doing the work rather than the shuffle.
    const said = run(["bro"], COOLDOWN_HANDS, sequence([0]));
    expect(new Set(said).size).toBe(said.length);
  });

  it("comes back round rather than running dry", () => {
    // A library that burns through itself and then goes silent is worse than
    // one that repeats. Forty hands out of one drawer must still produce forty
    // captions.
    const said = run(["loss"], 40, sequence([0.1, 0.7, 0.35, 0.9, 0.5]));
    expect(said).toHaveLength(40);
    expect(said.every((line) => line.length > 0)).toBe(true);
  });

  it("falls back to the least recently used line when everything is on cooldown", () => {
    // `winner` is smaller than the cooldown window in some configurations, and
    // when every line is fresh the correct answer is the stalest one, not a
    // blank card.
    const pools: CaptionCategory[] = ["escalation"];
    let memory: CaptionMemory = NO_CAPTIONS;
    const lines = CAPTIONS.escalation.length;
    // Exhaust the drawer inside a single cooldown window.
    for (let hand = 1; hand <= lines; hand++) {
      memory = pickCaption({
        pools,
        memory,
        handNumber: hand,
        random: sequence([0]),
      }).memory;
    }
    const next = pickCaption({
      pools,
      memory,
      handNumber: lines,
      random: sequence([0]),
    });
    expect(CAPTIONS.escalation).toContain(next.text);
  });

  it("forgets lines that can no longer change a decision", () => {
    // The memory outlives every hand of an evening, so it has to be bounded.
    let memory: CaptionMemory = NO_CAPTIONS;
    for (let hand = 1; hand <= 200; hand++) {
      memory = pickCaption({
        pools: ["bro"],
        memory,
        handNumber: hand,
        random: sequence([0.3, 0.8, 0.05]),
      }).memory;
    }
    expect(memory.used.size).toBeLessThanOrEqual(COOLDOWN_HANDS);
  });
});

describe("saying the right thing", () => {
  it("prefers the most specific drawer", () => {
    // A caught bluff should overwhelmingly produce a bluff line, not a
    // generic one, even though both are in the pool.
    const said = run(
      ["bluff", "loss", "bro"],
      40,
      sequence([0.01, 0.2, 0.4, 0.05, 0.3]),
    );
    const bluffs = said.filter((line) =>
      (CAPTIONS.bluff as readonly string[]).includes(line),
    );
    expect(bluffs.length).toBeGreaterThan(said.length / 2);
  });

  it("still reaches the general drawers sometimes", () => {
    // The other half of the argument: always taking the specific pool turns
    // the system into a lookup table. The tail of the distribution has to be
    // reachable.
    const said = run(
      ["bluff", "loss", "bro"],
      60,
      sequence([0.05, 0.99, 0.5, 0.97, 0.2, 0.995]),
    );
    const general = said.filter(
      (line) =>
        (CAPTIONS.loss as readonly string[]).includes(line) ||
        (CAPTIONS.bro as readonly string[]).includes(line),
    );
    expect(general.length).toBeGreaterThan(0);
  });

  it("only ever draws from the pools it was given", () => {
    const said = run(["rivered"], 30, sequence([0.1, 0.6, 0.9, 0.35]));
    for (const line of said) {
      expect(CAPTIONS.rivered).toContain(line);
    }
  });

  it("produces a line for an empty pool rather than a blank card", () => {
    const choice = pickCaption({
      pools: [],
      memory: NO_CAPTIONS,
      handNumber: 1,
      random: sequence([0.5]),
    });
    expect(choice.text.length).toBeGreaterThan(0);
  });

  it("survives a generator that returns numbers outside 0..1", () => {
    // Not hypothetical paranoia: the pick walks a weighted list and a value of
    // exactly 1 walks off the end of it. A caption is not worth a crash on the
    // payout screen.
    for (const value of [-1, 0, 1, 2, Number.NaN]) {
      const choice = pickCaption({
        pools: ["loss"],
        memory: NO_CAPTIONS,
        handNumber: 1,
        random: () => value,
      });
      expect(choice.text.length).toBeGreaterThan(0);
    }
  });
});
