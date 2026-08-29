import { describe, expect, it } from "vitest";
import {
  cardToString,
  cardsFromString,
  makeDeck,
  type Card,
} from "./cards.js";
import {
  applyAction,
  forfeit,
  legalActions,
  nextButton,
  startHand,
  totalPot,
  type HandState,
} from "./engine.js";
import { shuffled, type RandomInt } from "./shuffle.js";

// --------------------------------------------------------------- test rig

/**
 * A generator that makes `shuffled()` produce exactly `target`.
 *
 * Fisher-Yates is invertible: at each step there is exactly one swap index
 * that puts the wanted card in place. Stacking the deck this way rather than
 * adding a `deck` option to `startHand` keeps the production surface honest -
 * there is no code path, even an unused one, that lets a caller choose cards.
 */
function stackedRandomInt(target: readonly Card[]): RandomInt {
  const work = makeDeck();
  const draws: number[] = [];
  for (let i = work.length - 1; i > 0; i--) {
    const j = work.indexOf(target[i]!);
    if (j < 0 || j > i) throw new Error("target is not a permutation");
    draws.push(j);
    const tmp = work[i]!;
    work[i] = work[j]!;
    work[j] = tmp;
  }
  let next = 0;
  return () => draws[next++]!;
}

/** Seats clockwise from the button, which is the order cards are pitched. */
function dealOrder(seats: readonly number[], button: number): number[] {
  const ring = [...seats].sort((a, b) => a - b);
  const start = ring.findIndex((s) => s > button);
  return start < 0 ? ring : [...ring.slice(start), ...ring.slice(0, start)];
}

/**
 * Build a deck that deals the given hole cards and board, with real unused
 * cards standing in for the burns.
 */
function arrangeDeck(
  seats: readonly number[],
  button: number,
  holes: Record<number, string>,
  board: string,
): Card[] {
  const used = new Set<Card>();
  const claim = (card: Card) => {
    if (used.has(card)) throw new Error(`card ${cardToString(card)} used twice`);
    used.add(card);
    return card;
  };

  const hole = new Map<number, Card[]>();
  for (const [seat, text] of Object.entries(holes)) {
    const cards = cardsFromString(text);
    if (cards.length !== 2) throw new Error(`seat ${seat} needs two cards`);
    cards.forEach(claim);
    hole.set(Number(seat), cards);
  }
  const boardCards = cardsFromString(board);
  if (boardCards.length !== 5) throw new Error("board needs five cards");
  boardCards.forEach(claim);

  const spare = makeDeck().filter((c) => !used.has(c));
  let spareIndex = 0;
  const burn = () => spare[spareIndex++]!;

  const deck: Card[] = [];
  const order = dealOrder(seats, button);
  for (let round = 0; round < 2; round++) {
    for (const seat of order) deck.push(hole.get(seat)![round]!);
  }
  deck.push(burn(), ...boardCards.slice(0, 3));
  deck.push(burn(), boardCards[3]!);
  deck.push(burn(), boardCards[4]!);
  while (deck.length < 52) deck.push(burn());
  return deck;
}

interface TableSpec {
  stacks: Record<number, number>;
  button: number;
  smallBlind?: number;
  bigBlind?: number;
  holes?: Record<number, string>;
  board?: string;
}

function table(spec: TableSpec): HandState {
  const seats = Object.keys(spec.stacks).map(Number).sort((a, b) => a - b);
  const players = seats.map((seat) => ({
    seat,
    playerId: `p${seat}`,
    stack: spec.stacks[seat]!,
  }));

  const randomInt =
    spec.holes && spec.board
      ? stackedRandomInt(
          arrangeDeck(seats, spec.button, spec.holes, spec.board),
        )
      : seededRandomInt(1234);

  return startHand({
    players,
    button: spec.button,
    smallBlind: spec.smallBlind ?? 5,
    bigBlind: spec.bigBlind ?? 10,
    handNumber: 1,
    randomInt,
  });
}

function seededRandomInt(seed: number): RandomInt {
  let state = seed >>> 0;
  return (maxExclusive) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % maxExclusive;
  };
}

const act = (state: HandState, seat: number, type: string, amount?: number) => {
  const outcome = applyAction(state, seat, {
    type: type as "fold" | "check" | "call" | "raise",
    ...(amount === undefined ? {} : { amount }),
  });
  if (!outcome.ok) throw new Error(`seat ${seat} ${type}: ${outcome.reason}`);
};

