import { describe, expect, it } from "vitest";
import { SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { tableCues } from "./cues.js";
import { SOUNDS, soundFiles, type SoundId } from "./sounds.js";

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: "a",
    displayName: "A",
    avatar: "cowboy",
    seat: 0,
    connected: true,
    ready: true,
    sittingOut: false,
    stack: 1000,
    bet: 0,
    totalBuyIn: 1000,
    pendingBuyIn: 0,
    handsPlayed: 0,
    handsWon: 0,
    owesBlind: false,
    status: SeatStatus.Active,
    cardCount: 2,
    ...over,
  };
}

function table(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDEF",
    phase: TablePhase.Preflop,
    board: [],
    pot: 0,
    pots: [],
    currentBet: 0,
    canCheck: true,
    canRaise: true,
    callAmount: 0,
    minRaiseTo: 10,
    maxRaiseTo: 1000,
    actingSeat: 0,
    actingMs: 30_000,
    turn: 1,
    buttonSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 0,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 1,
    reveals: [],
    lastResult: "",
    players: [seat({ sessionId: "a", seat: 0 }), seat({ sessionId: "b", seat: 1 })],
    ...over,
  };
}

function sounds(cues: { sound: SoundId }[]): SoundId[] {
  return cues.map((cue) => cue.sound);
}

