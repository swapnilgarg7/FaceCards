import { describe, expect, it } from "vitest";
import { HandStrength, SeatStatus, TablePhase } from "@facecards/shared";
import type {
  HandNoteSnapshot,
  RoomSnapshot,
  SeatSnapshot,
} from "../net/useRoom.js";
import { MAX_WITNESSES, planMoment, type Treatment } from "./moment.js";

/**
 * What gets photographed and what does not.
 *
 * The tests that matter most are the ones asserting *no*: the feature is only
 * funny because it is rare, and a threshold that drifts down turns it into a
 * loading screen between hands. Every "returns null" case below is a
 * requirement, not an edge.
 */

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: `s${over.seat ?? 0}`,
    displayName: `Player ${over.seat ?? 0}`,
    avatar: "gambler",
    seat: 0,
    connected: true,
    ready: true,
    readyNext: false,
    sittingOut: false,
    stack: 1000,
    bet: 0,
    totalBuyIn: 1000,
    pendingBuyIn: 0,
    handsPlayed: 1,
    handsWon: 0,
    owesBlind: false,
    status: SeatStatus.Active,
    cardCount: 2,
    ...over,
  };
}

function note(over: Partial<HandNoteSnapshot> = {}): HandNoteSnapshot {
  return {
    seat: 0,
    won: 0,
    committed: 0,
    allIn: false,
    busted: false,
    aggressor: false,
    biggestCall: 0,
    showed: false,
    category: -1,
    rivered: false,
    ...over,
  };
}

function table(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  const players = over.players ?? [
    seat({ seat: 0, sessionId: "s0" }),
    seat({ seat: 1, sessionId: "s1" }),
  ];
  return {
    code: "ABCDEF",
    phase: TablePhase.Payout,
    board: [],
    pot: 0,
    pots: [],
    currentBet: 0,
    canCheck: false,
    canRaise: false,
    callAmount: 0,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    actingSeat: -1,
    actingMs: 0,
    turn: 1,
    buttonSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 4,
    reveals: [],
    lastResult: "",
    handNotes: [],
    bluffCaughtSeat: -1,
    ...over,
    players,
  };
}

const plan = (snapshot: RoomSnapshot, random = () => 0.5) =>
  planMoment({ snapshot, random, lastTreatment: null });