const holeOf = (state: HandState, seat: number) =>
  state.seats.get(seat)!.hole.map(cardToString).join(" ");

const stacks = (state: HandState) =>
  Object.fromEntries(
    [...state.seats.values()].map((s) => [s.seat, s.stack]),
  ) as Record<number, number>;

// ------------------------------------------------------------- deal rules

describe("dealing and blinds", () => {
  it("gives every seat two cards off one deck", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    const dealt = [...state.seats.values()].flatMap((s) => s.hole);
    expect(dealt).toHaveLength(6);
    expect(new Set(dealt).size).toBe(6);
    expect(state.deck).toHaveLength(52 - 6);
  });

  it("posts blinds and leaves the big blind live", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(state.seats.get(1)!.committed).toBe(5);
    expect(state.seats.get(2)!.committed).toBe(10);
    expect(state.currentBet).toBe(10);
    expect(totalPot(state)).toBe(15);
  });

  it("deals hole cards from the stacked deck as arranged", () => {
    const state = table({
      stacks: { 0: 500, 1: 500, 2: 500 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "2c 3d" },
      board: "7c 8d 9h Jc Qs",
    });
    expect(holeOf(state, 0)).toBe("As Ah");
    expect(holeOf(state, 1)).toBe("Ks Kh");
    expect(holeOf(state, 2)).toBe("2c 3d");
  });

  it("refuses a hand that cannot be played", () => {
    const one = [{ seat: 0, playerId: "a", stack: 100 }];
    expect(() =>
      startHand({
        players: one,
        button: 0,
        smallBlind: 5,
        bigBlind: 10,
        handNumber: 1,
        randomInt: seededRandomInt(1),
      }),
    ).toThrow(/at least two players/);
  });

  it("does not deal in a seat with no chips", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 0 }, button: 0 });
    expect(state.order).toEqual([0, 1]);
    expect(state.seats.has(2)).toBe(false);
  });
});

// ------------------------------------------------- heads-up blind inversion

describe("heads-up button and blind inversion", () => {
  it("makes the button the small blind and first to act preflop", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 0 });
    expect(state.seats.get(0)!.committed).toBe(5);
    expect(state.seats.get(1)!.committed).toBe(10);
    expect(state.actingSeat).toBe(0);
  });

  it("makes the big blind act first on every later street", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "check");
    expect(state.phase).toBe("flop");
    expect(state.actingSeat).toBe(1);
  });

  it("inverts again when the button moves", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 1 });
    expect(state.seats.get(1)!.committed).toBe(5);
    expect(state.seats.get(0)!.committed).toBe(10);
    expect(state.actingSeat).toBe(1);
  });

  it("keeps three-handed blinds to the button's left", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(state.seats.get(1)!.committed).toBe(5);
    expect(state.seats.get(2)!.committed).toBe(10);
    // Under the gun is the seat after the big blind, which wraps to the button.
    expect(state.actingSeat).toBe(0);
  });

  it("puts the small blind in first postflop three-handed", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "call");
    act(state, 2, "check");
    expect(state.phase).toBe("flop");
    expect(state.actingSeat).toBe(1);
  });

  it("gives the big blind the option to raise a limped pot", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "call");
    const option = legalActions(state, 2)!;
    expect(option.canCheck).toBe(true);
    expect(option.canRaise).toBe(true);
    expect(option.minRaiseTo).toBe(20);
  });

  it("rotates the button to the next occupied seat", () => {
    expect(nextButton([0, 2, 5], 0)).toBe(2);
    expect(nextButton([0, 2, 5], 2)).toBe(5);
    expect(nextButton([0, 2, 5], 5)).toBe(0);
    // A button on a seat that has since emptied moves on rather than sticking.
    expect(nextButton([0, 2, 5], 3)).toBe(5);
  });
});

// -------------------------------------------------------- min-raise rules

