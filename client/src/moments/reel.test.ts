import { describe, expect, it } from "vitest";
import type { Shot } from "./capture.js";
import type { DramaTier, MomentTrigger } from "./moment.js";
import {
  REEL_CAP,
  addToReel,
  nightInReview,
  shotsOf,
  type ReelEntry,
  type ReelFace,
} from "./reel.js";

/**
 * The evening's memory: what it keeps, what it throws away, and what it says
 * about it afterwards.
 *
 * The eviction test is the one with a bug behind it waiting to happen. Every
 * entry holds live object URLs, so an entry that falls out of the reel without
 * anybody being told is a leak that only shows up after an hour of poker.
 */

const shot = (url: string): Shot => ({ url, width: 256, height: 256 });

function face(over: Partial<ReelFace> = {}): ReelFace {
  return {
    sessionId: "s0",
    displayName: "Player",
    avatar: "gambler",
    shot: shot("blob:hero"),
    caption: "OOF.",
    ...over,
  };
}

function entry(over: Partial<ReelEntry> = {}): ReelEntry {
  return {
    handNumber: 1,
    tier: "big",
    triggers: ["big-pot"],
    treatment: "champion",
    pot: 500,
    hero: face(),
    won: 500,
    fallen: [],
    witnesses: [],
    ...over,
  };
}

const fill = (count: number, make: (i: number) => Partial<ReelEntry> = () => ({})) =>
  Array.from({ length: count }, (_, i) =>
    entry({ handNumber: i + 1, ...make(i) }),
  );

describe("keeping the reel bounded", () => {
  it("keeps everything under the cap", () => {
    let reel: ReelEntry[] = [];
    for (const e of fill(REEL_CAP)) {
      const result = addToReel(reel, e);
      expect(result.evicted).toBeNull();
      reel = result.reel;
    }
    expect(reel).toHaveLength(REEL_CAP);
  });

  it("never grows past the cap", () => {
    let reel: ReelEntry[] = [];
    for (const e of fill(REEL_CAP * 3, (i) => ({ pot: 100 + i }))) {
      reel = addToReel(reel, e).reel;
    }
    expect(reel).toHaveLength(REEL_CAP);
  });

  it("evicts the least memorable, not the oldest", () => {
    // An evening's first hand can be its best one. A plain queue would throw
    // away the quads at midnight to make room for a medium pot at one.
    let reel: ReelEntry[] = [
      entry({ handNumber: 1, tier: "legendary", pot: 4000 }),
      ...fill(REEL_CAP - 1, (i) => ({
        handNumber: i + 2,
        tier: "notable" as DramaTier,
        pot: 200 + i,
      })),
    ];
    const result = addToReel(reel, entry({ handNumber: 99, tier: "huge" }));
    reel = result.reel;
    expect(result.evicted?.tier).toBe("notable");
    expect(reel.some((e) => e.handNumber === 1)).toBe(true);
  });

  it("hands the evicted entry back so its frames can be released", () => {
    // The whole reason eviction is returned rather than performed here: this
    // module may not touch `URL.revokeObjectURL`, and the caller cannot
    // release what it was not told about.
    const reel = fill(REEL_CAP, (i) => ({ pot: 1000 + i }));
    const result = addToReel(reel, entry({ handNumber: 99, pot: 1 }));
    expect(result.evicted).not.toBeNull();
    expect(shotsOf(result.evicted!).length).toBeGreaterThan(0);
  });

  it("lists every shot an entry is holding", () => {
    const e = entry({
      hero: face({ shot: shot("blob:a") }),
      fallen: [face({ shot: shot("blob:b") }), face({ shot: null })],
      witnesses: [face({ shot: shot("blob:c") })],
    });
    expect(shotsOf(e).map((s) => s.url)).toEqual([
      "blob:a",
      "blob:b",
      "blob:c",
    ]);
  });
});