describe("tableCues", () => {
  it("says nothing when sitting down at a table already in progress", () => {
    // Otherwise the first thing a new player hears is a deal that happened
    // before they arrived.
    expect(tableCues(null, table({ handNumber: 7, pot: 300 }))).toEqual([]);
  });

  it("says nothing when nothing changed", () => {
    const snapshot = table();
    expect(tableCues(snapshot, { ...snapshot })).toEqual([]);
  });

  it("shuffles once and deals one click per card", () => {
    const before = table({ handNumber: 4, players: [] });
    const after = table({ handNumber: 5, pot: 15 });
    const cues = tableCues(before, after);
    expect(cues[0]).toEqual({ sound: "shuffle", delayMs: 0 });
    expect(cues.filter((c) => c.sound === "deal")).toHaveLength(4);
  });

  it("deals in time order, never two clicks at once", () => {
    const cues = tableCues(table({ handNumber: 1 }), table({ handNumber: 2 }));
    const deals = cues.filter((c) => c.sound === "deal").map((c) => c.delayMs);
    for (let i = 1; i < deals.length; i++) {
      expect(deals[i]!).toBeGreaterThan(deals[i - 1]!);
    }
  });

  it("treats everything else about a new hand as part of the deal", () => {
    // The board clearing, statuses resetting and blinds posting all land in
    // the same patch. Only one of them is an event.
    const before = table({
      handNumber: 3,
      board: ["As", "Kd", "2c"],
      phase: TablePhase.Payout,
      players: [seat({ seat: 0, bet: 40, status: SeatStatus.Folded })],
    });
    const after = table({ handNumber: 4, pot: 15 });
    expect(new Set(sounds(tableCues(before, after)))).toEqual(
      new Set(["shuffle", "deal", "chipPush"]),
    );
  });

  it("flips one card per community card, staggered", () => {
    const before = table({ board: [] });
    const after = table({ board: ["As", "Kd", "2c"] });
    const flips = tableCues(before, after).filter((c) => c.sound === "flip");
    expect(flips).toHaveLength(3);
    expect(flips[0]!.delayMs).toBe(0);
    expect(flips[2]!.delayMs).toBeGreaterThan(flips[1]!.delayMs);
  });

  it("pushes chips when a seat's bet grows", () => {
    const before = table();
    const after = table({
      players: [seat({ seat: 0, bet: 50 }), seat({ sessionId: "b", seat: 1 })],
    });
    expect(sounds(tableCues(before, after))).toContain("chipPush");
  });

  it("pushes once for a round, not once per seat", () => {
    const before = table();
    const after = table({
      players: [
        seat({ seat: 0, bet: 50 }),
        seat({ sessionId: "b", seat: 1, bet: 50 }),
      ],
    });
    expect(
      tableCues(before, after).filter((c) => c.sound === "chipPush"),
    ).toHaveLength(1);
  });

  it("says nothing about a bet that only shrank", () => {
    // Bets going down without emptying is not a thing the engine does, but a
    // sound fired on it would be a sound fired on a patch, not an event.
    const before = table({ players: [seat({ seat: 0, bet: 50 })] });
    const after = table({ players: [seat({ seat: 0, bet: 20 })] });
    expect(sounds(tableCues(before, after))).not.toContain("chipPush");
  });

  it("lets go of a hand audibly", () => {
    const before = table();
    const after = table({
      players: [
        seat({ seat: 0, status: SeatStatus.Folded, cardCount: 0 }),
        seat({ sessionId: "b", seat: 1 }),
      ],
    });
    expect(sounds(tableCues(before, after))).toContain("fold");
  });

  it("sweeps the bets in when a betting round closes", () => {
    const before = table({
      pot: 100,
      players: [seat({ seat: 0, bet: 50 }), seat({ sessionId: "b", seat: 1, bet: 50 })],
    });
    const after = table({
      pot: 100,
      board: ["As", "Kd", "2c"],
      players: [seat({ seat: 0 }), seat({ sessionId: "b", seat: 1 })],
    });
    const cues = tableCues(before, after);
    expect(sounds(cues)).toContain("chipCollect");
    // After the flop has started landing, not underneath it.
    expect(cues.find((c) => c.sound === "chipCollect")!.delayMs).toBeGreaterThan(0);
  });

  it("does not sweep a round that had nothing in front of it", () => {
    const before = table({ board: [] });
    const after = table({ board: ["As", "Kd", "2c"] });
    expect(sounds(tableCues(before, after))).not.toContain("chipCollect");
  });

  it("pushes the pot to the winner exactly once", () => {
    const before = table({ phase: TablePhase.River });
    const after = table({ phase: TablePhase.Payout });
    const cues = tableCues(before, after);
    expect(cues.filter((c) => c.sound === "potPush")).toHaveLength(1);
    // A payout that is still on screen next patch must not push again.
    expect(sounds(tableCues(after, { ...after }))).not.toContain("potPush");
  });

  it("waits for the last card before pushing the pot", () => {
    const cues = tableCues(
      table({ phase: TablePhase.River }),
      table({ phase: TablePhase.Payout }),
    );
    expect(cues.find((c) => c.sound === "potPush")!.delayMs).toBeGreaterThan(0);
  });

  it("only ever asks for sounds that exist", () => {
    const cases: [RoomSnapshot, RoomSnapshot][] = [
      [table({ handNumber: 1 }), table({ handNumber: 2 })],
      [table(), table({ board: ["As", "Kd", "2c"] })],
      [table(), table({ phase: TablePhase.Payout })],
      [
        table({ players: [seat({ bet: 30 })], pot: 30 }),
        table({ players: [seat({ bet: 0 })], pot: 30 }),
      ],
    ];
    for (const [before, after] of cases) {
      for (const cue of tableCues(before, after)) {
        expect(SOUNDS[cue.sound]).toBeDefined();
        expect(SOUNDS[cue.sound].files.length).toBeGreaterThan(0);
        expect(cue.delayMs).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("sound manifest", () => {
  it("names every file exactly once", () => {
    const files = soundFiles();
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((file) => file.endsWith(".ogg"))).toBe(true);
  });

  it("gives every sound a level and at least one file", () => {
    for (const [id, spec] of Object.entries(SOUNDS)) {
      expect(spec.files.length, id).toBeGreaterThan(0);
      expect(spec.gain, id).toBeGreaterThan(0);
      expect(spec.gain, id).toBeLessThanOrEqual(1);
    }
  });

  it("gives the repeated sounds more than one take", () => {
    // A repeated identical transient is what makes a real sound read as a
    // sample, and these are the ones that fire in bursts.
    for (const id of ["deal", "flip", "chipPush"] as const) {
      expect(SOUNDS[id].files.length, id).toBeGreaterThan(1);
    }
  });
});
