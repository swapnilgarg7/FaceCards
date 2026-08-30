import { describe, expect, it } from "vitest";
import { HandStrength } from "@facecards/shared";
import { cardsFromString, makeDeck } from "./cards.js";
import {
  HandCategory,
  categoryOf,
  describeHand,
  evaluate,
  evaluate5,
} from "./evaluate.js";

const score = (text: string) => evaluate5(cardsFromString(text)).valueOf();
const best = (text: string) => evaluate(cardsFromString(text));

describe("five-card categories", () => {
  const cases: [string, number][] = [
    ["As Ks Qs Js Ts", HandCategory.StraightFlush],
    ["5s 4s 3s 2s As", HandCategory.StraightFlush],
    ["9c 9d 9h 9s 2c", HandCategory.FourOfAKind],
    ["Kc Kd Kh 3s 3c", HandCategory.FullHouse],
    ["Ac Jc 8c 5c 2c", HandCategory.Flush],
    ["9c 8d 7h 6s 5c", HandCategory.Straight],
    ["5c 4d 3h 2s Ac", HandCategory.Straight],
    ["Qc Qd Qh 7s 2c", HandCategory.ThreeOfAKind],
    ["Jc Jd 4h 4s 9c", HandCategory.TwoPair],
    ["Tc Td 8h 5s 2c", HandCategory.Pair],
    ["Ac Qd 9h 5s 3c", HandCategory.HighCard],
  ];

  for (const [hand, category] of cases) {
    it(`${hand} is category ${category}`, () => {
      expect(categoryOf(score(hand))).toBe(category);
    });
  }

  it("orders every category correctly", () => {
    const ordered = cases.map(([hand]) => hand).reverse();
    const scores = ordered.map(score);
    // The wheel straight flush and the wheel straight sit alongside their
    // category peers, so compare category-by-category rather than pairwise.
    for (let i = 1; i < scores.length; i++) {
      expect(categoryOf(scores[i]!)).toBeGreaterThanOrEqual(
        categoryOf(scores[i - 1]!),
      );
    }
    expect(score("As Ks Qs Js Ts")).toBeGreaterThan(score("9c 9d 9h 9s 2c"));
  });
});

describe("tie-breaking within a category", () => {
  it("ranks a wheel straight below every other straight", () => {
    expect(score("5c 4d 3h 2s Ac")).toBeLessThan(score("6c 5d 4h 3s 2c"));
  });

  it("ranks an ace-high flush above a king-high flush", () => {
    expect(score("Ac Jc 8c 5c 2c")).toBeGreaterThan(score("Kc Qc 8c 5c 2c"));
  });

  it("breaks a pair on kickers in order", () => {
    expect(score("Tc Td Ah 5s 2c")).toBeGreaterThan(score("Tc Td Kh 5s 2c"));
    expect(score("Tc Td Ah 5s 3c")).toBeGreaterThan(score("Tc Td Ah 5s 2c"));
  });

  it("ranks trips over the same top pair with a better kicker", () => {
    expect(score("Qc Qd Qh 2s 3c")).toBeGreaterThan(score("Qc Qd Ah Ks 3c"));
  });

  it("ranks a full house by the trips first", () => {
    // Kings full of deuces beats threes full of kings: the trips are read
    // first, and only then the pair.
    expect(score("Kc Kd Kh 2s 2c")).toBeGreaterThan(score("3c 3d 3h Ks Kc"));
    // Same trips, better pair.
    expect(score("Kc Kd Kh As Ac")).toBeGreaterThan(score("Kc Kd Kh 2s 2c"));
  });

  it("treats two identical hands in different suits as equal", () => {
    expect(score("Ac Kd 9h 5s 3c")).toBe(score("Ad Kh 9s 5c 3d"));
  });
});

describe("best five of seven", () => {
  it("finds a flush hidden among seven cards", () => {
    const value = best("2c 7c Kc 4c 9c Ah Ad");
    expect(value.category).toBe(HandCategory.Flush);
  });

  it("prefers the straight over the lower pair", () => {
    const value = best("9c 8d 7h 6s 5c 2d 2h");
    expect(value.category).toBe(HandCategory.Straight);
  });

  it("uses the board when it beats the hole cards", () => {
    // Board is a made straight flush; nothing in hand improves it.
    const value = best("2d 3h As Ks Qs Js Ts");
    expect(describeHand(value)).toBe("Royal Flush");
  });

  it("plays the board when both players have nothing", () => {
    const board = "As Kd Qh Jc 9s";
    expect(best(`2c 3d ${board}`).score).toBe(best(`2h 3s ${board}`).score);
  });

  it("rejects a duplicate card rather than scoring it", () => {
    expect(() => best("As As Kd Qh Jc 9s 2c")).toThrow(/duplicate/);
  });
});

describe("descriptions", () => {
  const cases: [string, string][] = [
    ["As Ks Qs Js Ts", "Royal Flush"],
    ["9s 8s 7s 6s 5s", "Straight Flush, Nine high"],
    ["9c 9d 9h 9s 2c", "Four of a Kind, Nines"],
    ["Kc Kd Kh 3s 3c", "Full House, Kings full of Threes"],
    ["Ac Jc 8c 5c 2c", "Flush, Ace high"],
    ["5c 4d 3h 2s Ac", "Straight, Five high"],
    ["Jc Jd 4h 4s 9c", "Two Pair, Jacks and Fours"],
    ["Tc Td 8h 5s 2c", "Pair of Tens"],
    ["Ac Qd 9h 5s 3c", "High Card, Ace"],
  ];

  for (const [hand, text] of cases) {
    it(`${hand} reads as "${text}"`, () => {
      expect(describeHand(evaluate(cardsFromString(hand)))).toBe(text);
    });
  }
});

describe("exhaustive sanity", () => {
  it("scores every distinct five-card hand without throwing", () => {
    // 2,598,960 hands is more than this needs to prove; a strided sample
    // covers every category and every packing boundary in well under a
    // second, which keeps `npm test` fast enough to actually run.
    const deck = makeDeck();
    let count = 0;
    for (let a = 0; a < 48; a += 1) {
      for (let b = a + 1; b < 49; b += 3) {
        for (let c = b + 1; c < 50; c += 5) {
          for (let d = c + 1; d < 51; d += 7) {
            for (let e = d + 1; e < 52; e += 11) {
              const value = evaluate5([
                deck[a]!, deck[b]!, deck[c]!, deck[d]!, deck[e]!,
              ]);
              expect(Number.isSafeInteger(value)).toBe(true);
              expect(categoryOf(value)).toBeGreaterThanOrEqual(0);
              expect(categoryOf(value)).toBeLessThanOrEqual(8);
              count++;
            }
          }
        }
      }
    }
    expect(count).toBeGreaterThan(1000);
  });
});

describe("wire numbering", () => {
  it("matches the shared HandStrength the client reads", () => {
    // `HandNote.category` puts these numbers on the wire, and the client picks
    // a caption off them. The two lists are declared separately so that
    // `server/src/poker/` stays importless; this is what stops them drifting.
    expect(HandCategory).toEqual({ ...HandStrength });
  });
});
