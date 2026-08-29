import { describe, expect, it } from "vitest";
import {
  BOARD_SIZE,
  CARD_HEIGHT,
  CARD_REST_Y,
  CARD_THICKNESS,
  CARD_WIDTH,
  DECK_SIZE,
  FACE_UP_PITCH,
  boardSpot,
  cardIndex,
  cardName,
  deckSpot,
  holeSpot,
  muckSpot,
  peekPose,
} from "./cards.js";
import { EYE_HEIGHT, SEAT_OUTSET, TABLE, seatLayout } from "./layout.js";

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
        expect(spot.y).toBeGreaterThanOrEqual(CARD_REST_Y);
        // Still paper on felt, not a card hovering over the table.
        expect(spot.y - CARD_REST_Y).toBeLessThan(CARD_THICKNESS * 3);
      }
    }
  });

  it("puts one card of the pair on top of the other", () => {
    // The pair overlaps on purpose, and two overlapping cards at the same
    // height z-fight: the depth buffer cannot say which face wins, so the
    // overlap strobes as the camera moves. One is physically on top.
    for (const seat of ring) {
      const lift = holeSpot(seat, 1).y - holeSpot(seat, 0).y;
      expect(lift).toBeGreaterThanOrEqual(CARD_THICKNESS);
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

describe("peekPose", () => {
  const ring = seatLayout(6);

  it("leaves a card exactly where it lies when nothing is being held", () => {
    for (const seat of ring) {
      const spot = holeSpot(seat, 0);
      const pose = peekPose(spot, FACE_UP_PITCH, 0, -1);
      expect(pose.x).toBeCloseTo(spot.x, 10);
      expect(pose.y).toBeCloseTo(spot.y, 10);
      expect(pose.z).toBeCloseTo(spot.z, 10);
      expect(pose.pitch).toBeCloseTo(FACE_UP_PITCH, 10);
      expect(pose.roll).toBeCloseTo(0, 10);
    }
  });

  it("brings the hand up into the frame instead of under the chin", () => {
    // The bug this replaced: the old peek lifted 4cm and pulled the pair 4cm
    // *towards* a player whose eye was already 40cm above it, which put the
    // cards below the bottom of a level 55-degree lens. A hand held to be
    // looked at has to end up in front of the eye, not under it.
    const halfFov = (55 / 2) * (Math.PI / 180);
    for (const seat of ring) {
      for (const index of [0, 1]) {
        const pose = peekPose(holeSpot(seat, index), FACE_UP_PITCH, 1, index * 2 - 1);
        const eyeRadius = TABLE.radius + SEAT_OUTSET;
        const held = Math.hypot(pose.x, pose.z);
        // Still in front of the player rather than behind or beside them.
        const inFront = eyeRadius - held;
        expect(inFront).toBeGreaterThan(0.2);
        // And inside a level lens: the angle down to the hand is less than
        // half the vertical field of view.
        const drop = EYE_HEIGHT - pose.y;
        expect(drop).toBeGreaterThan(0);
        expect(Math.atan2(drop, inFront)).toBeLessThan(halfFov);
      }
    }
  });

  it("turns the face of the card at the eye that is reading it", () => {
    const seat = ring[0]!;
    const pose = peekPose(holeSpot(seat, 0), FACE_UP_PITCH, 1, -1);
    // The card's normal, from the same rotation the mesh is given.
    const outX = Math.sin(seat.yaw);
    const outZ = Math.cos(seat.yaw);
    const normal = {
      x: Math.cos(pose.pitch) * outX,
      y: -Math.sin(pose.pitch),
      z: Math.cos(pose.pitch) * outZ,
    };
    const eyeRadius = TABLE.radius + SEAT_OUTSET;
    const toEye = {
      x: outX * eyeRadius - pose.x,
      y: EYE_HEIGHT - pose.y,
      z: outZ * eyeRadius - pose.z,
    };
    const length = Math.hypot(toEye.x, toEye.y, toEye.z);
    const cosine =
      (normal.x * toEye.x + normal.y * toEye.y + normal.z * toEye.z) / length;
    // Within about 12 degrees of square on, which is a hand being read.
    expect(cosine).toBeGreaterThan(Math.cos((12 * Math.PI) / 180));
  });

  it("fans the pair open rather than sliding one card over the other", () => {
    for (const seat of ring) {
      const left = peekPose(holeSpot(seat, 0), FACE_UP_PITCH, 1, -1);
      const right = peekPose(holeSpot(seat, 1), FACE_UP_PITCH, 1, 1);

      // The two leaves lean opposite ways, which is the fan.
      expect(left.roll).toBeGreaterThan(0);
      expect(right.roll).toBeLessThan(0);
      expect(left.roll).toBeCloseTo(-right.roll, 10);

      // Their tops are further apart than their centres: they hinge from
      // below rather than simply sliding sideways.
      const centres = Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
      const along = CARD_HEIGHT / 2;
      const topOf = (pose: typeof left, yaw: number) => ({
        x: pose.x + along * (Math.sin(pose.pitch) * Math.sin(yaw) * Math.cos(pose.roll) - Math.cos(yaw) * Math.sin(pose.roll)),
        y: pose.y + along * Math.cos(pose.pitch) * Math.cos(pose.roll),
        z: pose.z + along * (Math.sin(pose.pitch) * Math.cos(yaw) * Math.cos(pose.roll) + Math.sin(yaw) * Math.sin(pose.roll)),
      });
      const lt = topOf(left, seat.yaw);
      const rt = topOf(right, seat.yaw);
      const tops = Math.hypot(lt.x - rt.x, lt.y - rt.y, lt.z - rt.z);
      expect(tops).toBeGreaterThan(centres);

      // Still one hand: the pair overlaps at the grip rather than becoming
      // two cards standing separately on a table.
      expect(centres).toBeLessThan(CARD_WIDTH);
      // And one leaf is in front of the other by more than the paper is
      // thick, which is what stops the overlap strobing.
      const outward = {
        x: Math.cos(left.pitch) * Math.sin(seat.yaw),
        y: -Math.sin(left.pitch),
        z: Math.cos(left.pitch) * Math.cos(seat.yaw),
      };
      const apart =
        (right.x - left.x) * outward.x +
        (right.y - left.y) * outward.y +
        (right.z - left.z) * outward.z;
      expect(Math.abs(apart)).toBeGreaterThan(CARD_THICKNESS);
    }
  });

  it("does not fan a card that is not part of a hand", () => {
    const pose = peekPose(holeSpot(ring[0]!, 0), FACE_UP_PITCH, 1, 0);
    expect(pose.roll).toBeCloseTo(0, 10);
  });
});
