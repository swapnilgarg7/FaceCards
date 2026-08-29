import { describe, expect, it } from "vitest";
import {
  HOLO_CAPTION_HEIGHT,
  HOLO_CAPTION_Y,
  HOLO_CARD_HEIGHT,
  HOLO_CARD_WIDTH,
  HOLO_PITCH,
  HOLO_BASE_Y,
  holoCardX,
  holoFacing,
} from "./holo.js";
import { BOARD_SIZE } from "./cards.js";
import { EYE_HEIGHT, TABLE, seatLayout } from "./layout.js";

describe("the projected board", () => {
  it("stands clear of the felt", () => {
    expect(HOLO_BASE_Y).toBeGreaterThan(TABLE.topY);
  });

  it("never crosses anybody's eye-line", () => {
    // The rule the height exists to keep: every face plane in the room is at
    // EYE_HEIGHT, so anything taller than this hangs over the head of whoever
    // is sitting opposite - which trades one presence problem for a worse one.
    const top = HOLO_CAPTION_Y + HOLO_CAPTION_HEIGHT / 2;
    expect(top).toBeLessThan(EYE_HEIGHT);
  });

  it("puts the caption above the cards, not through them", () => {
    const cardTop = HOLO_BASE_Y + HOLO_CARD_HEIGHT;
    expect(HOLO_CAPTION_Y - HOLO_CAPTION_HEIGHT / 2).toBeGreaterThan(cardTop);
  });

  it("stands the cards apart rather than overlapping them", () => {
    expect(HOLO_PITCH).toBeGreaterThan(HOLO_CARD_WIDTH);
  });

  it("is big enough to read and small enough to fit the table", () => {
    expect(HOLO_CARD_WIDTH).toBeGreaterThan(0.1);
    const row = HOLO_PITCH * (BOARD_SIZE - 1) + HOLO_CARD_WIDTH;
    expect(row).toBeLessThan(TABLE.radius * 2);
  });
});

describe("holoCardX", () => {
  it("centres the row whatever the street", () => {
    for (const count of [1, 3, 4, 5]) {
      const xs = Array.from({ length: count }, (_, i) => holoCardX(i, count));
      const sum = xs.reduce((total, x) => total + x, 0);
      expect(sum).toBeCloseTo(0, 10);
    }
  });

  it("spaces them evenly", () => {
    const xs = Array.from({ length: 5 }, (_, i) => holoCardX(i, 5));
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo(HOLO_PITCH, 10);
    }
  });

  it("has nowhere to put a card in an empty row", () => {
    expect(holoCardX(0, 0)).toBe(0);
  });
});

describe("holoFacing", () => {
  it("turns square on to every seat at the table", () => {
    for (const seat of seatLayout(6)) {
      const yaw = holoFacing(seat.x, seat.z);
      // A plane faces its local +Z. Rotated by `yaw`, that vector should point
      // straight at the seat that is looking at it.
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const distance = Math.hypot(seat.x, seat.z);
      expect(forwardX).toBeCloseTo(seat.x / distance, 10);
      expect(forwardZ).toBeCloseTo(seat.z / distance, 10);
    }
  });

  it("is the same rotation the seats themselves use", () => {
    // Both are `atan2(x, z)`, and they must stay that way: a board that
    // disagreed with the seat ring would be square on to nobody.
    for (const seat of seatLayout(4)) {
      expect(holoFacing(seat.x, seat.z)).toBeCloseTo(seat.yaw, 10);
    }
  });
});
