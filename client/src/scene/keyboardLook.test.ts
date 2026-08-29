import { describe, expect, it } from "vitest";
import {
  KEY_PITCH_SPEED,
  KEY_YAW_SPEED,
  keyLookScale,
  stepLookOffset,
} from "./keyboardLook.js";
import { MAX_LOOK_PITCH_DOWN, MAX_LOOK_PITCH_UP, MAX_LOOK_YAW } from "./layout.js";

const YAW = { min: -MAX_LOOK_YAW, max: MAX_LOOK_YAW };

/** Hold one direction for `seconds`, at 60 frames a second. */
function hold(
  axis: number,
  seconds: number,
  { base = 0, from = 0, speed = KEY_YAW_SPEED } = {},
): number {
  const step = 1 / 60;
  const frames = Math.round(seconds / step);
  let offset = from;
  for (let frame = 0; frame < frames; frame++) {
    offset = stepLookOffset(offset, axis, speed, step, base, YAW.min, YAW.max);
  }
  return offset;
}

describe("holding a look key", () => {
  it("turns at the speed it says it does", () => {
    expect(hold(1, 0.5)).toBeCloseTo(KEY_YAW_SPEED * 0.5, 2);
    expect(hold(-1, 0.5)).toBeCloseTo(-KEY_YAW_SPEED * 0.5, 2);
  });

  it("does nothing at all with no key down", () => {
    expect(hold(0, 2, { from: 0.4 })).toBe(0.4);
  });

  it("crosses the whole arc in about a second", () => {
    // The number that makes the keys usable rather than a novelty: looking
    // from one neighbour to another should not take longer than saying their
    // name. Two seconds of holding must be more than enough to reach the edge.
    expect(hold(1, 2)).toBeCloseTo(MAX_LOOK_YAW, 5);
    expect(hold(1, 1.05)).toBeCloseTo(MAX_LOOK_YAW, 5);
  });
});

describe("the arc is the arc", () => {
  it("never turns further than the cursor could", () => {
    expect(hold(1, 10)).toBeLessThanOrEqual(MAX_LOOK_YAW + 1e-9);
    expect(hold(-1, 10)).toBeGreaterThanOrEqual(-MAX_LOOK_YAW - 1e-9);
  });

  it("composes with the cursor rather than fighting it", () => {
    // The cursor is already asking for half the arc. A key held for a quarter
    // of a second adds its own quarter-second of turn on top, up to the edge.
    const base = MAX_LOOK_YAW * 0.5;
    const offset = hold(1, 0.25, { base });
    expect(base + offset).toBeCloseTo(base + KEY_YAW_SPEED * 0.25, 2);
    expect(base + offset).toBeLessThanOrEqual(MAX_LOOK_YAW + 1e-9);
  });

  it("gives up its offset when the cursor takes the view there instead", () => {
    // Held to the left edge by the keys, then the cursor arrives at the same
    // edge. There is no room left for the keys to contribute, so they stop
    // contributing rather than pushing the view past the clamp.
    const offset = hold(1, 3, { base: MAX_LOOK_YAW });
    expect(offset).toBeCloseTo(0, 6);
  });
});

describe("windup", () => {
  it("reverses the instant the other key is pressed", () => {
    // The bug this exists to prevent: hold A against the clamp for two
    // seconds, then press D, and nothing happens for two seconds while an
    // invisible debt is paid off.
    const pinned = hold(1, 2);
    expect(pinned).toBeCloseTo(MAX_LOOK_YAW, 5);

    const afterOneFrame = stepLookOffset(
      pinned,
      -1,
      KEY_YAW_SPEED,
      1 / 60,
      0,
      YAW.min,
      YAW.max,
    );
    expect(afterOneFrame).toBeLessThan(pinned);
    expect(pinned - afterOneFrame).toBeCloseTo(KEY_YAW_SPEED / 60, 5);
  });

  it("banks nothing while the cursor is holding the view at the edge", () => {
    // Pinned by the cursor for a long time, then the cursor recentres. The
    // view must be back where the keys actually left it, not flung to the far
    // side by seconds of stored-up turn.
    let offset = 0;
    for (let i = 0; i < 300; i++) {
      offset = stepLookOffset(
        offset,
        1,
        KEY_YAW_SPEED,
        1 / 60,
        MAX_LOOK_YAW,
        YAW.min,
        YAW.max,
      );
    }
    expect(offset).toBeCloseTo(0, 6);
  });
});

describe("pitch, which is asymmetric", () => {
  it("respects the shorter arc upward than downward", () => {
    const up = (seconds: number) => {
      const step = 1 / 60;
      let offset = 0;
      for (let frame = 0; frame < Math.round(seconds / step); frame++) {
        offset = stepLookOffset(
          offset,
          1,
          KEY_PITCH_SPEED,
          step,
          0,
          -MAX_LOOK_PITCH_DOWN,
          MAX_LOOK_PITCH_UP,
        );
      }
      return offset;
    };
    const down = (seconds: number) => {
      const step = 1 / 60;
      let offset = 0;
      for (let frame = 0; frame < Math.round(seconds / step); frame++) {
        offset = stepLookOffset(
          offset,
          -1,
          KEY_PITCH_SPEED,
          step,
          0,
          -MAX_LOOK_PITCH_DOWN,
          MAX_LOOK_PITCH_UP,
        );
      }
      return offset;
    };

    expect(up(5)).toBeCloseTo(MAX_LOOK_PITCH_UP, 5);
    expect(down(5)).toBeCloseTo(-MAX_LOOK_PITCH_DOWN, 5);
    expect(Math.abs(down(5))).toBeGreaterThan(up(5));
  });
});

describe("a frame that took too long", () => {
  it("does not teleport the view when the tab wakes up", () => {
    // A backgrounded tab hands `useFrame` one enormous delta. Without a cap,
    // a key that happened to be down when the tab lost focus would slam the
    // view into the stops the moment it came back.
    const capped = stepLookOffset(0, 1, KEY_YAW_SPEED, 30, 0, YAW.min, YAW.max);
    expect(capped).toBeCloseTo(KEY_YAW_SPEED * 0.1, 6);
  });

  it("treats a nonsense delta as no time at all", () => {
    expect(stepLookOffset(0.2, 1, KEY_YAW_SPEED, NaN, 0, YAW.min, YAW.max)).toBe(
      0.2,
    );
  });
});

describe("sensitivity", () => {
  it("scales how fast the keys turn, never how far they reach", () => {
    expect(keyLookScale(0)).toBeLessThan(keyLookScale(0.5));
    expect(keyLookScale(0.5)).toBeLessThan(keyLookScale(1));
    expect(keyLookScale(0)).toBeGreaterThan(0);

    // The arc is the arc at every setting: the clamp does not move.
    for (const sensitivity of [0, 0.5, 1]) {
      const offset = hold(1, 10, {
        speed: KEY_YAW_SPEED * keyLookScale(sensitivity),
      });
      expect(offset).toBeCloseTo(MAX_LOOK_YAW, 5);
    }
  });

  it("falls back to the middle for a value that is not a number", () => {
    expect(keyLookScale(Number.NaN)).toBe(keyLookScale(0.5));
    expect(keyLookScale(-5)).toBe(keyLookScale(0));
    expect(keyLookScale(99)).toBe(keyLookScale(1));
  });
});