describe("min-raise", () => {
  it("sets the first raise at twice the big blind", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(legalActions(state, 0)!.minRaiseTo).toBe(20);
  });

  it("raises the floor by the size of the last raise", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    act(state, 0, "raise", 35); // a raise of 25 over the big blind
    expect(legalActions(state, 1)!.minRaiseTo).toBe(60);
  });

  it("rejects a raise below the floor", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(applyAction(state, 0, { type: "raise", amount: 15 })).toEqual({
      ok: false,
      reason: "raise must be between 20 and 500",
    });
  });

  it("rejects a raise beyond the stack", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(applyAction(state, 0, { type: "raise", amount: 501 }).ok).toBe(false);
  });

  it("rejects a fractional raise", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(applyAction(state, 0, { type: "raise", amount: 20.5 })).toEqual({
      ok: false,
      reason: "raise needs a whole-chip amount",
    });
  });

  it("rejects an action from a seat that is not to act", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(applyAction(state, 1, { type: "call" })).toEqual({
      ok: false,
      reason: "not your turn",
    });
  });

  it("rejects a check facing a bet", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(applyAction(state, 0, { type: "check" })).toEqual({
      ok: false,
      reason: "cannot check facing 10",
    });
  });

  it("allows an all-in raise below the floor when it is the whole stack", () => {
    // 18 behind cannot reach the floor of 20, so the floor collapses onto the
    // stack and shoving is the only raise available.
    const state = table({ stacks: { 0: 18, 1: 500, 2: 500 }, button: 0 });
    const legal = legalActions(state, 0)!;
    expect(legal.minRaiseTo).toBe(18);
    expect(legal.maxRaiseTo).toBe(18);
    act(state, 0, "raise", 18);
    expect(state.seats.get(0)!.status).toBe("allin");
  });
});

// ------------------------------------- the under-raise all-in reopening rule

describe("an all-in for less than a full raise does not reopen betting", () => {
  it("leaves a player who already acted with only call or fold", () => {
    const state = table({
      stacks: { 0: 1000, 1: 1000, 2: 35 },
      button: 0,
    });
    act(state, 0, "raise", 30); // a full raise of 20
    act(state, 1, "call");
    // Seat 2 has 35 behind including its blind, so its shove is a raise of 5:
    // short of the 20 needed to reopen.
    act(state, 2, "raise", 35);

    const legal = legalActions(state, 0)!;
    expect(legal.canCall).toBe(true);
    expect(legal.callAmount).toBe(5);
    expect(legal.canRaise).toBe(false);
  });

  it("still lets a player who has not acted yet raise", () => {
    const state = table({
      stacks: { 0: 35, 1: 1000, 2: 1000, 3: 1000 },
      button: 0,
    });
    // Preflop order is 3 (under the gun), 0, 1, 2.
    act(state, 3, "raise", 30);
    act(state, 0, "raise", 35); // short all-in, does not reopen
    const legal = legalActions(state, 1)!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(55);
    // The player it did not reopen for is still shut out.
    act(state, 1, "call");
    act(state, 2, "call");
    expect(legalActions(state, 3)!.canRaise).toBe(false);
  });

  it("does reopen when the all-in is a full raise", () => {
    const state = table({
      stacks: { 0: 1000, 1: 1000, 2: 60 },
      button: 0,
    });
    act(state, 0, "raise", 30);
    act(state, 1, "call");
    act(state, 2, "raise", 60); // a raise of 30, more than the 20 before it
    const legal = legalActions(state, 0)!;
    expect(legal.canRaise).toBe(true);
    expect(legal.minRaiseTo).toBe(90);
  });

  it("does reopen for a checker facing a sub-minimum opening bet", () => {
    // An opening bet is not a raise: there is no level anyone committed to, so
    // there is nothing to reopen and everyone gets a normal turn. Stripping the
    // check-raise off a player because the bet was small is not a rule anyone
    // plays by.
    const state = table({ stacks: { 0: 500, 1: 500, 2: 16 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "call");
    act(state, 2, "check");
    expect(state.phase).toBe("flop");

    act(state, 1, "check");
    act(state, 2, "raise", 6); // all-in for less than the big blind

    // Seat 0 had not acted this street, so it obviously keeps its rights.
    expect(legalActions(state, 0)!.canRaise).toBe(true);
    act(state, 0, "call");

    // Seat 1 checked, and that is the case this test exists for.
    const checker = legalActions(state, 1)!;
    expect(checker.canRaise).toBe(true);
    expect(checker.callAmount).toBe(6);
    // The floor is still measured off the big blind, not off the 6, so the
    // smallest raise is to 16 rather than to 12.
    expect(checker.minRaiseTo).toBe(16);
  });

  it("does not raise the floor off an under-raise", () => {
    const state = table({
      stacks: { 0: 1000, 1: 35, 2: 1000, 3: 1000 },
      button: 0,
    });
    act(state, 3, "raise", 30); // full raise of 20
    act(state, 0, "call");
    act(state, 1, "raise", 35); // under-raise all-in of 5
    // The next full raise is still measured off the 20, not the 5.
    expect(legalActions(state, 2)!.minRaiseTo).toBe(55);
  });
});

// ---------------------------------------------------------- short blinds

describe("a blind that cannot be covered", () => {
  it("puts the big blind all-in for what it has", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 4 }, button: 0 });
    expect(state.seats.get(2)!.committed).toBe(4);
    expect(state.seats.get(2)!.status).toBe("allin");
    // The amount to match is still the full big blind.
    expect(state.currentBet).toBe(10);
    expect(legalActions(state, 0)!.callAmount).toBe(10);
  });

  it("caps what heads-up owes at what the short blind can pay", () => {
    const state = table({ stacks: { 0: 500, 1: 3 }, button: 0 });
    // Seat 1 is the big blind, all-in for 3. Seat 0 already has 5 in as the
    // small blind, so it owes nothing and there is no one left to bet into.
    expect(state.seats.get(1)!.status).toBe("allin");
    expect(state.phase).toBe("complete");
    // The uncalled 2 goes back rather than into an uncontestable pot.
    expect(state.seats.get(0)!.totalCommitted).toBe(3);
    expect(stacks(state)[0]! + stacks(state)[1]!).toBe(503);
  });

  it("returns the small blind's overage when the big blind is shorter", () => {
    const state = table({
      stacks: { 0: 500, 1: 3 },
      button: 0,
      holes: { 0: "2c 3d", 1: "As Ah" },
      board: "7c 8d 9h Jc Qs",
    });
    // Seat 1's aces hold, so it wins the 6 it could contest.
    expect(state.seats.get(1)!.stack).toBe(6);
    expect(state.seats.get(0)!.stack).toBe(497);
  });
});

