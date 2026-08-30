import { describe, expect, it } from "vitest";
import { PokerAction, SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { betLadder, ladderIndex, RAISE_RUNGS } from "./betLadder.js";

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: "me",
    displayName: "Me",
    avatar: "cowboy",
    seat: 0,
    connected: true,
    ready: true,
    readyNext: false,
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
    pot: 15,
    pots: [],
    currentBet: 10,
    canCheck: false,
    canRaise: true,
    callAmount: 10,
    minRaiseTo: 20,
    maxRaiseTo: 1000,
    actingSeat: 0,
    actingMs: 30_000,
    turn: 3,
    buttonSeat: 1,
    smallBlindSeat: 2,
    bigBlindSeat: 0,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 1,
    reveals: [],
    handNotes: [],
    bluffCaughtSeat: -1,
    lastResult: "",
    players: [],
    ...over,
  };
}

describe("betLadder", () => {
  it("offers nothing when it is not your decision", () => {
    expect(betLadder(table({ actingSeat: 3 }), seat())).toEqual([]);
    expect(betLadder(table({ actingSeat: -1 }), seat())).toEqual([]);
    expect(betLadder(table(), undefined)).toEqual([]);
  });

  it("starts at the free action when checking is free", () => {
    const rungs = betLadder(table({ canCheck: true, callAmount: 0 }), seat());
    expect(rungs[0]?.type).toBe(PokerAction.Check);
    expect(rungs[0]?.amount).toBeUndefined();
  });

  it("starts at the call when it is not", () => {
    const rungs = betLadder(table(), seat());
    expect(rungs[0]).toMatchObject({
      type: PokerAction.Call,
      chipsForward: 10,
    });
  });

  it("draws a call as everything that ends up in front of the seat", () => {
    // Already 10 in from the blind, owing 20 more: the pile is 30, not 20.
    const rungs = betLadder(table({ callAmount: 20 }), seat({ bet: 10 }));
    expect(rungs[0]?.chipsForward).toBe(30);
  });

  it("never aims at a value the server did not publish as legal", () => {
    // The whole safety argument, asserted across a spread of tables.
    for (const min of [20, 35, 100, 999]) {
      for (const max of [min, min + 5, min + 340, 1000, 4321]) {
        if (max < min) continue;
        const rungs = betLadder(table({ minRaiseTo: min, maxRaiseTo: max }), seat());
        for (const rung of rungs) {
          if (rung.type !== PokerAction.Raise) continue;
          expect(rung.amount).toBeGreaterThanOrEqual(min);
          expect(rung.amount).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("always reaches all-in", () => {
    for (const max of [20, 137, 1000, 5555]) {
      const rungs = betLadder(table({ minRaiseTo: 20, maxRaiseTo: max }), seat());
      expect(rungs.at(-1)?.amount).toBe(max);
      expect(rungs.at(-1)?.label).toContain("All in");
    }
  });

  it("climbs, so a longer push is never a smaller bet", () => {
    const rungs = betLadder(table({ minRaiseTo: 20, maxRaiseTo: 940 }), seat());
    const amounts = rungs
      .filter((r) => r.type === PokerAction.Raise)
      .map((r) => r.amount!);
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]!).toBeGreaterThan(amounts[i - 1]!);
    }
  });

  it("sizes in whole big blinds where it can", () => {
    const rungs = betLadder(table({ minRaiseTo: 20, maxRaiseTo: 1000 }), seat());
    for (const rung of rungs) {
      if (rung.type !== PokerAction.Raise) continue;
      expect(rung.amount! % 10).toBe(0);
    }
  });

  it("offers no raise at all when the server says you cannot", () => {
    const rungs = betLadder(table({ canRaise: false }), seat());
    expect(rungs).toHaveLength(1);
    expect(rungs[0]?.type).toBe(PokerAction.Call);
  });

  it("collapses to one rung when the only raise is all-in", () => {
    const rungs = betLadder(table({ minRaiseTo: 300, maxRaiseTo: 300 }), seat());
    const raises = rungs.filter((r) => r.type === PokerAction.Raise);
    expect(raises).toHaveLength(1);
    expect(raises[0]?.amount).toBe(300);
  });

  it("survives a server that says raise but leaves no room to", () => {
    const rungs = betLadder(table({ minRaiseTo: 500, maxRaiseTo: 400 }), seat());
    expect(rungs.every((r) => r.type !== PokerAction.Raise)).toBe(true);
  });

  it("stays a handful of detents rather than a continuum", () => {
    const rungs = betLadder(table({ minRaiseTo: 20, maxRaiseTo: 9999 }), seat());
    expect(rungs.length).toBeLessThanOrEqual(RAISE_RUNGS + 2);
  });

  it("calls a first bet a bet and a re-raise a raise", () => {
    const opening = betLadder(
      table({ currentBet: 0, canCheck: true, callAmount: 0 }),
      seat(),
    );
    expect(opening[1]?.label.startsWith("Bet")).toBe(true);
    const reraise = betLadder(table(), seat());
    expect(reraise[1]?.label.startsWith("Raise to")).toBe(true);
  });
});

describe("ladderIndex", () => {
  it("gives every rung an equal slice of the travel", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i <= 1000; i++) {
      const index = ladderIndex(i / 1000, 4);
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([0, 1, 2, 3]);
    const sizes = [...counts.values()];
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(2);
  });

  it("clamps rather than running off either end", () => {
    expect(ladderIndex(-3, 5)).toBe(0);
    expect(ladderIndex(0, 5)).toBe(0);
    expect(ladderIndex(1, 5)).toBe(4);
    expect(ladderIndex(9, 5)).toBe(4);
  });

  it("selects nothing when there is nothing to select", () => {
    expect(ladderIndex(0.5, 0)).toBe(-1);
  });
});
