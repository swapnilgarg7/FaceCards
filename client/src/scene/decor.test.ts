import { describe, expect, it } from "vitest";
import {
  AMBIENT_MOTION_MAX,
  FIXTURES,
  PILASTER_COUNT,
  ROOM_HEIGHT,
  ROOM_RADIUS,
  WAINSCOT_HEIGHT,
  clearsFaceBand,
  faceBand,
  neonBreath,
} from "./decor.js";
import { TABLE, SEAT_OUTSET, EYE_HEIGHT } from "./layout.js";
import { RAIL_OUTER } from "./tableProfile.js";

describe("nothing that glows sits in the face band", () => {
  // The mechanical form of the phase-5 exit criterion. A room five metres
  // across puts the far wall directly behind somebody's head from every seat,
  // so a fixture at eye height is a halo on a face - which is the one thing
  // the art direction may not do.
  for (const fixture of FIXTURES) {
    it(`${fixture.id} clears it`, () => {
      expect(clearsFaceBand(fixture)).toBe(true);
    });
  }

  it("puts the band around the eye-line the whole scene is built on", () => {
    const band = faceBand();
    expect(band.low).toBeLessThan(EYE_HEIGHT);
    expect(band.high).toBeGreaterThan(EYE_HEIGHT);
  });

  it("would catch a fixture moved into it", () => {
    // The check is only worth having if it can fail, so prove that it does.
    const band = faceBand();
    expect(
      clearsFaceBand({
        id: "hypothetical",
        y: EYE_HEIGHT,
        halfHeight: 0.05,
        radius: ROOM_RADIUS,
        colour: "#fff",
      }),
    ).toBe(false);
    expect(band.high - band.low).toBeGreaterThan(0.4);
  });
});

describe("the room is a room, not a hall", () => {
  it("leaves a walkway behind the seats without becoming explorable", () => {
    const seatRadius = TABLE.radius + SEAT_OUTSET;
    expect(ROOM_RADIUS).toBeGreaterThan(seatRadius + 1);
    // `plan.md`: "Do not build a large explorable casino." Anything past this
    // stops being a room around a table and starts being scenery.
    expect(ROOM_RADIUS).toBeLessThan(5);
  });

  it("caps the panelling below the rail, so no line crosses a face", () => {
    // A horizontal band at chin height, running right round the room behind
    // everybody, is the sort of thing nobody points at and everybody registers.
    expect(WAINSCOT_HEIGHT).toBeGreaterThan(TABLE.topY);
    expect(WAINSCOT_HEIGHT).toBeLessThan(faceBand().low);
  });

  it("stands clear of the table", () => {
    expect(ROOM_RADIUS).toBeGreaterThan(RAIL_OUTER + 1);
    expect(ROOM_HEIGHT).toBeGreaterThan(2.6);
  });

  it("rings the room evenly, so no seat faces a blank wall", () => {
    // Same argument as `seatLayout`: anything that is not rotationally
    // symmetric quietly picks a favourite seat.
    expect(PILASTER_COUNT % 2).toBe(0);
    expect(PILASTER_COUNT).toBeGreaterThanOrEqual(6);
    for (const fixture of FIXTURES) {
      expect(fixture.radius).toBeLessThanOrEqual(ROOM_RADIUS);
    }
  });
});

describe("background motion", () => {
  it("never varies further than the ceiling it declares", () => {
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < 4000; t += 0.05) {
      const breath = neonBreath(t);
      low = Math.min(low, breath);
      high = Math.max(high, breath);
    }
    expect(low).toBeGreaterThanOrEqual(1 - AMBIENT_MOTION_MAX - 1e-9);
    expect(high).toBeLessThanOrEqual(1 + AMBIENT_MOTION_MAX + 1e-9);
    // And it is not simply constant, which would pass the bound and be dead.
    expect(high - low).toBeGreaterThan(AMBIENT_MOTION_MAX);
  });

  it("keeps the ceiling low enough to stay background", () => {
    expect(AMBIENT_MOTION_MAX).toBeLessThanOrEqual(0.08);
  });

  it("never finds a period inside an evening", () => {
    // A single sine has a period, and a found period is a thing that is
    // moving rather than a room that is alive. Two incommensurate bands mean
    // the first hour never repeats the first minute.
    const early = Array.from({ length: 240 }, (_, i) => neonBreath(i * 0.25));
    const late = Array.from({ length: 240 }, (_, i) => neonBreath(3600 + i * 0.25));
    const drift = early.reduce(
      (worst, value, i) => Math.max(worst, Math.abs(value - late[i]!)),
      0,
    );
    expect(drift).toBeGreaterThan(0.01);
  });
});
