import { describe, expect, it } from "vitest";
import { SeatStatus, TablePhase } from "@facecards/shared";
import type {
  RevealSnapshot,
  RoomSnapshot,
  SeatSnapshot,
} from "../net/useRoom.js";
import {
  boardUp,
  handUp,
  planDurationMs,
  resultUp,
  showdownPlan,
  waitingOn,
} from "./showdown.js";

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: "a",
    displayName: "A",
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
    handsPlayed: 1,
    handsWon: 0,
    status: SeatStatus.Active,
    cardCount: 2,
    ...over,
  };
}

function reveal(over: Partial<RevealSnapshot> = {}): RevealSnapshot {
  return {
    sessionId: "a",
    seat: 0,
    cards: ["As", "Ks"],
    best: ["As", "Ks", "Qs", "Js", "Ts"],
    description: "Royal Flush",
    won: 0,
    ...over,
  };
}

function table(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDEF",
    phase: TablePhase.Payout,
    board: [],
    pot: 400,
    pots: [],
    currentBet: 0,
    canCheck: false,
    canRaise: false,
    callAmount: 0,
    minRaiseTo: 0,
    maxRaiseTo: 0,
    actingSeat: -1,
    actingMs: 0,
    turn: 7,
    buttonSeat: 0,
    smallBlindSeat: 0,
    bigBlindSeat: 1,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 3,
    reveals: [],
    handNotes: [],
    bluffCaughtSeat: -1,
    lastResult: "",
    players: [],
    ...over,
  };
}

describe("showdownPlan", () => {
  it("runs out only the cards that were not already on the table", () => {
    // Two players all-in preflop: the server dealt all five in one patch.
    const plan = showdownPlan(
      table({ board: ["As", "Kd", "7c", "2h", "9s"] }),
      0,
    );
    expect(plan.beats.filter((b) => b.kind === "board")).toHaveLength(5);

    // Called on the river: nothing left to deal, so nothing is dealt again.
    const late = showdownPlan(
      table({ board: ["As", "Kd", "7c", "2h", "9s"] }),
      5,
    );
    expect(late.beats.filter((b) => b.kind === "board")).toHaveLength(0);
  });

  it("turns the losing hands over before the winning one", () => {
    const plan = showdownPlan(
      table({
        players: [
          seat({ seat: 0, displayName: "Ana" }),
          seat({ seat: 1, sessionId: "b", displayName: "Bo" }),
        ],
        reveals: [
          reveal({ seat: 0, won: 400, description: "Flush, Ace high" }),
          reveal({ seat: 1, sessionId: "b", won: 0, description: "Two Pair" }),
        ],
      }),
      5,
    );
    expect(plan.hands.map((hand) => hand.seat)).toEqual([1, 0]);
    expect(plan.hands.map((hand) => hand.displayName)).toEqual(["Bo", "Ana"]);
  });

  it("names a seat whose player has already left the table", () => {
    const plan = showdownPlan(table({ reveals: [reveal({ seat: 3 })] }), 0);
    expect(plan.hands[0]!.displayName).toBe("Seat 4");
  });

  it("is one beat long when the hand was won on a fold", () => {
    const plan = showdownPlan(table({ board: ["As", "Kd", "7c"] }), 3);
    expect(plan.showdown).toBe(false);
    expect(plan.beats).toEqual([{ kind: "result" }]);
  });

  it("never invents a card the server did not publish", () => {
    const plan = showdownPlan(table({ board: ["As", "Kd", "7c"] }), 0);
    expect(plan.board).toEqual(["As", "Kd", "7c"]);
    expect(plan.hands).toHaveLength(0);
  });

  it("survives a board shorter than what this client had seen", () => {
    // A reconnect can land on a fresh hand after watching the last one out.
    const plan = showdownPlan(table({ board: ["As"] }), 5);
    expect(plan.boardShown).toBe(1);
    expect(plan.beats).toEqual([{ kind: "result" }]);
  });
});

describe("playing the plan", () => {
  const snapshot = table({
    board: ["As", "Kd", "7c", "2h", "9s"],
    players: [
      seat({ seat: 0, displayName: "Ana" }),
      seat({ seat: 1, sessionId: "b", displayName: "Bo" }),
    ],
    reveals: [
      reveal({ seat: 0, won: 400 }),
      reveal({ seat: 1, sessionId: "b", won: 0 }),
    ],
  });
  const plan = showdownPlan(snapshot, 3);

  it("deals the run-out one card at a time, in order", () => {
    // Three cards were already down, so beats 0 and 1 are the turn and river.
    expect(boardUp(plan, 0, 2)).toBe(true);
    expect(boardUp(plan, 0, 3)).toBe(false);
    expect(boardUp(plan, 1, 3)).toBe(true);
    expect(boardUp(plan, 1, 4)).toBe(false);
    expect(boardUp(plan, 2, 4)).toBe(true);
  });

  it("holds every hand face down until its own beat", () => {
    expect(handUp(plan, 2, 1)).toBe(false);
    expect(handUp(plan, 3, 1)).toBe(true);
    expect(handUp(plan, 3, 0)).toBe(false);
    expect(handUp(plan, 4, 0)).toBe(true);
  });

  it("names the winner last, and only once everything is face up", () => {
    expect(resultUp(plan, 4)).toBe(false);
    expect(resultUp(plan, 5)).toBe(true);
    // Skipping to the end is the same state, not a different one.
    expect(resultUp(plan, 99)).toBe(true);
  });

  it("takes long enough to be watched and short enough to sit through", () => {
    const ms = planDurationMs(plan);
    expect(ms).toBeGreaterThan(2_000);
    // Must fit inside the floor the server holds the next deal for.
    expect(ms).toBeLessThan(6_000);
  });
});

describe("waitingOn", () => {
  it("lists only seats that would be dealt into the next hand", () => {
    const names = waitingOn(
      table({
        players: [
          seat({ seat: 0, displayName: "Ana" }),
          seat({ seat: 1, sessionId: "b", displayName: "Bo", readyNext: true }),
          seat({ seat: 2, sessionId: "c", displayName: "Cy", connected: false }),
          seat({ seat: 3, sessionId: "d", displayName: "Di", sittingOut: true }),
          seat({ seat: 4, sessionId: "e", displayName: "Ed", stack: 0 }),
          seat({ seat: 5, sessionId: "f", displayName: "Fi", ready: false }),
        ],
      }),
    );
    expect(names).toEqual(["Ana"]);
  });

  it("counts chips that are waiting on the end of the hand", () => {
    const names = waitingOn(
      table({
        players: [
          seat({ seat: 0, displayName: "Ana", stack: 0, pendingBuyIn: 500 }),
        ],
      }),
    );
    expect(names).toEqual(["Ana"]);
  });

  it("says nothing outside a payout", () => {
    expect(
      waitingOn(table({ phase: TablePhase.Flop, players: [seat()] })),
    ).toEqual([]);
  });
});