// ----------------------------------------------------------- side pots

describe("side pots", () => {
  it("splits a three-way multi-all-in into the right ladder", () => {
    const state = table({
      stacks: { 0: 50, 1: 120, 2: 300 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "2c 3d" },
      board: "7c 8d 9h Jc Qs",
    });

    act(state, 0, "raise", 50); // all-in
    act(state, 1, "raise", 120); // all-in over the top
    act(state, 2, "call");

    expect(state.phase).toBe("complete");
    expect(state.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 140, eligible: [1, 2] },
    ]);

    // Aces take the main pot they were eligible for; kings take the side pot
    // the short stack could not reach.
    expect(stacks(state)).toEqual({ 0: 150, 1: 140, 2: 180 });
    expect(state.result!.showdown.map((s) => s.seat)).toEqual([0, 1, 2]);
  });

  it("lets a short stack win only the pot it paid into", () => {
    const state = table({
      stacks: { 0: 50, 1: 300, 2: 300 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "Qs Qh" },
      board: "7c 8d 2h Jc 4s",
    });

    act(state, 0, "raise", 50);
    act(state, 1, "raise", 200);
    act(state, 2, "call");
    act(state, 1, "check");
    act(state, 2, "check");
    act(state, 1, "check");
    act(state, 2, "check");
    act(state, 1, "check");
    act(state, 2, "check");

    expect(state.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
    // Aces win the main pot. Kings beat queens for the side pot.
    expect(stacks(state)).toEqual({ 0: 150, 1: 400, 2: 100 });
  });

  it("keeps folded chips in the pot without a claim on it", () => {
    const state = table({
      stacks: { 0: 500, 1: 500, 2: 500 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "2c 3d" },
      board: "7c 8d 9h Jc Qs",
    });
    act(state, 0, "call"); // 10
    act(state, 1, "call"); // 10
    act(state, 2, "check");
    act(state, 1, "raise", 40);
    act(state, 2, "fold"); // seat 2 leaves 10 behind
    act(state, 0, "call");
    act(state, 1, "check"); // turn
    act(state, 0, "check");
    act(state, 1, "check"); // river
    act(state, 0, "check");

    // Seat 2's 10 is in the pot; seat 2 is not in the eligible set.
    expect(state.pots).toEqual([{ amount: 110, eligible: [0, 1] }]);
    expect(stacks(state)).toEqual({ 0: 560, 1: 450, 2: 490 });
  });
});

