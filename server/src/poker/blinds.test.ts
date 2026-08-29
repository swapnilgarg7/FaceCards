import { describe, expect, it } from "vitest";
import { nextBlinds, type BlindPositions, type BlindSeat } from "./blinds.js";

/** Seats 0..n-1, all ready, none owing, unless overridden. */
function table(
  seats: readonly number[],
  overrides: Partial<Record<number, Partial<BlindSeat>>> = {},
): BlindSeat[] {
  return seats.map((seat) => ({
    seat,
    ready: true,
    owesBlind: false,
    ...overrides[seat],
  }));
}

function deal(
  seats: BlindSeat[],
  previous: BlindPositions | null,
): BlindPositions {
  const next = nextBlinds(seats, previous);
  if (!next) throw new Error("expected a hand");
  return next;
}

describe("the first hand a table plays", () => {
  it("starts the button on the lowest seat and runs the blinds up from it", () => {
    const first = deal(table([0, 1, 2, 3]), null);
    expect(first.button).toBe(0);
    expect(first.smallBlindSeat).toBe(1);
    expect(first.bigBlindSeat).toBe(2);
    expect(first.dealt).toEqual([0, 1, 2, 3]);
  });

  it("inverts the blinds heads-up: the button is the small blind", () => {
    const first = deal(table([2, 5]), null);
    expect(first.button).toBe(2);
    expect(first.smallBlindSeat).toBe(2);
    expect(first.bigBlindSeat).toBe(5);
  });

  it("owes nobody anything, because nobody has missed a blind yet", () => {
    // Everyone at a fresh table is nominally "new". Applying the waiting rule
    // here would deal a table of four into a hand of one.
    const first = deal(
      table([0, 1, 2, 3], {
        0: { owesBlind: true },
        1: { owesBlind: true },
        2: { owesBlind: true },
        3: { owesBlind: true },
      }),
      null,
    );
    expect(first.dealt).toEqual([0, 1, 2, 3]);
  });

  it("refuses to arrange a hand for fewer than two ready seats", () => {
    expect(nextBlinds(table([0, 1], { 1: { ready: false } }), null)).toBeNull();
    expect(nextBlinds([], null)).toBeNull();
  });
});

describe("the blinds walking a stable table", () => {
  it("moves every position on by exactly one seat each hand", () => {
    const seats = table([0, 1, 2]);
    let hand = deal(seats, null);
    expect([hand.button, hand.smallBlindSeat, hand.bigBlindSeat]).toEqual([0, 1, 2]);

    hand = deal(seats, hand);
    expect([hand.button, hand.smallBlindSeat, hand.bigBlindSeat]).toEqual([1, 2, 0]);

    hand = deal(seats, hand);
    expect([hand.button, hand.smallBlindSeat, hand.bigBlindSeat]).toEqual([2, 0, 1]);

    hand = deal(seats, hand);
    expect([hand.button, hand.smallBlindSeat, hand.bigBlindSeat]).toEqual([0, 1, 2]);
  });

  it("never charges the same seat the big blind twice in a row", () => {
    const seats = table([0, 1, 2, 3, 4, 5]);
    let hand = deal(seats, null);
    const posted: number[] = [hand.bigBlindSeat];
    for (let i = 0; i < 17; i++) {
      hand = deal(seats, hand);
      posted.push(hand.bigBlindSeat);
    }
    for (let i = 1; i < posted.length; i++) {
      expect(posted[i]).not.toBe(posted[i - 1]);
    }
    // Three full laps of six seats: everyone paid it exactly three times.
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      expect(posted.filter((s) => s === seat)).toHaveLength(3);
    }
  });
});

describe("a player leaving between hands", () => {
  it("leaves a dead small blind rather than charging the next seat twice", () => {
    // 0 1 2 3. Hand one: button 0, SB 1, BB 2. Hand two: button 1, SB 2, BB 3.
    // Seat 2 - who just paid the small blind - leaves.
    const four = table([0, 1, 2, 3]);
    const one = deal(four, null);
    const two = deal(four, one);
    expect([two.button, two.smallBlindSeat, two.bigBlindSeat]).toEqual([1, 2, 3]);

    const three = deal(table([0, 1, 3]), two);
    // The big blind moves on to 0, as it must. The small blind position is
    // seat 3 - last hand's big blind - who is still here and pays it.
    expect(three.bigBlindSeat).toBe(0);
    expect(three.smallBlindSeat).toBe(3);
    // The button follows the small blind position round onto the empty chair.
    expect(three.button).toBe(2);
    expect(three.dealt).toEqual([0, 1, 3]);
  });

  it("posts no small blind when the seat that owed it has gone", () => {
    // Hand one on 0 1 2 3: button 0, SB 1, BB 2. Seat 2 leaves, so the player
    // who would have paid the small blind is not here.
    const one = deal(table([0, 1, 2, 3]), null);
    const two = deal(table([0, 1, 3]), one);
    expect(two.bigBlindSeat).toBe(3);
    expect(two.smallBlindPos).toBe(2);
    expect(two.smallBlindSeat).toBeNull();
    expect(two.button).toBe(1);
  });

  it("keeps the button off a live seat when the position is dead", () => {
    const one = deal(table([0, 1, 2, 3]), null);
    const two = deal(table([0, 1, 2, 3]), one);
    // Seat 1, holding the button, leaves. Nothing about the blinds moves to
    // compensate: they are anchored to the big blind, not to the button.
    const three = deal(table([0, 2, 3]), two);
    expect(three.bigBlindSeat).toBe(0);
    expect(three.smallBlindSeat).toBe(3);
    expect(three.button).toBe(2);
  });
});

