import { describe, expect, it } from "vitest";
import {
  cardToString,
  cardsFromString,
  makeDeck,
  type Card,
} from "./cards.js";
import { applyAction, startHand, type HandState } from "./engine.js";
import { HandCategory } from "./evaluate.js";
import { shuffled, type RandomInt } from "./shuffle.js";
import { handStory } from "./story.js";

/**
 * The story of a hand, told from a stacked deck.
 *
 * Same rig as `engine.test.ts` - a `RandomInt` reverse-engineered so the
 * shuffle produces exactly the deck we want - because the interesting
 * classifications here (a bluff that got called, a hand that was in front at
 * the turn and lost on the river) cannot be reached by playing random cards
 * until one turns up.
 *
 * The test that matters most is the last one: a hand won on folds publishes
 * nothing about anybody's cards.
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

function dealOrder(seats: readonly number[], button: number): number[] {
  const ring = [...seats].sort((a, b) => a - b);
  const start = ring.findIndex((s) => s > button);
  return start < 0 ? ring : [...ring.slice(start), ...ring.slice(0, start)];
}

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
    cards.forEach(claim);
    hole.set(Number(seat), cards);
  }
  const boardCards = cardsFromString(board);
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

function table(spec: {
  stacks: Record<number, number>;
  button: number;
  holes: Record<number, string>;
  board: string;
}): HandState {
  const seats = Object.keys(spec.stacks).map(Number).sort((a, b) => a - b);
  return startHand({
    players: seats.map((seat) => ({
      seat,
      playerId: `p${seat}`,
      stack: spec.stacks[seat]!,
    })),
    button: spec.button,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 1,
    randomInt: stackedRandomInt(
      arrangeDeck(seats, spec.button, spec.holes, spec.board),
    ),
  });
}

function seatOf(state: HandState, seat: number) {
  return handStory(state).seats.find((s) => s.seat === seat)!;
}

/** Heads-up: seat 0 is the button and small blind, seat 1 the big blind. */
function headsUp(holes: Record<number, string>, board: string, stacks = 1000) {
  return table({
    stacks: { 0: stacks, 1: stacks },
    button: 0,
    holes,
    board,
  });
}