// ------------------------------------------------------- split and odd chip

describe("split pots", () => {
  it("splits evenly when two players play the same board", () => {
    const state = table({
      stacks: { 0: 500, 1: 500 },
      button: 0,
      holes: { 0: "2c 3d", 1: "2h 3s" },
      board: "As Ks Qh Jc 9d",
    });
    act(state, 0, "call");
    act(state, 1, "check");
    for (let street = 0; street < 3; street++) {
      act(state, 1, "check");
      act(state, 0, "check");
    }
    expect(state.phase).toBe("complete");
    expect(stacks(state)).toEqual({ 0: 500, 1: 500 });
    expect(state.result!.awards).toHaveLength(2);
  });

  it("gives the odd chip to the first winner left of the button", () => {
    // The folded small blind leaves 5 dead in the pot, so 55 has to split two
    // ways. Somebody has to get chip 28.
    const state = table({
      stacks: { 0: 500, 1: 500, 2: 500 },
      button: 0,
      holes: { 0: "2c 3d", 1: "7c 7d", 2: "2h 3s" },
      board: "As Ks Qh Jc 9d",
    });
    act(state, 0, "raise", 25);
    act(state, 1, "fold"); // small blind, 5 in
    act(state, 2, "call");
    for (let street = 0; street < 3; street++) {
      act(state, 2, "check");
      act(state, 0, "check");
    }

    expect(state.pots).toEqual([{ amount: 55, eligible: [0, 2] }]);
    // Button is seat 0, so the walk is 1, 2, 0 and seat 2 is the first winner
    // it reaches.
    expect(stacks(state)).toEqual({ 0: 502, 1: 495, 2: 503 });
    expect(Object.values(stacks(state)).reduce((a, b) => a + b, 0)).toBe(1500);
  });

  it("moves the odd chip with the button", () => {
    const state = table({
      stacks: { 0: 500, 1: 500, 2: 500 },
      button: 1,
      holes: { 0: "2c 3d", 1: "2h 3s", 2: "7c 7d" },
      board: "As Ks Qh Jc 9d",
    });
    // Button seat 1, so small blind is seat 2, big blind seat 0, and seat 1
    // acts first preflop.
    act(state, 1, "raise", 25);
    act(state, 2, "fold"); // small blind, 5 in
    act(state, 0, "call");
    for (let street = 0; street < 3; street++) {
      act(state, 0, "check");
      act(state, 1, "check");
    }

    expect(state.pots).toEqual([{ amount: 55, eligible: [0, 1] }]);
    // Walk from seat 1 is 2, 0, 1: seat 0 is the first winner reached.
    expect(stacks(state)).toEqual({ 0: 503, 1: 502, 2: 495 });
  });
});

// ------------------------------------------------------------ fold wins

describe("winning without a showdown", () => {
  it("ends the hand and reveals nothing when everyone folds", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    act(state, 0, "raise", 30);
    act(state, 1, "fold");
    act(state, 2, "fold");

    expect(state.phase).toBe("complete");
    expect(state.board).toEqual([]);
    expect(state.result!.showdown).toEqual([]);
    // 500 + 5 + 10 taken, 30 of its own returned uncalled.
    expect(stacks(state)).toEqual({ 0: 515, 1: 495, 2: 490 });
  });

  it("returns an uncalled bet before awarding the pot", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "check");
    act(state, 1, "raise", 200);
    act(state, 0, "fold");
    // Seat 1 gets its uncalled 200 back and wins the 20 that was contested.
    expect(stacks(state)).toEqual({ 0: 490, 1: 510 });
  });

  it("stops accepting actions once the hand is over", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 0 });
    act(state, 0, "raise", 500);
    act(state, 1, "fold");
    expect(applyAction(state, 0, { type: "check" })).toEqual({
      ok: false,
      reason: "hand is over",
    });
  });
});

// -------------------------------------------------- abandoning a seat

