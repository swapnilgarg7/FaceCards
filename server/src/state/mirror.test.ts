import { describe, expect, it } from "vitest";
import {
  PokerState,
  Player,
  type PlayerInstance,
} from "@facecards/shared";
import {
  applyAction,
  cardToString,
  cardsFromString,
  makeDeck,
  startHand,
  type Card,
  type HandState,
} from "../poker/index.js";
import { clearResult, mirrorHand, mirrorResult, NO_SEAT } from "./mirror.js";
import type { RandomInt } from "../poker/shuffle.js";

/**
 * The wire, checked from the wire's side.
 *
 * `story.ts` has its own tests for whether a classification is *correct*. This
 * file asks a different and more important question: given a hand where the
 * temptation to leak is at its strongest - somebody shoved with nothing and
 * everybody folded - does anything the mirror writes let a client work out
 * what they had?
 *
 * The answer has to be no by construction, not by the story module having
 * been careful, which is why `mirrorResult` re-checks the reveal list itself
 * before writing a single note.
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

/** Heads-up, seat 0 on the button, with a chosen deck. */
function headsUp(holes: Record<number, string>, board: string): HandState {
  const used = new Set<Card>();
  const claim = (card: Card) => {
    if (used.has(card)) throw new Error("card used twice");
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

  // Button is seat 0, so cards are pitched to seat 1 first.
  const deck: Card[] = [];
  for (let round = 0; round < 2; round++) {
    deck.push(hole.get(1)![round]!, hole.get(0)![round]!);
  }
  deck.push(burn(), ...boardCards.slice(0, 3));
  deck.push(burn(), boardCards[3]!);
  deck.push(burn(), boardCards[4]!);
  while (deck.length < 52) deck.push(burn());

  return startHand({
    players: [
      { seat: 0, playerId: "p0", stack: 1000 },
      { seat: 1, playerId: "p1", stack: 1000 },
    ],
    button: 0,
    smallBlind: 5,
    bigBlind: 10,
    handNumber: 1,
    randomInt: stackedRandomInt(deck),
  });
}

function players(): Map<number, PlayerInstance> {
  const bySeat = new Map<number, PlayerInstance>();
  for (const seat of [0, 1]) {
    const player = new Player();
    player.sessionId = `p${seat}`;
    player.displayName = `Player ${seat}`;
    player.seat = seat;
    bySeat.set(seat, player);
  }
  return bySeat;
}

/** Every card string anywhere in the published state. */
function publishedCards(state: InstanceType<typeof PokerState>): string[] {
  const out: string[] = [...state.board];
  state.reveals.forEach((reveal) => {
    out.push(...reveal.cards, ...reveal.best);
  });
  return out;
}

describe("mirrorResult and the hand story", () => {
  it("publishes notes for every seat that was dealt in", () => {
    const hand = headsUp({ 0: "Ks 8d", 1: "9h 9s" }, "2h 4c 7d Js Qd");
    applyAction(hand, 0, { type: "raise", amount: 30 });
    applyAction(hand, 1, { type: "call" });
    applyAction(hand, 1, { type: "check" });
    applyAction(hand, 0, { type: "raise", amount: 100 });
    applyAction(hand, 1, { type: "call" });
    applyAction(hand, 1, { type: "check" });
    applyAction(hand, 0, { type: "check" });
    applyAction(hand, 1, { type: "check" });
    applyAction(hand, 0, { type: "check" });

    const state = new PokerState();
    const bySeat = players();
    mirrorHand(state, hand, bySeat);
    mirrorResult(state, hand, bySeat);

    expect(state.handNotes.length).toBe(2);
    expect(state.bluffCaughtSeat).toBe(0);
    const bluffer = state.handNotes.find((n) => n.seat === 0)!;
    expect(bluffer.showed).toBe(true);
    expect(bluffer.aggressor).toBe(true);
    expect(bluffer.won).toBe(0);
  });

  it("says nothing about a card nobody showed", () => {
    // The hand this whole design is arranged around. Seat 0 shoves with seven
    // deuce and seat 1 folds; nothing published may distinguish that from a
    // shove with aces.
    const hand = headsUp({ 0: "7d 2c", 1: "As Ks" }, "2h 9c 4d Js Qh");
    applyAction(hand, 0, { type: "raise", amount: 400 });
    applyAction(hand, 1, { type: "fold" });

    const state = new PokerState();
    const bySeat = players();
    mirrorHand(state, hand, bySeat);
    mirrorResult(state, hand, bySeat);

    expect(state.reveals.length).toBe(0);
    expect(publishedCards(state)).toEqual([]);
    expect(state.bluffCaughtSeat).toBe(NO_SEAT);
    state.handNotes.forEach((note) => {
      expect(note.showed).toBe(false);
      expect(note.category).toBe(NO_SEAT);
      expect(note.rivered).toBe(false);
    });
    // What it is still allowed to say, because the whole table watched it: who
    // put the chips in.
    expect(state.handNotes.find((n) => n.seat === 0)?.aggressor).toBe(true);
  });

  it("only ever describes the strength of a hand that is in reveals", () => {
    const hand = headsUp({ 0: "Ks Kd", 1: "7h 8h" }, "Kc 4h 9h 2c 3h");
    applyAction(hand, 0, { type: "call" });
    applyAction(hand, 1, { type: "check" });
    for (let street = 0; street < 3; street++) {
      applyAction(hand, 1, { type: "check" });
      applyAction(hand, 0, { type: "check" });
    }

    const state = new PokerState();
    const bySeat = players();
    mirrorHand(state, hand, bySeat);
    mirrorResult(state, hand, bySeat);

    const revealed = new Set<number>();
    state.reveals.forEach((r) => revealed.add(r.seat));
    state.handNotes.forEach((note) => {
      if (note.category !== NO_SEAT || note.rivered) {
        expect(revealed.has(note.seat)).toBe(true);
      }
    });
    // And the classification is the one the engine made.
    expect(state.handNotes.find((n) => n.seat === 0)?.rivered).toBe(true);
  });

  it("puts the story back in the box with the reveals", () => {
    const hand = headsUp({ 0: "Ks Kd", 1: "7h 8h" }, "Kc 4h 9h 2c 3h");
    applyAction(hand, 0, { type: "call" });
    applyAction(hand, 1, { type: "check" });
    for (let street = 0; street < 3; street++) {
      applyAction(hand, 1, { type: "check" });
      applyAction(hand, 0, { type: "check" });
    }

    const state = new PokerState();
    const bySeat = players();
    mirrorHand(state, hand, bySeat);
    mirrorResult(state, hand, bySeat);
    expect(state.handNotes.length).toBeGreaterThan(0);

    // A note that survived into the next hand would be a description of cards
    // nobody is looking at any more, attached to a hand in progress.
    clearResult(state);
    expect(state.handNotes.length).toBe(0);
    expect(state.bluffCaughtSeat).toBe(NO_SEAT);
    expect(state.reveals.length).toBe(0);
  });

  it("never names a deck or a burn card in any field", () => {
    const hand = headsUp({ 0: "Ks 8d", 1: "9h 9s" }, "2h 4c 7d Js Qd");
    applyAction(hand, 0, { type: "raise", amount: 1000 });
    applyAction(hand, 1, { type: "call" });

    const state = new PokerState();
    const bySeat = players();
    mirrorHand(state, hand, bySeat);
    mirrorResult(state, hand, bySeat);

    // Everything the server still holds that a client must never see.
    const secret = [...hand.deck, ...hand.burned].map(cardToString);
    const published = new Set(publishedCards(state));
    for (const card of secret) {
      expect(published.has(card), card).toBe(false);
    }
  });
});
