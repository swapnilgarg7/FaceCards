import { describe, expect, it } from "vitest";
import { SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { contestedChips, isInHand, leaderboard } from "./standings.js";

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
    turn: 1,
    buttonSeat: 0,
    smallBlindSeat: 1,
    bigBlindSeat: 2,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 4,
    reveals: [],
    lastResult: "",
    players: [],
    ...over,
  };
}

describe("profit", () => {
  it("is the stack minus every chip brought to the table", () => {
    const rows = leaderboard(
      table({
        players: [
          seat({ sessionId: "a", seat: 0, stack: 1400, totalBuyIn: 1000 }),
          // Rebought once and is still down, even though the stack looks
          // healthy. This is the whole reason the buy-in column exists.
          seat({ sessionId: "b", seat: 1, stack: 1200, totalBuyIn: 2000 }),
        ],
      }),
      "a",
    );
    expect(rows.map((r) => [r.displayName, r.profit])).toEqual([
      ["A", 400],
      ["A", -800],
    ]);
    expect(rows[0]!.rank).toBe(1);
    expect(rows[1]!.rank).toBe(2);
  });

  it("counts a chip that is out in front as spent until the pot comes back", () => {
    // Your stack is your stack. A bet that is still being contested is not
    // yours, and pretending otherwise would mean guessing at a result.
    const rows = leaderboard(
      table({
        players: [seat({ stack: 900, bet: 100, totalBuyIn: 1000 })],
      }),
      "a",
    );
    expect(rows[0]!.chips).toBe(900);
    expect(rows[0]!.committed).toBe(100);
    expect(rows[0]!.profit).toBe(-100);
  });

  it("does not move when chips bought mid-hand finally land", () => {
    // Both halves of the sum change together, so the profit column does not
    // flicker at the deal. This is why a pending buy-in is charged to nobody
    // until it arrives.
    const waiting = leaderboard(
      table({ players: [seat({ stack: 0, pendingBuyIn: 800, totalBuyIn: 1000 })] }),
      "a",
    );
    const landed = leaderboard(
      table({ players: [seat({ stack: 800, pendingBuyIn: 0, totalBuyIn: 1800 })] }),
      "a",
    );
    expect(waiting[0]!.profit).toBe(-1000);
    expect(landed[0]!.profit).toBe(-1000);
    expect(waiting[0]!.pending).toBe(800);
    expect(landed[0]!.pending).toBe(0);
  });
});

describe("ordering", () => {
  it("puts the biggest winner first and shares a place on a tie", () => {
    const rows = leaderboard(
      table({
        players: [
          seat({ sessionId: "a", seat: 0, stack: 500, totalBuyIn: 1000 }),
          seat({ sessionId: "b", seat: 1, stack: 1500, totalBuyIn: 1000 }),
          seat({ sessionId: "c", seat: 2, stack: 1500, totalBuyIn: 1000 }),
          seat({ sessionId: "d", seat: 3, stack: 900, totalBuyIn: 1000 }),
        ],
      }),
      "a",
    );
    expect(rows.map((r) => r.sessionId)).toEqual(["b", "c", "d", "a"]);
    // Joint first, then the next place skips to third.
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
  });

  it("breaks a dead tie by seat, so rows do not swap on every patch", () => {
    const players = [
      seat({ sessionId: "b", seat: 3 }),
      seat({ sessionId: "a", seat: 1 }),
    ];
    const once = leaderboard(table({ players }), "a");
    const again = leaderboard(table({ players: [...players].reverse() }), "a");
    expect(once.map((r) => r.seat)).toEqual([1, 3]);
    expect(again.map((r) => r.seat)).toEqual([1, 3]);
  });
});