describe("a player who abandons the seat", () => {
  it("cannot take a bet back out of the pot by leaving", () => {
    // A bet cannot be withdrawn by folding. If it could, anyone could unbet by
    // closing their laptop and hand the pot to the next player as though the
    // bet had never happened.
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "call");
    act(state, 2, "check");
    expect(state.phase).toBe("flop");

    act(state, 1, "raise", 300);
    forfeit(state, 1); // seat 1 closes its laptop with 300 uncalled
    expect(state.seats.get(1)!.status).toBe("folded");

    act(state, 2, "fold");
    expect(state.phase).toBe("complete");

    // The 300 stays in the pot and seat 0 wins it along with the preflop 30.
    expect(state.seats.get(1)!.totalCommitted).toBe(310);
    expect(state.pots).toEqual([{ amount: 330, eligible: [0] }]);
    expect(stacks(state)).toEqual({ 0: 820, 1: 190, 2: 490 });
  });

  it("forfeits a blind it walked away from", () => {
    const state = table({ stacks: { 0: 500, 1: 500, 2: 500 }, button: 0 });
    expect(state.actingSeat).toBe(0);

    forfeit(state, 2); // the big blind leaves
    act(state, 0, "fold");
    expect(state.phase).toBe("complete");

    // The blind is a live bet, so the small blind wins all 15 rather than
    // watching 5 of it walk back out of the pot.
    expect(state.seats.get(2)!.totalCommitted).toBe(10);
    expect(stacks(state)).toEqual({ 0: 500, 1: 510, 2: 490 });
  });

  it("leaves an all-in seat alone: its chips already bought it a claim", () => {
    const state = table({
      stacks: { 0: 60, 1: 500, 2: 500 },
      button: 0,
      holes: { 0: "As Ah", 1: "Ks Kh", 2: "2c 3d" },
      board: "7c 8d 9h Jc Qs",
    });
    act(state, 0, "raise", 60);
    act(state, 1, "call");
    act(state, 2, "fold");

    forfeit(state, 0); // all-in, so this must be a no-op
    expect(state.seats.get(0)!.status).toBe("allin");

    while (!state.result) act(state, state.actingSeat!, "check");
    // Aces still win the pot they paid for.
    expect(stacks(state)).toEqual({ 0: 130, 1: 440, 2: 490 });
  });

  it("cannot 3-bet big, pull the plug, and get the money back", () => {
    // The exploit shape the minimal case above generalises to, on
    // non-contiguous seats so the ring walk is exercised too. Seat 4 three-bets
    // to 471, disconnects, and must not reclaim the 299 it had already wagered
    // once the pot ends up uncontested.
    const state = table({
      stacks: { 0: 235, 1: 184, 4: 490, 5: 491 },
      button: 4,
    });
    // Button 4, so seat 5 is the small blind, seat 0 the big blind, seat 1 opens.
    expect(state.actingSeat).toBe(1);

    act(state, 1, "raise", 172);
    act(state, 4, "raise", 471);
    forfeit(state, 4);
    act(state, 5, "fold");
    forfeit(state, 0);

    expect(state.phase).toBe("complete");
    expect(state.seats.get(4)!.totalCommitted).toBe(471);
    expect(state.pots).toEqual([{ amount: 658, eligible: [1] }]);
    expect(stacks(state)).toEqual({ 0: 225, 1: 670, 4: 19, 5: 486 });
    // Nothing appeared or vanished on the way.
    expect(Object.values(stacks(state)).reduce((a, b) => a + b, 0)).toBe(1400);
  });

  it("resolves a pot that every staked seat folded out of", () => {
    // Both blinds walk away and the last caller folds, leaving a seat that
    // never staked a chip as the only contender. `buildPots` cannot name an
    // eligible seat for that money; the engine resolves it before publishing,
    // so the ladder never goes out with nobody listed against a pot.
    const state = table({
      stacks: { 1: 276, 2: 57, 4: 463, 5: 106 },
      button: 4,
    });
    forfeit(state, 5); // small blind
    act(state, 2, "fold");
    forfeit(state, 1); // big blind

    expect(state.phase).toBe("complete");
    expect(state.pots).toEqual([{ amount: 15, eligible: [4] }]);
    expect(state.seats.get(4)!.stack).toBe(478);
  });

  it("still refunds a live player whose bet nobody could cover", () => {
    // The refund did not go away, it just stopped paying folded seats.
    const state = table({ stacks: { 0: 500, 1: 40, 2: 500 }, button: 0 });
    act(state, 0, "raise", 200);
    act(state, 1, "call"); // all-in for 40
    act(state, 2, "fold");
    // Seat 0 gets back everything above what seat 1 could ever call.
    expect(state.seats.get(0)!.totalCommitted).toBe(40);
    expect(totalPot(state)).toBe(90);
  });
});