describe("waiting for the big blind", () => {
  it("holds a returning seat out until the blind reaches it", () => {
    // 0 1 2 3 running; seat 3 has just rebought and owes a blind.
    const running = table([0, 1, 2, 3]);
    let hand = deal(running, null); // button 0, SB 1, BB 2
    const withWaiter = table([0, 1, 2, 3], { 3: { owesBlind: true } });

    hand = deal(withWaiter, hand); // BB moves to 3 - which is the waiter
    expect(hand.bigBlindSeat).toBe(3);
    expect(hand.dealt).toContain(3);
  });

  it("deals the waiter out while the blind is still coming round", () => {
    // Seat 1 owes a blind. Hand one put the big blind on seat 2, so the next
    // one puts it on 3 and the one after on 0: seat 1 sits out both.
    const seats = table([0, 1, 2, 3], { 1: { owesBlind: true } });
    let hand = deal(table([0, 1, 2, 3]), null);
    expect(hand.bigBlindSeat).toBe(2);

    hand = deal(seats, hand);
    expect(hand.bigBlindSeat).toBe(3);
    expect(hand.dealt).toEqual([0, 2, 3]);

    hand = deal(seats, hand);
    expect(hand.bigBlindSeat).toBe(0);
    expect(hand.dealt).toEqual([0, 2, 3]);

    // Now it is seat 1's turn to pay, and they are back in.
    hand = deal(seats, hand);
    expect(hand.bigBlindSeat).toBe(1);
    expect(hand.dealt).toEqual([0, 1, 2, 3]);
  });

  it("deals waiters in rather than stopping the game for them", () => {
    // Two players left, and both of them owe a blind. The fairness rule loses
    // to the rule that the table keeps playing.
    const first = deal(table([0, 1, 2]), null);
    const stalled = deal(
      table([0, 1], { 0: { owesBlind: true }, 1: { owesBlind: true } }),
      first,
    );
    expect(stalled.dealt).toEqual([0, 1]);
  });

  it("never lets a waiting seat be skipped over by the blind", () => {
    // The blind advances one *ready* seat at a time, waiters included, which
    // is the only reason waiting ever ends.
    const seats = table([0, 1, 2, 3], { 2: { owesBlind: true } });
    let hand = deal(table([0, 1, 2, 3]), null);
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) {
      hand = deal(seats, hand);
      seen.push(hand.bigBlindSeat);
    }
    expect(seen).toContain(2);
  });
});

describe("dropping to heads-up and back", () => {
  it("puts the button back on the small blind when a table empties to two", () => {
    const one = deal(table([0, 1, 2]), null); // button 0, SB 1, BB 2
    const two = deal(table([0, 2]), one);
    expect(two.bigBlindSeat).toBe(0);
    expect(two.button).toBe(2);
    expect(two.smallBlindSeat).toBe(2);
  });

  it("stops inverting the blinds the moment a third seat is dealt in", () => {
    const heads = deal(table([0, 2]), null);
    expect(heads.smallBlindSeat).toBe(heads.button);

    const three = deal(table([0, 1, 2]), heads);
    expect(three.dealt).toEqual([0, 1, 2]);
    expect(three.smallBlindSeat).not.toBe(three.bigBlindSeat);
    expect(three.button).not.toBe(three.bigBlindSeat);
  });
});

describe("invariants that must hold for any roster churn", () => {
  it("always posts a big blind, and never on the same seat twice running", () => {
    // A deliberately hostile sequence: seats appear, vanish and rebuy.
    const rosters: BlindSeat[][] = [
      table([0, 1, 2, 3, 4]),
      table([0, 1, 2, 3, 4]),
      table([0, 2, 3, 4]),
      table([0, 2, 4], { 4: { owesBlind: true } }),
      table([0, 2, 4, 5], { 5: { owesBlind: true } }),
      table([2, 4, 5]),
      table([2, 5]),
      table([1, 2, 5], { 1: { owesBlind: true } }),
      table([1, 2, 5]),
      table([1, 2, 3, 5], { 3: { owesBlind: true } }),
    ];

    let hand: BlindPositions | null = null;
    let previousBig = -1;
    for (const roster of rosters) {
      hand = nextBlinds(roster, hand);
      expect(hand).not.toBeNull();
      const arranged = hand!;
      expect(arranged.dealt.length).toBeGreaterThanOrEqual(2);
      expect(arranged.dealt).toContain(arranged.bigBlindSeat);
      expect(arranged.bigBlindSeat).not.toBe(previousBig);
      if (arranged.smallBlindSeat !== null) {
        expect(arranged.dealt).toContain(arranged.smallBlindSeat);
        expect(arranged.smallBlindSeat).not.toBe(arranged.bigBlindSeat);
      }
      // The button never shares a chair with a blind at a three-plus-handed
      // table: that would open the postflop action in the wrong seat.
      if (arranged.dealt.length > 2) {
        expect(arranged.button).not.toBe(arranged.bigBlindSeat);
        expect(arranged.button).not.toBe(arranged.smallBlindSeat);
      }
      previousBig = arranged.bigBlindSeat;
    }
  });
});
