import { describe, expect, it } from "vitest";
import {
  nextBlinds,
  seatsOwingBlind,
  type BlindPositions,
  type BlindSeat,
} from "./blinds.js";

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

/** First dealt seat clockwise of `from`, wrapping once. */
function leftOf(dealt: readonly number[], from: number): number {
  return dealt.find((seat) => seat > from) ?? dealt[0]!;
}

/**
 * The invariant that makes the button mean anything: **the first dealt seat
 * clockwise of the button is the seat that posts the first blind.**
 *
 * Nothing else pins it down. Asserting only that the button does not *equal* a
 * blind passes happily while the button sits two seats behind where it belongs
 * with a live player stranded in the gap - and because `openRound` walks the
 * ring from the button, that stranded seat then opens the action on every
 * postflop street of every hand. Preflop order comes off the big blind instead,
 * so a fold-heavy hand looks completely normal while it happens.
 */
function expectButtonPlaced(hand: BlindPositions): void {
  if (hand.dealt.length === 2) {
    // Heads-up: the button *is* the small blind, so the seat to its left is
    // the big blind.
    expect(hand.smallBlindSeat).toBe(hand.button);
    expect(leftOf(hand.dealt, hand.button)).toBe(hand.bigBlindSeat);
    return;
  }
  expect(leftOf(hand.dealt, hand.button)).toBe(
    hand.smallBlindSeat ?? hand.bigBlindSeat,
  );
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
  it("keeps the button one seat behind the first blind, hand after hand", () => {
    const seats = table([0, 1, 2, 3, 4]);
    let hand = deal(seats, null);
    expectButtonPlaced(hand);
    for (let i = 0; i < 12; i++) {
      hand = deal(seats, hand);
      expectButtonPlaced(hand);
    }
  });

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

  it("re-places a button the ring has moved out from under", () => {
    // Regression. Seat 1 misses three hands while the button walks past their
    // chair, then is dealt back in mid-rotation. The button had been carried
    // to seat 0 and the small blind is on seat 2, which leaves seat 1 sitting
    // in the gap between them - so the flop, turn and river would all open on
    // seat 1 instead of on the small blind, every hand, for as long as the
    // misplacement lasted.
    const four = table([0, 1, 2, 3]);
    const three = table([0, 2, 3]);

    let hand = deal(four, null);
    hand = deal(three, hand);
    hand = deal(three, hand);
    hand = deal(three, hand);
    expect([hand.button, hand.smallBlindSeat, hand.bigBlindSeat]).toEqual([3, 0, 2]);

    const back = deal(four, hand);
    expect([back.smallBlindSeat, back.bigBlindSeat]).toEqual([2, 3]);
    expect(back.button).toBe(1);
    expectButtonPlaced(back);
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
      // The button is always exactly one dealt seat behind the first blind.
      // This subsumes "the button never shares a chair with a blind", which is
      // the weaker check that let a two-seat misplacement through.
      expectButtonPlaced(arranged);
      previousBig = arranged.bigBlindSeat;
    }
  });
});

describe("hostile churn, fuzzed", () => {
  it("holds every blind invariant over thousands of arrangements", () => {
    // The table-driven cases above each pin one rule. This pins all of them at
    // once against roster churn nobody would think to write by hand: seats
    // appearing, vanishing, busting, waiting and coming back in every order.
    // The button defect this file now regresses against survived hand-written
    // cases precisely because it needed four specific hands in sequence.
    let seed = 0x2f6e2b1 >>> 0;
    const rand = (n: number) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return seed % n;
    };

    let hand: BlindPositions | null = null;
    let previousBig = -1;
    let arrangements = 0;
    // How many hands each seat has gone without being dealt in, so a seat can
    // be shown not to wait forever.
    const waiting = new Map<number, number>();

    for (let round = 0; round < 4000; round++) {
      const roster: BlindSeat[] = [];
      for (let seat = 0; seat < 6; seat++) {
        if (rand(4) === 0) continue;
        roster.push({ seat, ready: true, owesBlind: rand(3) === 0 });
      }

      const next = nextBlinds(roster, hand);
      if (!next) {
        // Fewer than two seats: the table waits, and the arrangement it waits
        // on must be the one it will resume from.
        expect(roster.length).toBeLessThan(2);
        continue;
      }
      arrangements++;

      expect(next.dealt.length).toBeGreaterThanOrEqual(2);
      expect(next.dealt).toEqual([...next.dealt].sort((a, b) => a - b));
      expect(new Set(next.dealt).size).toBe(next.dealt.length);
      // Nobody is dealt in who was not at the table and ready.
      for (const seat of next.dealt) {
        expect(roster.some((r) => r.seat === seat)).toBe(true);
      }

      // There is always a big blind, it is always live, and it never lands on
      // the same seat two hands running.
      expect(next.dealt).toContain(next.bigBlindSeat);
      expect(next.bigBlindSeat).not.toBe(previousBig);

      // A posted small blind is live, is not the big blind, and is exactly one
      // dealt seat to the big blind's right.
      if (next.smallBlindSeat !== null) {
        expect(next.dealt).toContain(next.smallBlindSeat);
        expect(next.smallBlindSeat).not.toBe(next.bigBlindSeat);
        expect(leftOf(next.dealt, next.smallBlindSeat)).toBe(next.bigBlindSeat);
      }

      // The one the hand-written cases were too weak to catch.
      expectButtonPlaced(next);

      // A waiting seat is dealt in within one lap of the table rather than
      // being stepped over forever.
      for (const seat of roster.map((r) => r.seat)) {
        const missed = next.dealt.includes(seat)
          ? 0
          : (waiting.get(seat) ?? 0) + 1;
        waiting.set(seat, missed);
        expect(missed).toBeLessThanOrEqual(12);
      }

      previousBig = next.bigBlindSeat;
      hand = next;
    }

    // Guard against the fuzz silently arranging almost nothing.
    expect(arrangements).toBeGreaterThan(3000);
  });
});

describe("who owes a blind after a hand is arranged", () => {
  it("charges a seat that was away when the deal came round", () => {
    // Seat 3 sat out, so it was never eligible: a blind went past an empty
    // chair and it waits for the next one.
    expect(seatsOwingBlind([0, 1, 2, 3], [0, 1, 2], [0, 1, 2])).toEqual(
      new Set([3]),
    );
  });

  it("does not charge a seat that was ready and held out by the wait", () => {
    // Seat 3 is ready, connected and funded; `nextBlinds` held it out because
    // it already owed a blind. Charging it again is the bug that made the wait
    // last a whole orbit instead of one hand.
    expect(seatsOwingBlind([0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2])).toEqual(
      new Set(),
    );
  });

  it("never charges a seat that was dealt in", () => {
    expect(seatsOwingBlind([0, 1, 2], [0, 1, 2], [0, 1, 2])).toEqual(new Set());
  });

  it("clears the whole waiting room in one hand at a seven-handed table", () => {
    // The reported failure: two seats started the evening, five more were
    // ready and watching. All five were eligible, one was let in by the big
    // blind, and the other four must not be sent to the back of the queue.
    const seats = [0, 1, 2, 3, 4, 5, 6];
    expect(seatsOwingBlind(seats, seats, [0, 1, 2])).toEqual(new Set());
  });

  it("keeps charging a dropped seat, reconnection window or not", () => {
    expect(seatsOwingBlind([0, 1, 2], [0, 1], [0, 1])).toEqual(new Set([2]));
  });
});