// ------------------------------------------------------ a complete hand

describe("a full hand end to end", () => {
  it("plays all four streets and pays the better hand", () => {
    const state = table({
      stacks: { 0: 500, 1: 500 },
      button: 0,
      holes: { 0: "As Ad", 1: "Kh Kd" },
      board: "2c 7d 9h Jc 4s",
    });

    expect(state.phase).toBe("preflop");
    act(state, 0, "call");
    act(state, 1, "check");

    expect(state.phase).toBe("flop");
    expect(state.board).toHaveLength(3);
    act(state, 1, "raise", 20);
    act(state, 0, "call");

    expect(state.phase).toBe("turn");
    expect(state.board).toHaveLength(4);
    act(state, 1, "check");
    act(state, 0, "raise", 40);
    act(state, 1, "call");

    expect(state.phase).toBe("river");
    expect(state.board).toHaveLength(5);
    act(state, 1, "check");
    act(state, 0, "check");

    expect(state.phase).toBe("complete");
    const result = state.result!;
    expect(result.showdown[0]!.seat).toBe(0);
    expect(result.showdown[0]!.description).toBe("Pair of Aces");
    expect(stacks(state)).toEqual({ 0: 570, 1: 430 });
    expect(result.net.get(0)).toBe(70);
    expect(result.net.get(1)).toBe(-70);
  });
});

// ----------------------------------------------------------- invariants

