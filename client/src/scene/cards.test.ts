import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  CARD_HEIGHT,
  CARD_REST_Y,
  CARD_WIDTH,
  DECK_SIZE,
  boardSpot,
  cardIndex,
  cardName,
  deckSpot,
  holeSpot,
  muckSpot,
} from "./cards.js";
import { TABLE, seatLayout } from "./layout.js";

describe("cardIndex", () => {
  it("round-trips every card in the deck exactly once", () => {
    const seen = new Set<number>();
    for (let i = 0; i < DECK_SIZE; i++) {
      expect(cardIndex(cardName(i))).toBe(i);
      seen.add(i);
    }
    expect(seen.size).toBe(52);
  });

  it("reads the server's own spelling", () => {
    expect(cardIndex("As")).toBe(cardIndex("AS"));
    expect(cardIndex("Td")).toBeGreaterThanOrEqual(0);
    expect(cardIndex("2c")).toBe(0);
  });

  it("gives no face to anything that is not a card", () => {
    // The one thing this module must never do is resolve a face by accident.
    for (const bad of [undefined, "", "A", "Ass", "1s", "Ax", "  ", "??", "10s"]) {
      expect(cardIndex(bad)).toBe(-1);
    }
  });
});

describe("boardSpot", () => {
  it("lies flat on the felt, clear of it", () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      expect(boardSpot(i).y).toBe(CARD_REST_Y);
      expect(boardSpot(i).y).toBeGreaterThan(TABLE.topY);
    }
  });

  it("is a centred, evenly spaced row", () => {
    const spots = Array.from({ length: BOARD_SIZE }, (_, i) => boardSpot(i));
    const zs = spots.map((s) => s.z);
    expect(zs[0]! + zs[BOARD_SIZE - 1]!).toBeCloseTo(0, 10);
    for (let i = 1; i < zs.length; i++) {
      expect(zs[i]! - zs[i - 1]!).toBeCloseTo(zs[1]! - zs[0]!, 10);
    }
    expect(spots.every((s) => s.x === 0)).toBe(true);
  });

  it("does not overlap its neighbours", () => {
    expect(boardSpot(1).z - boardSpot(0).z).toBeGreaterThan(CARD_WIDTH);
  });

  it("stays well inside the rail", () => {
    for (let i = 0; i < BOARD_SIZE; i++) {
      const spot = boardSpot(i);
      expect(Math.hypot(spot.x, spot.z) + CARD_HEIGHT / 2).toBeLessThan(
        TABLE.radius,
      );
    }
  });
});

describe("holeSpot", () => {
  const ring = seatLayout(6);

  it("puts a seat's cards nearer that seat than any other", () => {
    for (const seat of ring) {
      for (const index of [0, 1]) {
        const spot = holeSpot(seat, index);
        const mine = Math.hypot(spot.x - seat.x, spot.z - seat.z);
        for (const other of ring) {
          if (other.index === seat.index) continue;
          expect(mine).toBeLessThan(
            Math.hypot(spot.x - other.x, spot.z - other.z),
          );
        }
      }
    }
  });

  it("keeps both cards on the felt", () => {
    for (const seat of ring) {
      for (const index of [0, 1]) {
        const spot = holeSpot(seat, index);
        expect(Math.hypot(spot.x, spot.z)).toBeLessThan(TABLE.radius);
        expect(spot.y).toBe(CARD_REST_Y);
      }
    }
  });

  it("lays the pair side by side, overlapping like a hand", () => {
    const seat = ring[0]!;
    const gap = Math.hypot(
      holeSpot(seat, 0).x - holeSpot(seat, 1).x,
      holeSpot(seat, 0).z - holeSpot(seat, 1).z,
    );
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(CARD_WIDTH);
  });

  it("never puts one seat's cards on another seat's", () => {
    const spots = ring.flatMap((seat) => [holeSpot(seat, 0), holeSpot(seat, 1)]);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        // A seat's own pair is allowed to overlap; two seats' are not.
        if (Math.floor(i / 2) === Math.floor(j / 2)) continue;
        const d = Math.hypot(
          spots[i]!.x - spots[j]!.x,
          spots[i]!.z - spots[j]!.z,
        );
        expect(d).toBeGreaterThan(CARD_HEIGHT);
      }
    }
  });

  it("clears the board row", () => {
    for (const seat of ring) {
      for (const index of [0, 1]) {
        const hole = holeSpot(seat, index);
        for (let b = 0; b < BOARD_SIZE; b++) {
          const board = boardSpot(b);
          expect(
            Math.hypot(hole.x - board.x, hole.z - board.z),
          ).toBeGreaterThan(CARD_HEIGHT);
        }
      }
    }
  });
});

describe("deckSpot", () => {
  it("sits in front of the button, on the felt", () => {
    const ring = seatLayout(4);
    for (const seat of ring) {
      const deck = deckSpot(seat);
      expect(Math.hypot(deck.x, deck.z)).toBeLessThan(TABLE.radius);
      const mine = Math.hypot(deck.x - seat.x, deck.z - seat.z);
      for (const other of ring) {
        if (other.index === seat.index) continue;
        expect(mine).toBeLessThan(
          Math.hypot(deck.x - other.x, deck.z - other.z),
        );
      }
    }
  });

  it("falls back to the middle before the first hand has a button", () => {
    expect(deckSpot(undefined)).toEqual({ x: 0, y: CARD_REST_Y, z: 0, yaw: 0 });
  });
});

describe("muckSpot", () => {
  it("moves a folded hand towards the middle, not off the table", () => {
    for (const seat of seatLayout(6)) {
      const hole = holeSpot(seat, 0);
      const muck = muckSpot(seat, 0);
      expect(Math.hypot(muck.x, muck.z)).toBeLessThan(
        Math.hypot(hole.x, hole.z),
      );
      expect(Math.hypot(muck.x, muck.z)).toBeGreaterThan(0.2);
    }
  });
});
