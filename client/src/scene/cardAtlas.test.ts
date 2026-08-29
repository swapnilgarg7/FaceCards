import { describe, expect, it } from "vitest";
import { ATLAS_SLOTS, BACK_SLOT, EDGE_SLOT, atlasCell } from "./cardAtlas.js";
import { DECK_SIZE, cardIndex, cardName } from "./cards.js";

/**
 * The drawing needs a canvas and a GPU and is checked by looking at it. The
 * *grid* does not, and it is the half phase 5 has to match when the baked RevK
 * atlas replaces the drawn one, so it is the half worth asserting.
 */
describe("atlasCell", () => {
  const slots = ATLAS_SLOTS.columns * ATLAS_SLOTS.rows;

  it("has room for every face plus a back and an edge", () => {
    expect(EDGE_SLOT).toBeLessThan(slots);
    expect(ATLAS_SLOTS.faces).toBe(52);
    expect(BACK_SLOT).toBe(DECK_SIZE);
  });

  it("stays inside the texture", () => {
    for (let slot = 0; slot <= EDGE_SLOT; slot++) {
      const cell = atlasCell(slot);
      expect(cell.u0).toBeGreaterThanOrEqual(0);
      expect(cell.v0).toBeGreaterThanOrEqual(0);
      expect(cell.u1).toBeLessThanOrEqual(1);
      expect(cell.v1).toBeLessThanOrEqual(1);
    }
  });

  it("is a non-empty rect with v running up", () => {
    for (let slot = 0; slot <= EDGE_SLOT; slot++) {
      const cell = atlasCell(slot);
      expect(cell.u1).toBeGreaterThan(cell.u0);
      expect(cell.v1).toBeGreaterThan(cell.v0);
    }
  });

  it("gives every card a cell of its own", () => {
    const seen = new Set<string>();
    for (let slot = 0; slot <= EDGE_SLOT; slot++) {
      const cell = atlasCell(slot);
      seen.add(`${cell.u0.toFixed(6)}:${cell.v0.toFixed(6)}`);
    }
    expect(seen.size).toBe(EDGE_SLOT + 1);
  });

  it("addresses a slot for every card the server can send", () => {
    for (const rank of ATLAS_SLOTS.ranks) {
      for (const suit of ATLAS_SLOTS.suits) {
        const slot = cardIndex(rank + suit);
        expect(slot).toBeGreaterThanOrEqual(0);
        expect(slot).toBeLessThan(DECK_SIZE);
        expect(cardName(slot)).toBe(rank + suit);
      }
    }
  });

  it("never lets a face share the back's cell", () => {
    for (let slot = 0; slot < DECK_SIZE; slot++) {
      expect(atlasCell(slot)).not.toEqual(atlasCell(BACK_SLOT));
    }
  });
});
