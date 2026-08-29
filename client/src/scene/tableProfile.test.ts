import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  boardSpot,
  deckSpot,
  holeSpot,
  muckSpot,
  type CardSpot,
} from "./cards.js";
import {
  MAX_CHIPS_PER_PILE,
  betAnchor,
  chipBreakdown,
  pileLayout,
  potAnchor,
  splitAcrossPiles,
  stackAnchor,
  CHIP_RADIUS,
} from "./chips.js";
import { seatLayout, TABLE } from "./layout.js";
import {
  FELT_RADIUS,
  INLAY_INNER,
  INLAY_OUTER,
  NEON_RADIUS,
  RAIL_CROWN_R,
  RAIL_INNER,
  RAIL_OUTER,
  TABLE_SEGMENTS,
  TABLE_TRIANGLE_BUDGET,
  apronProfile,
  pedestalProfile,
  profileNormal,
  railProfile,
  tableTriangles,
} from "./tableProfile.js";

/** Furthest any corner of a card at `spot` gets from the table axis. */
function cardReach(spot: CardSpot): number {
  // The card lies flat, long axis along its yaw. Its own right and forward in
  // world XZ, exactly as `holeSpot` derives them.
  const rightX = Math.cos(spot.yaw);
  const rightZ = -Math.sin(spot.yaw);
  const outX = Math.sin(spot.yaw);
  const outZ = Math.cos(spot.yaw);

  let worst = 0;
  for (const sw of [-1, 1]) {
    for (const sh of [-1, 1]) {
      const x =
        spot.x + rightX * ((sw * CARD_WIDTH) / 2) + outX * ((sh * CARD_HEIGHT) / 2);
      const z =
        spot.z + rightZ * ((sw * CARD_WIDTH) / 2) + outZ * ((sh * CARD_HEIGHT) / 2);
      worst = Math.max(worst, Math.hypot(x, z));
    }
  }
  return worst;
}

describe("the felt clears everything the game puts on it", () => {
  // The one thing a visual pass can silently break. Every anchor the scene
  // draws to is derived from the seat bearing and knows nothing about a rail,
  // so if the rail creeps inward the game goes under the upholstery.
  for (const count of [1, 2, 3, 4, 5, 6]) {
    it(`at ${count} seats`, () => {
      const ring = seatLayout(count);

      for (const seat of ring) {
        for (const index of [0, 1]) {
          expect(cardReach(holeSpot(seat, index))).toBeLessThan(FELT_RADIUS);
          expect(cardReach(muckSpot(seat, index))).toBeLessThan(FELT_RADIUS);
        }
        // The deck is the binding constraint: it sits further out than any
        // hole card and every card of every hand starts its flight there.
        expect(cardReach(deckSpot(seat))).toBeLessThan(FELT_RADIUS);

        // A full starting stack, and a bet the size of one, laid out for real.
        for (const anchor of [stackAnchor(seat), betAnchor(seat)]) {
          const chips = pileLayout(
            chipBreakdown(1000, MAX_CHIPS_PER_PILE),
            anchor,
            seat.yaw,
            seat.index * 101,
          );
          for (const chip of chips) {
            expect(Math.hypot(chip.x, chip.z) + CHIP_RADIUS).toBeLessThan(
              FELT_RADIUS,
            );
          }
        }
      }

      for (let index = 0; index < 5; index++) {
        expect(cardReach(boardSpot(index))).toBeLessThan(FELT_RADIUS);
      }
    });
  }

  it("clears a pot big enough to hold every stack at the table", () => {
    const piles = splitAcrossPiles(chipBreakdown(6000, MAX_CHIPS_PER_PILE));
    piles.forEach((pile, index) => {
      const anchor = potAnchor(index);
      for (const chip of pileLayout(pile, anchor, anchor.yaw, 7000 + index)) {
        expect(Math.hypot(chip.x, chip.z) + CHIP_RADIUS).toBeLessThan(
          FELT_RADIUS,
        );
      }
    });
  });
});

describe("the profile is authored counter-clockwise", () => {
  // The mistake this catches is not hypothetical: authored bottom-to-top, the
  // rail's crown faces the floor and the table reads as lit from underneath.
  it("faces the crown of the rail upward", () => {
    const points = railProfile();
    const crown = points.findIndex((p) => p.r === RAIL_CROWN_R);
    expect(crown).toBeGreaterThan(0);
    // The segments either side of the crown both have to be topside.
    expect(profileNormal(points, crown - 1).y).toBeGreaterThan(0.3);
    expect(profileNormal(points, crown).y).toBeGreaterThan(0.3);
  });

  it("faces the inner wall of the rail back at the felt", () => {
    const points = railProfile();
    // The last climb segment, from the inner top down to the inner underside.
    const inner = points.length - 2;
    expect(points[inner]!.r).toBe(RAIL_INNER);
    expect(profileNormal(points, inner).r).toBeLessThan(0);
  });

  it("faces the apron outward and its underside down", () => {
    const points = apronProfile();
    expect(profileNormal(points, 0).y).toBeLessThan(-0.9);
    expect(profileNormal(points, points.length - 2).r).toBeGreaterThan(0.9);
  });

  it("faces the pedestal outward and its foot down", () => {
    const points = pedestalProfile();
    expect(profileNormal(points, 0).y).toBeLessThan(-0.9);
    expect(profileNormal(points, points.length - 2).r).toBeGreaterThan(0.9);
  });

  it("closes the rail, so it has no open edge", () => {
    const points = railProfile();
    expect(points[0]).toEqual(points[points.length - 1]);
  });
});

describe("proportions", () => {
  it("keeps the widest part of the table where the seats were measured from", () => {
    expect(RAIL_CROWN_R).toBe(TABLE.radius);
    expect(RAIL_OUTER).toBeGreaterThan(RAIL_CROWN_R);
    expect(RAIL_INNER).toBeLessThan(RAIL_CROWN_R);
  });

  it("puts the inlay between the felt and the rail", () => {
    expect(INLAY_INNER).toBeLessThan(INLAY_OUTER);
    expect(INLAY_OUTER).toBeLessThanOrEqual(RAIL_INNER);
  });

  it("hides the neon race under the outer half of the rail", () => {
    expect(NEON_RADIUS).toBeGreaterThan(RAIL_CROWN_R);
    expect(NEON_RADIUS).toBeLessThan(RAIL_OUTER);
  });

  it("stays inside the hero-asset triangle budget", () => {
    expect(tableTriangles()).toBeLessThan(TABLE_TRIANGLE_BUDGET);
  });

  it("spends its triangles on the round, not on the profile", () => {
    // A lathed table gets its silhouette from segments and its shape from
    // points. Enough segments that the rail reads as a curve from a metre
    // away, and few enough points that the whole thing stays cheap.
    expect(TABLE_SEGMENTS).toBeGreaterThanOrEqual(48);
    expect(railProfile().length).toBeLessThanOrEqual(16);
  });
});