describe("handStory", () => {
  it("is empty for a hand that has not finished", () => {
    const state = headsUp({ 0: "As Ks", 1: "7d 2c" }, "2h 9c 4d Js Qh");
    expect(handStory(state)).toEqual({ seats: [], bluffCaughtSeat: -1 });
  });

  it("names the seat that got its bluff called", () => {
    // Seat 0 raises every street with king high; seat 1 calls it down with a
    // pair of nines and wins.
    const state = headsUp({ 0: "Ks 8d", 1: "9h 9s" }, "2h 4c 7d Js Qd");
    applyAction(state, 0, { type: "raise", amount: 30 });
    applyAction(state, 1, { type: "call" });
    applyAction(state, 1, { type: "check" });
    applyAction(state, 0, { type: "raise", amount: 60 });
    applyAction(state, 1, { type: "call" });
    applyAction(state, 1, { type: "check" });
    applyAction(state, 0, { type: "raise", amount: 120 });
    applyAction(state, 1, { type: "call" });
    applyAction(state, 1, { type: "check" });
    applyAction(state, 0, { type: "raise", amount: 200 });
    applyAction(state, 1, { type: "call" });

    const story = handStory(state);
    expect(story.bluffCaughtSeat).toBe(0);
    expect(seatOf(state, 0)).toMatchObject({
      aggressor: true,
      showed: true,
      won: 0,
      category: HandCategory.HighCard,
    });
    // The caller's biggest single call is the river one, not the sum.
    expect(seatOf(state, 1).biggestCall).toBe(200);
  });

  it("does not call a preflop raiser a bluffer", () => {
    // Seat 0 raises preflop and nobody bets again. Losing with ace high after
    // four checks is not an act of audacity.
    const state = headsUp({ 0: "As Kd", 1: "9h 9s" }, "2h 4c 7d Js Qd");
    applyAction(state, 0, { type: "raise", amount: 30 });
    applyAction(state, 1, { type: "call" });
    for (let street = 0; street < 3; street++) {
      applyAction(state, 1, { type: "check" });
      applyAction(state, 0, { type: "check" });
    }
    expect(handStory(state).bluffCaughtSeat).toBe(-1);
  });

  it("does not accuse the aggressor when the aggressor won", () => {
    const state = headsUp({ 0: "9h 9s", 1: "Ks 8d" }, "2h 4c 7d Js Qd");
    applyAction(state, 0, { type: "call" });
    applyAction(state, 1, { type: "check" });
    for (let street = 0; street < 2; street++) {
      applyAction(state, 1, { type: "check" });
      applyAction(state, 0, { type: "check" });
    }
    applyAction(state, 1, { type: "check" });
    applyAction(state, 0, { type: "raise", amount: 100 });
    applyAction(state, 1, { type: "call" });

    const story = handStory(state);
    expect(story.bluffCaughtSeat).toBe(-1);
    expect(seatOf(state, 0)).toMatchObject({ aggressor: true, won: 220 });
  });

  it("marks the seat that was in front at the turn and lost on the river", () => {
    // Seat 0 has a pair of kings; seat 1 makes a flush on the river.
    const state = headsUp({ 0: "Ks Kd", 1: "7h 8h" }, "Kc 4h 9h 2c 3h");
    applyAction(state, 0, { type: "call" });
    applyAction(state, 1, { type: "check" });
    for (let street = 0; street < 3; street++) {
      applyAction(state, 1, { type: "check" });
      applyAction(state, 0, { type: "check" });
    }

    expect(seatOf(state, 0)).toMatchObject({ rivered: true, won: 0 });
    expect(seatOf(state, 1)).toMatchObject({ rivered: false });
  });

  it("does not call it a suckout when the leader was already chopping", () => {
    // Both play the board at the turn, and the river plays it too: nobody was
    // ever solely in front, so nobody was run down.
    const state = headsUp({ 0: "2c 3d", 1: "2h 3s" }, "Ac Kd Qh Js Tc");
    applyAction(state, 0, { type: "call" });
    applyAction(state, 1, { type: "check" });
    for (let street = 0; street < 3; street++) {
      applyAction(state, 1, { type: "check" });
      applyAction(state, 0, { type: "check" });
    }
    expect(handStory(state).seats.every((s) => !s.rivered)).toBe(true);
  });

  it("records all-in, busted and what each seat put in", () => {
    const state = table({
      stacks: { 0: 200, 1: 1000 },
      button: 0,
      holes: { 0: "Ks 8d", 1: "9h 9s" },
      board: "2h 4c 7d Js Qd",
    });
    applyAction(state, 0, { type: "raise", amount: 200 });
    applyAction(state, 1, { type: "call" });

    expect(seatOf(state, 0)).toMatchObject({
      allIn: true,
      busted: true,
      committed: 200,
      won: 0,
    });
    expect(seatOf(state, 1)).toMatchObject({
      allIn: false,
      busted: false,
      committed: 200,
      won: 400,
    });
  });

  it("publishes no hand strength at all when nobody showed", () => {
    // The invariant this file exists for. Seat 0 shoves with nothing and seat
    // 1 folds: the story may say who was betting, and must not say what with.
    const state = headsUp({ 0: "7d 2c", 1: "As Ks" }, "2h 9c 4d Js Qh");
    applyAction(state, 0, { type: "raise", amount: 400 });
    applyAction(state, 1, { type: "fold" });

    const story = handStory(state);
    expect(story.bluffCaughtSeat).toBe(-1);
    for (const seat of story.seats) {
      expect(seat.showed).toBe(false);
      expect(seat.category).toBe(-1);
      expect(seat.rivered).toBe(false);
    }
    // What it is still allowed to say: who was doing the betting.
    expect(seatOf(state, 0).aggressor).toBe(true);
  });
});