describe("what a seat is doing", () => {
  it("names what a seat is doing", () => {
    const note = (over: Partial<SeatSnapshot>) =>
      leaderboard(table({ players: [seat(over)] }), "x")[0]!.note;

    expect(note({})).toBe("playing");
    expect(note({ connected: false })).toBe("away");
    expect(note({ status: SeatStatus.AllIn, stack: 0 })).toBe("all-in");
    expect(note({ status: SeatStatus.Folded })).toBe("folded");
    expect(note({ status: SeatStatus.Waiting, stack: 0 })).toBe("busted");
    expect(
      note({ status: SeatStatus.Waiting, stack: 0, pendingBuyIn: 500 }),
    ).toBe("buying-in");
    expect(note({ sittingOut: true })).toBe("sitting-out");
    expect(note({ owesBlind: true })).toBe("waiting-for-blind");
  });

  it("puts being away ahead of every other reason", () => {
    // Someone waiting on the table wants to know the seat is empty before
    // they want to know why it was going to be dealt out anyway.
    const rows = leaderboard(
      table({
        players: [seat({ connected: false, sittingOut: true, stack: 0 })],
      }),
      "x",
    );
    expect(rows[0]!.note).toBe("away");
  });

  it("does not call an all-in seat busted", () => {
    // Nothing behind the seat, but every one of those chips is in the pot and
    // can still come back. Calling it "out of chips" would be a lie the player
    // is about to be proved right or wrong about.
    const rows = leaderboard(
      table({ players: [seat({ status: SeatStatus.AllIn, stack: 0 })] }),
      "x",
    );
    expect(rows[0]!.note).toBe("all-in");
  });

  it("marks the button, the blinds and the seat on the clock", () => {
    const rows = leaderboard(
      table({
        buttonSeat: 1,
        smallBlindSeat: 2,
        bigBlindSeat: 0,
        actingSeat: 0,
        players: [
          seat({ seat: 0 }),
          seat({ sessionId: "b", seat: 1 }),
          seat({ sessionId: "c", seat: 2 }),
        ],
      }),
      "a",
    );
    const bySeat = new Map(rows.map((r) => [r.seat, r]));
    expect(bySeat.get(0)!.acting).toBe(true);
    expect(bySeat.get(0)!.onButton).toBe(false);
    expect(bySeat.get(0)!.blind).toBe("BB");
    expect(bySeat.get(1)!.onButton).toBe(true);
    expect(bySeat.get(1)!.blind).toBe("");
    expect(bySeat.get(2)!.blind).toBe("SB");
  });

  it("shows no small blind at all when it was dead", () => {
    // -1 is a real answer, not a missing one: the seat that owed it left, so
    // nobody posted it. It must not land on seat -1 or on anybody else.
    const rows = leaderboard(
      table({
        smallBlindSeat: -1,
        bigBlindSeat: 1,
        players: [seat({ seat: 0 }), seat({ sessionId: "b", seat: 1 })],
      }),
      "a",
    );
    expect(rows.map((r) => r.blind).filter(Boolean)).toEqual(["BB"]);
  });

  it("carries a showdown onto the row that made it", () => {
    const rows = leaderboard(
      table({
        players: [seat({ seat: 0 }), seat({ sessionId: "b", seat: 1 })],
        reveals: [
          {
            sessionId: "b",
            seat: 1,
            cards: ["As", "Ah"],
            best: ["As", "Ah", "Ad", "7c", "2d"],
            description: "Three of a Kind, Aces",
            won: 400,
          },
        ],
      }),
      "a",
    );
    const bySeat = new Map(rows.map((r) => [r.seat, r]));
    expect(bySeat.get(0)!.reveal).toBeNull();
    expect(bySeat.get(1)!.reveal?.description).toBe("Three of a Kind, Aces");
    expect(bySeat.get(1)!.reveal?.won).toBe(400);
  });

  it("knows which row is yours", () => {
    const rows = leaderboard(
      table({
        players: [seat({ sessionId: "a", seat: 0 }), seat({ sessionId: "b", seat: 1 })],
      }),
      "b",
    );
    expect(rows.filter((r) => r.isMe).map((r) => r.sessionId)).toEqual(["b"]);
  });
});

describe("chips on the felt", () => {
  it("is the pot while a hand is running and nothing between hands", () => {
    expect(contestedChips(table({ phase: TablePhase.Flop, pot: 240 }))).toBe(240);
    expect(contestedChips(table({ phase: TablePhase.Waiting, pot: 0 }))).toBe(0);
  });
});

describe("whether a buy-in has to wait", () => {
  it("waits for a seat that is in the hand, folded ones included", () => {
    // Folding does not end table stakes for the hand: the chips arrive when
    // the hand does, not when you stop being interested in it.
    for (const status of [SeatStatus.Active, SeatStatus.AllIn, SeatStatus.Folded]) {
      expect(isInHand(table({ phase: TablePhase.Turn }), seat({ status }))).toBe(
        true,
      );
    }
  });

  it("does not wait between hands, or for a seat that was dealt out", () => {
    expect(isInHand(table({ phase: TablePhase.Waiting }), seat())).toBe(false);
    expect(isInHand(table({ phase: TablePhase.Payout }), seat())).toBe(false);
    expect(
      isInHand(table({ phase: TablePhase.Flop }), seat({ status: SeatStatus.Waiting })),
    ).toBe(false);
    expect(isInHand(table(), undefined)).toBe(false);
  });
});