describe("the recap", () => {
  it("says nothing about an evening with nothing in it", () => {
    expect(nightInReview([])).toEqual([]);
  });

  it("omits an award nobody earned rather than inventing a winner", () => {
    // "Biggest bluff: nobody bluffed" is how a funny screen turns into a
    // participation certificate.
    const awards = nightInReview([
      entry({ triggers: ["big-pot"], fallen: [] }),
    ]);
    expect(awards.map((a) => a.key)).not.toContain("biggest-bluff");
    expect(awards.map((a) => a.key)).not.toContain("best-reaction");
  });

  it("adds up the biggest winner across the whole evening", () => {
    // Different from who won the largest single pot, and both are worth a
    // card: somebody can take four medium pots and beat one big one.
    const awards = nightInReview([
      entry({
        handNumber: 1,
        hero: face({ sessionId: "a", displayName: "Ana" }),
        won: 400,
        pot: 400,
      }),
      entry({
        handNumber: 2,
        hero: face({ sessionId: "a", displayName: "Ana" }),
        won: 400,
        pot: 400,
      }),
      entry({
        handNumber: 3,
        hero: face({ sessionId: "b", displayName: "Bo" }),
        won: 700,
        pot: 700,
      }),
    ]);
    const winner = awards.find((a) => a.key === "biggest-winner");
    const pot = awards.find((a) => a.key === "biggest-pot");
    expect(winner?.face.displayName).toBe("Ana");
    expect(winner?.detail).toBe("+800");
    expect(pot?.face.displayName).toBe("Bo");
  });

  it("puts the bluffer on the bluff card, not the player who caught them", () => {
    const awards = nightInReview([
      entry({
        triggers: ["bluff-caught"],
        hero: face({ sessionId: "a", displayName: "Ana" }),
        fallen: [
          face({
            sessionId: "b",
            displayName: "Bo",
            caption: "THE AUDACITY.",
          }),
        ],
      }),
    ]);
    const bluff = awards.find((a) => a.key === "biggest-bluff");
    expect(bluff?.face.displayName).toBe("Bo");
    expect(bluff?.detail).toBe("THE AUDACITY.");
  });

  it("gives the reaction award to somebody who was not even in the hand", () => {
    // The joke: the funniest face at the table belongs to the person it did
    // not happen to.
    const awards = nightInReview([
      entry({
        tier: "legendary",
        hero: face({ sessionId: "a" }),
        fallen: [face({ sessionId: "b" })],
        witnesses: [
          face({ sessionId: "c", displayName: "Cal", caption: "no shot" }),
        ],
      }),
    ]);
    const reaction = awards.find((a) => a.key === "best-reaction");
    expect(reaction?.face.displayName).toBe("Cal");
  });

  it("keeps a suckout out of the fumble award", () => {
    // Being run down on the river is not a misplay, and filing it as one is
    // the kind of joke that stops being friendly.
    const awards = nightInReview([
      entry({
        triggers: ["rivered"],
        fallen: [face({ sessionId: "b", caption: "RIVERED." })],
      }),
    ]);
    expect(awards.map((a) => a.key)).not.toContain("biggest-fumble");
    expect(awards.map((a) => a.key)).toContain("most-devastating");
  });

  it("lets one person win more than one award", () => {
    const awards = nightInReview([
      entry({
        tier: "huge",
        triggers: ["big-pot"],
        hero: face({ sessionId: "a", displayName: "Ana" }),
        won: 2000,
        pot: 2000,
      }),
    ]);
    const names = awards
      .filter((a) => a.key === "biggest-winner" || a.key === "biggest-pot")
      .map((a) => a.face.displayName);
    expect(names).toEqual(["Ana", "Ana"]);
  });

  it("never gives out an award twice", () => {
    const awards = nightInReview(
      fill(6, (i) => ({
        tier: (["notable", "big", "huge", "legendary"] as DramaTier[])[i % 4]!,
        triggers: [
          (["bluff-caught", "rivered", "elimination", "big-pot"] as MomentTrigger[])[
            i % 4
          ]!,
        ],
        pot: 500 + i * 100,
        fallen: [face({ sessionId: `l${i}` })],
        witnesses: [face({ sessionId: `w${i}` })],
      })),
    );
    expect(new Set(awards.map((a) => a.key)).size).toBe(awards.length);
  });
});