describe("chip conservation", () => {
  /** Play a hand out with random legal choices. */
  function playRandomHand(seed: number): { before: number; after: number } {
    const rng = seededRandomInt(seed);
    const seats = [0, 1, 2, 3].filter(() => rng(4) > 0);
    if (seats.length < 2) seats.push(0, 1);
    const unique = [...new Set(seats)].sort((a, b) => a - b);

    const players = unique.map((seat) => ({
      seat,
      playerId: `p${seat}`,
      // A spread of stacks, deliberately including some short enough to be
      // all-in on the blinds, which is where the ladder gets interesting.
      stack: 8 + rng(400),
    }));
    const before = players.reduce((sum, p) => sum + p.stack, 0);

    const state = startHand({
      players,
      button: unique[rng(unique.length)]!,
      smallBlind: 5,
      bigBlind: 10,
      handNumber: seed,
      randomInt: rng,
    });

    let guard = 0;
    while (state.actingSeat !== null && !state.result) {
      if (guard++ > 500) throw new Error("hand did not terminate");
      const seat = state.actingSeat;
      const legal = legalActions(state, seat)!;
      const choices: { type: string; amount?: number }[] = [{ type: "fold" }];
      if (legal.canCheck) choices.push({ type: "check" });
      if (legal.canCall) choices.push({ type: "call" });
      if (legal.canRaise) {
        const span = legal.maxRaiseTo - legal.minRaiseTo;
        choices.push({
          type: "raise",
          amount: legal.minRaiseTo + (span > 0 ? rng(span + 1) : 0),
        });
        choices.push({ type: "raise", amount: legal.maxRaiseTo });
      }
      const pick = choices[rng(choices.length)]!;
      const outcome = applyAction(state, seat, pick as never);
      if (!outcome.ok) throw new Error(`illegal choice offered: ${outcome.reason}`);

      // Pots are only built at the end, but contributions must never exceed
      // what was brought to the table at any point in between.
      expect(totalPot(state)).toBeLessThanOrEqual(before);
    }

    expect(state.result).not.toBeNull();
    const potted = state.pots.reduce((sum, p) => sum + p.amount, 0);
    const contributed = [...state.seats.values()].reduce(
      (sum, s) => sum + s.totalCommitted,
      0,
    );
    // The standing invariant from the plan, on every hand.
    expect(potted).toBe(contributed);

    const after = [...state.seats.values()].reduce((sum, s) => sum + s.stack, 0);
    return { before, after };
  }

  it("conserves chips across a thousand random hands", () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const { before, after } = playRandomHand(seed);
      expect(after).toBe(before);
    }
  });

  it("never leaves a stack negative or a pot unassigned", () => {
    for (let seed = 5000; seed < 5200; seed++) {
      playRandomHand(seed);
    }
  });

  /**
   * The same fuzz, with players abandoning their seats at random.
   *
   * The version above never calls `forfeit`, and that gap is exactly how the
   * refund bug survived: chips were conserved and the pots summed correctly,
   * they were simply handed to the wrong player. The assertion that catches it
   * is not about totals at all - it is that a seat which has folded can never
   * see its contribution shrink.
   */
  function playWithLeavers(seed: number): void {
    const rng = seededRandomInt(seed);
    const count = 2 + rng(4);
    const seats = [0, 1, 3, 4, 6].slice(0, count);
    const players = seats.map((seat) => ({
      seat,
      playerId: `p${seat}`,
      stack: 8 + rng(400),
    }));
    const before = players.reduce((sum, p) => sum + p.stack, 0);

    const state = startHand({
      players,
      button: seats[rng(seats.length)]!,
      smallBlind: 5,
      bigBlind: 10,
      handNumber: seed,
      randomInt: rng,
    });

    // Highest contribution each folded seat ever reached. Once you fold, your
    // chips belong to the pot; this must never go down.
    const peakWhileFolded = new Map<number, number>();
    const record = () => {
      for (const seat of state.seats.values()) {
        if (seat.status !== "folded") continue;
        const seen = peakWhileFolded.get(seat.seat) ?? 0;
        expect(seat.totalCommitted).toBeGreaterThanOrEqual(seen);
        peakWhileFolded.set(seat.seat, Math.max(seen, seat.totalCommitted));
      }
    };

    let guard = 0;
    while (state.actingSeat !== null && !state.result) {
      if (guard++ > 500) throw new Error("hand did not terminate");

      // Roughly one seat in eight walks away on any given turn.
      if (rng(8) === 0) {
        const victim = state.order[rng(state.order.length)]!;
        forfeit(state, victim);
        record();
        if (state.result) break;
        continue;
      }

      const seat = state.actingSeat;
      const legal = legalActions(state, seat)!;
      const choices: { type: string; amount?: number }[] = [{ type: "fold" }];
      if (legal.canCheck) choices.push({ type: "check" });
      if (legal.canCall) choices.push({ type: "call" });
      if (legal.canRaise) {
        const span = legal.maxRaiseTo - legal.minRaiseTo;
        choices.push({
          type: "raise",
          amount: legal.minRaiseTo + (span > 0 ? rng(span + 1) : 0),
        });
        choices.push({ type: "raise", amount: legal.maxRaiseTo });
      }
      const outcome = applyAction(state, seat, choices[rng(choices.length)] as never);
      if (!outcome.ok) throw new Error(`illegal choice offered: ${outcome.reason}`);
      record();
    }

    expect(state.result).not.toBeNull();

    const potted = state.pots.reduce((sum, p) => sum + p.amount, 0);
    const contributed = [...state.seats.values()].reduce(
      (sum, s) => sum + s.totalCommitted,
      0,
    );
    expect(potted).toBe(contributed);
    // Every pot names someone who can win it by the time it is published.
    for (const pot of state.pots) expect(pot.eligible.length).toBeGreaterThan(0);

    const after = [...state.seats.values()].reduce((sum, s) => sum + s.stack, 0);
    expect(after).toBe(before);
  }

  it("holds up when players abandon their seats mid-hand", () => {
    for (let seed = 1; seed <= 4000; seed++) playWithLeavers(seed);
  });
});

describe("the deck never leaves as state", () => {
  it("keeps the stub and the burns out of anything a mirror would read", () => {
    const state = table({ stacks: { 0: 500, 1: 500 }, button: 0 });
    act(state, 0, "call");
    act(state, 1, "check");
    // The room mirrors board, pots, stacks and each seat's own hole cards.
    // Everything else here is server-only, asserted so a future refactor that
    // widens the mirror has to come through this test.
    expect(state.deck.length + state.burned.length + state.board.length).toBe(
      52 - 4,
    );
    expect(state.burned.length).toBe(1);
  });
});

// A permutation check on the rig itself: if `stackedRandomInt` were wrong,
// every stacked-deck test above would be quietly testing the wrong cards.
describe("the test rig", () => {
  it("produces exactly the deck it was asked for", () => {
    const target = shuffled(makeDeck(), seededRandomInt(99));
    expect(shuffled(makeDeck(), stackedRandomInt(target))).toEqual(target);
  });
});
