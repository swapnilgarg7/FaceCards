import { describe, expect, it } from "vitest";
import { MIN_PLAYERS, SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { startGate } from "./startGate.js";

function seat(over: Partial<SeatSnapshot> = {}): SeatSnapshot {
  return {
    sessionId: "a",
    displayName: "A",
    avatar: "cowboy",
    seat: 0,
    connected: true,
    ready: false,
    readyNext: false,
    sittingOut: false,
    stack: 1000,
    bet: 0,
    totalBuyIn: 1000,
    pendingBuyIn: 0,
    handsPlayed: 0,
    handsWon: 0,
    owesBlind: false,
    status: SeatStatus.Waiting,
    cardCount: 0,
    ...over,
  };
}

function table(players: SeatSnapshot[], handNumber = 0): RoomSnapshot {
  return {
    code: "ABCDEF",
    phase: handNumber > 0 ? TablePhase.Preflop : TablePhase.Waiting,
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
    turn: 0,
    buttonSeat: -1,
    smallBlindSeat: -1,
    bigBlindSeat: -1,
    smallBlind: 5,
    bigBlind: 10,
    handNumber,
    reveals: [],
    handNotes: [],
    bluffCaughtSeat: -1,
    lastResult: "",
    players,
  };
}

describe("holding the first deal", () => {
  it("holds the table until this player presses Play", () => {
    const me = seat({ sessionId: "me" });
    const gate = startGate(table([me, seat({ sessionId: "b", ready: true })]), me);
    expect(gate.show).toBe(true);
    expect(gate.canPlay).toBe(true);
    expect(gate.started).toBe(false);
  });

  it("keeps holding it while there is nobody to play against", () => {
    // Ready, and alone. Pressing Play does not conjure an opponent, so the
    // gate stays up and says what it is waiting for instead of pretending a
    // hand is about to happen.
    const me = seat({ sessionId: "me", ready: true });
    const gate = startGate(table([me]), me);
    expect(gate.show).toBe(true);
    expect(gate.canPlay).toBe(false);
    expect(gate.needed).toBe(MIN_PLAYERS - 1);
  });

  it("gets out of the way as soon as the table can deal", () => {
    // The two seconds between the last player readying up and the first card
    // belong to the action bar saying "Dealing", not to a satisfied gate.
    const me = seat({ sessionId: "me", ready: true });
    const gate = startGate(
      table([me, seat({ sessionId: "b", ready: true })]),
      me,
    );
    expect(gate.show).toBe(false);
    expect(gate.needed).toBe(0);
  });

  it("names who the ready players are still waiting on", () => {
    const me = seat({ sessionId: "me", displayName: "Me", ready: true });
    const gate = startGate(
      table([
        me,
        seat({ sessionId: "b", displayName: "Bea" }),
        seat({ sessionId: "c", displayName: "Cal" }),
      ]),
      me,
    );
    // Three seated, one ready: not enough to deal, and the two who have not
    // pressed Play are named rather than counted.
    expect(gate.show).toBe(true);
    expect(gate.waitingOn).toEqual(["Bea", "Cal"]);
    expect(gate.ready).toBe(1);
    expect(gate.seated).toBe(3);
  });

  it("never lists this player among the people being waited on", () => {
    const me = seat({ sessionId: "me", displayName: "Me" });
    const gate = startGate(table([me, seat({ sessionId: "b", ready: true })]), me);
    expect(gate.waitingOn).toEqual([]);
  });
});

describe("joining a table already playing", () => {
  it("asks a late arrival to be dealt in rather than to start anything", () => {
    const me = seat({ sessionId: "me" });
    const gate = startGate(
      table([me, seat({ sessionId: "b", ready: true })], 12),
      me,
    );
    expect(gate.show).toBe(true);
    expect(gate.canPlay).toBe(true);
    expect(gate.started).toBe(true);
  });

  it("leaves a player who is already in the game alone", () => {
    // The gate is on starting, not on every hand. Once you are ready you stay
    // ready and the table deals itself.
    const me = seat({ sessionId: "me", ready: true });
    const gate = startGate(
      table([me, seat({ sessionId: "b", ready: true })], 12),
      me,
    );
    expect(gate.show).toBe(false);
  });

  it("shows nothing at all to a client with no seat", () => {
    expect(startGate(table([]), undefined).show).toBe(false);
  });
});