describe("what is not a moment", () => {
  it("says no to a hand with no notes", () => {
    expect(plan(table())).toBeNull();
  });

  it("says no to an ordinary small pot won on folds", () => {
    // The common case, forty times an evening. It has to be silent or the
    // feature is a modal between every hand.
    expect(
      plan(
        table({
          pot: 30,
          handNotes: [note({ seat: 0, won: 30, committed: 10 }), note({ seat: 1 })],
        }),
      ),
    ).toBeNull();
  });

  it("says no to a small showdown", () => {
    // Two people checking it down is a showdown and is not a moment, however
    // many cards got turned over.
    expect(
      plan(
        table({
          pot: 60,
          handNotes: [
            note({ seat: 0, won: 60, showed: true, category: HandStrength.Pair }),
            note({ seat: 1, showed: true, category: HandStrength.HighCard }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("says no to a chopped pot", () => {
    // No hero, and the whole layout is built around there being one.
    expect(
      plan(
        table({
          pot: 800,
          handNotes: [
            note({ seat: 0, won: 400, allIn: true, showed: true }),
            note({ seat: 1, won: 400, allIn: true, showed: true }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("what is a moment", () => {
  it("photographs a caught bluff, and leads with it", () => {
    const moment = plan(
      table({
        pot: 400,
        bluffCaughtSeat: 1,
        handNotes: [
          note({ seat: 0, won: 400, showed: true, category: HandStrength.Pair }),
          note({
            seat: 1,
            showed: true,
            aggressor: true,
            category: HandStrength.HighCard,
            committed: 200,
          }),
        ],
      }),
    );
    expect(moment?.triggers[0]).toBe("bluff-caught");
    expect(moment?.hero.seat).toBe(0);
    expect(moment?.fallen[0]?.seat).toBe(1);
    // The bluffer's caption comes out of the bluff drawer first.
    expect(moment?.fallen[0]?.pools[0]).toBe("bluff");
  });

  it("photographs an elimination even in a modest pot", () => {
    const moment = plan(
      table({
        pot: 180,
        handNotes: [
          note({ seat: 0, won: 180, committed: 90 }),
          note({ seat: 1, committed: 90, allIn: true, busted: true }),
        ],
      }),
    );
    expect(moment?.triggers).toContain("elimination");
    expect(moment?.tier).toBe("huge");
  });

  it("calls quads legendary whatever the pot was", () => {
    const moment = plan(
      table({
        pot: 300,
        handNotes: [
          note({
            seat: 0,
            won: 300,
            showed: true,
            category: HandStrength.FourOfAKind,
          }),
          note({ seat: 1, showed: true, category: HandStrength.Flush }),
        ],
      }),
    );
    expect(moment?.tier).toBe("legendary");
  });

  it("escalates with the size of the pot", () => {
    // 30, 70 and 200 big blinds. 20 would not qualify at all, which is its
    // own test above.
    const tiers = [300, 700, 2000].map(
      (pot) =>
        plan(
          table({
            pot,
            handNotes: [
              note({ seat: 0, won: pot, committed: pot / 2 }),
              note({ seat: 1, committed: pot / 2, showed: true }),
            ],
          }),
        )?.tier,
    );
    expect(tiers).toEqual(["big", "huge", "legendary"]);
  });
});

describe("who is in the picture", () => {
  it("leaves out somebody who folded for nothing", () => {
    // "BRO REALLY THOUGHT" under a player who folded the small blind is the
    // failure the brief is most explicit about: the joke has to be about a
    // poker situation, and there was not one.
    const moment = plan(
      table({
        pot: 500,
        players: [
          seat({ seat: 0, sessionId: "s0" }),
          seat({ seat: 1, sessionId: "s1" }),
          seat({ seat: 2, sessionId: "s2" }),
        ],
        handNotes: [
          note({ seat: 0, won: 500, committed: 250, showed: true }),
          note({ seat: 1, committed: 250, showed: true, allIn: true }),
          note({ seat: 2, committed: 5 }),
        ],
      }),
    );
    expect(moment?.fallen.map((p) => p.seat)).toEqual([1]);
    expect(moment?.witnesses.map((p) => p.seat)).toEqual([2]);
  });

  it("caps the reaction strip so the faces stay legible", () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      seat({ seat: i, sessionId: `s${i}` }),
    );
    const moment = plan(
      table({
        pot: 500,
        players,
        handNotes: [
          note({ seat: 0, won: 500, committed: 250 }),
          note({ seat: 1, committed: 250, allIn: true }),
        ],
      }),
    );
    expect(moment?.witnesses.length).toBe(MAX_WITNESSES);
  });

  it("orders the fallen by what the hand cost them", () => {
    const moment = plan(
      table({
        pot: 900,
        players: [
          seat({ seat: 0, sessionId: "s0" }),
          seat({ seat: 1, sessionId: "s1" }),
          seat({ seat: 2, sessionId: "s2" }),
        ],
        handNotes: [
          note({ seat: 0, won: 900, committed: 300 }),
          note({ seat: 1, committed: 100, showed: true }),
          note({ seat: 2, committed: 500, showed: true }),
        ],
      }),
    );
    expect(moment?.fallen.map((p) => p.seat)).toEqual([2, 1]);
  });

  it("does not put a departed winner in the picture", () => {
    // A player can be all-in, close their laptop, reach the showdown and win.
    // The server still names them in the summary; there is no camera here.
    expect(
      plan(
        table({
          players: [seat({ seat: 1, sessionId: "s1" })],
          pot: 900,
          handNotes: [
            note({ seat: 0, won: 900, allIn: true, showed: true }),
            note({ seat: 1, showed: true, committed: 450 }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("what a loss is about", () => {
  const lossPools = (over: Partial<HandNoteSnapshot>, pot = 600) =>
    plan(
      table({
        pot,
        bluffCaughtSeat: -1,
        handNotes: [
          note({ seat: 0, won: pot, committed: pot / 2 }),
          note({ seat: 1, committed: pot / 2, ...over }),
        ],
      }),
    )?.fallen[0]?.pools;

  it("leads with the river when the river did it", () => {
    expect(lossPools({ showed: true, rivered: true })?.[0]).toBe("rivered");
  });

  it("leads with the hand when it was a cooler", () => {
    expect(
      lossPools({ showed: true, category: HandStrength.FullHouse })?.[0],
    ).toBe("strong-hand");
  });

  it("mentions the call only when the call was big", () => {
    expect(lossPools({ showed: true, biggestCall: 40 })).not.toContain(
      "big-call",
    );
    expect(lossPools({ showed: true, biggestCall: 400 })).toContain("big-call");
  });

  it("puts elimination behind the reason they lost", () => {
    // Being out is how much it cost; the drawers in front of it are why it
    // happened, and why makes the better joke. The tier carries the volume.
    const pools = lossPools({
      showed: true,
      rivered: true,
      allIn: true,
      busted: true,
    });
    expect(pools?.indexOf("rivered")).toBeLessThan(
      pools?.indexOf("eliminated") ?? -1,
    );
  });

  it("always ends with something general to fall back on", () => {
    expect(lossPools({ allIn: true })?.slice(-2)).toEqual(["loss", "bro"]);
  });
});

describe("the look", () => {
  it("does not repeat the last treatment", () => {
    const snapshot = table({
      pot: 900,
      handNotes: [
        note({ seat: 0, won: 900, committed: 450, allIn: true }),
        note({ seat: 1, committed: 450, allIn: true, busted: true }),
      ],
    });
    // Every value the generator can take, against every previous treatment:
    // none of them may hand back the one we just showed.
    const treatments: Treatment[] = [
      "trading-card",
      "champion",
      "newspaper",
      "wanted",
      "hall-of-fame",
      "freeze-frame",
    ];
    for (const last of treatments) {
      for (const r of [0, 0.17, 0.34, 0.5, 0.67, 0.83, 0.999]) {
        const picked = planMoment({
          snapshot,
          random: () => r,
          lastTreatment: last,
        })?.treatment;
        expect(picked).not.toBe(last);
      }
    }
  });

  it("keeps the loud treatments for the loud hands", () => {
    const quiet = table({
      pot: 300,
      handNotes: [
        note({ seat: 0, won: 300, committed: 150 }),
        note({ seat: 1, committed: 150, showed: true }),
      ],
    });
    for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
      const picked = planMoment({
        snapshot: quiet,
        random: () => r,
        lastTreatment: null,
      })?.treatment;
      expect(picked).not.toBe("hall-of-fame");
    }
  });
});
