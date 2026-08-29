import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, MAX_SEATS_SUPPORTED } from "@facecards/shared";
import {
  EYE_HEIGHT,
  MAX_LOOK_YAW,
  assignSeats,
  bearingBetweenSeats,
  seatForward,
  seatLayout,
} from "./layout.js";

const deg = (radians: number) => (radians * 180) / Math.PI;

/** Comfortable head turn from a seated position, without swivelling. */
const COMFORTABLE_LOOK_ARC = 85;

/** A face right on the yaw clamp is reachable but never centred. */
const CLAMP_MARGIN = (4 * Math.PI) / 180;

/** Widest turn anyone at the table has to make to look at anyone else. */
function widestBearing(count: number): number {
  const seats = seatLayout(count);
  let widest = 0;
  for (const from of seats) {
    for (const to of seats) {
      if (from.index === to.index) continue;
      widest = Math.max(widest, Math.abs(bearingBetweenSeats(from, to)));
    }
  }
  return deg(widest);
}

describe("seatLayout", () => {
  it("lays out exactly the people who are here", () => {
    expect(seatLayout(2)).toHaveLength(2);
    expect(seatLayout(MAX_PLAYERS)).toHaveLength(MAX_PLAYERS);
    expect(seatLayout(0)).toEqual([]);
    expect(seatLayout(-1)).toEqual([]);
  });

  it("seats two players exactly opposite, meeting head-on", () => {
    const [a, b] = seatLayout(2);
    expect(deg(Math.abs(bearingBetweenSeats(a!, b!)))).toBeCloseTo(0);
    expect(deg(Math.abs(bearingBetweenSeats(b!, a!)))).toBeCloseTo(0);
  });

  it("puts three players in a triangle and four in a square", () => {
    // Every player at an equal, small turn from both of the others.
    const three = seatLayout(3);
    for (const from of three) {
      for (const to of three) {
        if (from.index === to.index) continue;
        expect(deg(Math.abs(bearingBetweenSeats(from, to)))).toBeCloseTo(30, 0);
      }
    }

    const four = seatLayout(4);
    const bearings = four
      .filter((seat) => seat.index !== 0)
      .map((seat) => Math.round(deg(Math.abs(bearingBetweenSeats(four[0]!, seat)))));
    // One dead ahead across the table, one to each side.
    expect(bearings.sort((a, b) => a - b)).toEqual([0, 45, 45]);
  });

  it("keeps the widest turn growing slowly with the table", () => {
    // The property that makes a ring the right shape: adding people costs a
    // little peripheral vision, never a face behind your shoulder.
    // Bounds are pinned to seat counts, not to MAX_PLAYERS: the ring's shape
    // is a property of how many people are on it, so raising the shipping cap
    // should move which rung applies, never rewrite the ladder.
    expect(widestBearing(2)).toBeCloseTo(0);
    expect(widestBearing(3)).toBeLessThan(35);
    expect(widestBearing(4)).toBeLessThan(50);
    expect(widestBearing(6)).toBeLessThan(65);
    expect(widestBearing(8)).toBeLessThan(70);
    expect(widestBearing(MAX_SEATS_SUPPORTED)).toBeLessThan(
      COMFORTABLE_LOOK_ARC,
    );
    // Whatever the cap currently is, a full table stays inside a head turn.
    expect(widestBearing(MAX_PLAYERS)).toBeLessThan(COMFORTABLE_LOOK_ARC);
  });

  it("leaves every face reachable within the camera's yaw clamp", () => {
    // If a seat sits outside the look clamp, that player is permanently
    // unlookable-at, which is the one thing this product cannot survive.
    for (let count = 2; count <= MAX_SEATS_SUPPORTED; count++) {
      expect(widestBearing(count), `at ${count} players`).toBeLessThan(
        deg(MAX_LOOK_YAW - CLAMP_MARGIN),
      );
    }
  });

  it("gives every seat a forward vector pointing at the table centre", () => {
    for (const seat of seatLayout(MAX_PLAYERS)) {
      const forward = seatForward(seat);
      const toCentre = Math.hypot(seat.x, seat.z);
      const dot = (forward.x * -seat.x + forward.z * -seat.z) / toCentre;
      expect(dot).toBeGreaterThan(0.999);
    }
  });

  it("never puts two seats on top of each other", () => {
    for (let count = 2; count <= MAX_SEATS_SUPPORTED; count++) {
      const seats = seatLayout(count);
      for (const a of seats) {
        for (const b of seats) {
          if (a.index === b.index) continue;
          expect(
            Math.hypot(a.x - b.x, a.z - b.z),
            `${a.index} vs ${b.index} at ${count}`,
          ).toBeGreaterThan(0.45);
        }
      }
    }
  });

  it("puts every eye at the one shared eye height", () => {
    // Camera and face plane read this same constant. If they ever diverge,
    // every seat looks slightly over everyone's head.
    for (const seat of seatLayout(MAX_PLAYERS)) expect(seat.eyeY).toBe(EYE_HEIGHT);
  });
});

describe("assignSeats", () => {
  it("places players by seat index, whatever order they arrive in", () => {
    // Every client derives the ring independently, so two clients handed the
    // same players in different orders must agree, or nobody's eye-line meets.
    const a = assignSeats([4, 1, 2]);
    const b = assignSeats([2, 4, 1]);
    for (const seatIndex of [1, 2, 4]) {
      expect(a.get(seatIndex)).toEqual(b.get(seatIndex));
    }
    expect(a.get(1)!.index).toBe(0);
    expect(a.get(2)!.index).toBe(1);
    expect(a.get(4)!.index).toBe(2);
  });

  it("seats sparse server indices as a full ring", () => {
    // Seats 0 and 5 of a six-seat table are two people, not two ends of a
    // horseshoe: they should still end up face to face.
    const placed = assignSeats([0, 5]);
    expect(placed.size).toBe(2);
    const [a, b] = [...placed.values()];
    expect(deg(Math.abs(bearingBetweenSeats(a!, b!)))).toBeCloseTo(0);
  });

  it("leaves the earliest player where they were as the room fills", () => {
    // Slot 0 is anchored, so the person already at the table does not get
    // slid around every time somebody new walks in.
    const alone = assignSeats([0]).get(0)!;
    for (const others of [[0, 3], [0, 3, 4], [0, 1, 2, 3, 4, 5]]) {
      const seat = assignSeats(others).get(0)!;
      expect(seat.x).toBeCloseTo(alone.x);
      expect(seat.z).toBeCloseTo(alone.z);
    }
  });

  it("ignores duplicates rather than opening a phantom seat", () => {
    expect(assignSeats([2, 2, 2]).size).toBe(1);
  });

  it("handles an empty table", () => {
    expect(assignSeats([]).size).toBe(0);
  });
});
