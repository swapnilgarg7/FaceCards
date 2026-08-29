import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, MAX_SEATS_SUPPORTED } from "@facecards/shared";
import {
  EYE_HEIGHT,
  MAX_LOOK_YAW,
  bearingBetweenSeats,
  seatForward,
  seatLayout,
} from "./layout.js";

/** Comfortable head turn without leaning. Your neighbour is beyond this. */
const COMFORTABLE_LOOK_ARC = (85 * Math.PI) / 180;

/** A face right on the yaw clamp is reachable but never centred. */
const CLAMP_MARGIN = (4 * Math.PI) / 180;

describe("seatLayout", () => {
  it("lays out the table's full capacity, not the current occupancy", () => {
    expect(seatLayout()).toHaveLength(MAX_PLAYERS);
    expect(seatLayout(3)).toHaveLength(3);
  });

  it("gives every seat a forward vector pointing at the table centre", () => {
    for (const seat of seatLayout()) {
      const forward = seatForward(seat);
      const toCentre = Math.hypot(seat.x, seat.z);
      // Dot of the unit forward with the unit direction to the origin.
      const dot = (forward.x * -seat.x + forward.z * -seat.z) / toCentre;
      expect(dot).toBeGreaterThan(0.999);
    }
  });

  it("leaves every face reachable within the camera's yaw clamp", () => {
    // The criterion that actually matters: if a seat sits outside the look
    // clamp, that player is permanently unlookable-at, which is the one thing
    // this whole product cannot survive.
    for (const count of [2, 3, 4, 5, 6, MAX_SEATS_SUPPORTED]) {
      const seats = seatLayout(count);
      for (const from of seats) {
        for (const to of seats) {
          if (from.index === to.index) continue;
          const bearing = Math.abs(bearingBetweenSeats(from, to));
          expect(
            bearing,
            `seat ${from.index} -> ${to.index} at ${count} players`,
          ).toBeLessThan(MAX_LOOK_YAW - CLAMP_MARGIN);
        }
      }
    }
  });

  it("keeps everyone but your immediate neighbours in easy view", () => {
    // Your neighbour sits beside you at a real table too, so ~80 degrees is
    // correct rather than a layout bug. Everyone else should need no more
    // than an easy turn, which is what the horseshoe buys over a full ring.
    for (const count of [2, 3, 4, 5, 6, MAX_SEATS_SUPPORTED]) {
      const seats = seatLayout(count);
      for (const from of seats) {
        for (const to of seats) {
          if (Math.abs(from.index - to.index) <= 1) continue;
          const bearing = Math.abs(bearingBetweenSeats(from, to));
          expect(
            bearing,
            `seat ${from.index} -> ${to.index} at ${count} players`,
          ).toBeLessThan(COMFORTABLE_LOOK_ARC);
        }
      }
    }
  });

  it("seats two players roughly facing each other", () => {
    const [a, b] = seatLayout(2);
    expect(Math.abs(bearingBetweenSeats(a!, b!))).toBeLessThan(
      (25 * Math.PI) / 180,
    );
  });

  it("never puts two seats on top of each other", () => {
    const seats = seatLayout(MAX_SEATS_SUPPORTED);
    for (const a of seats) {
      for (const b of seats) {
        if (a.index === b.index) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.4);
      }
    }
  });

  it("puts every eye at the one shared eye height", () => {
    // Camera and face plane read this same constant. If they ever diverge,
    // every seat looks slightly over everyone's head.
    for (const seat of seatLayout()) expect(seat.eyeY).toBe(EYE_HEIGHT);
  });
});
