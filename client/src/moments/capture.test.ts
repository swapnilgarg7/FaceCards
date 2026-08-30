import { describe, expect, it } from "vitest";
import type { FaceBox } from "../scene/faceBox.js";
import { capturable, faceRect } from "./capture.js";

/**
 * The two decisions in `capture.ts`: where in the frame to cut, and whether
 * there is a frame worth cutting at all. Both are pure, and both matter more
 * than they look - the first decides whether a Poker Moment is a face or a
 * picture of somebody's ceiling, and the second is what stands between a
 * declared `videoWidth` and a canvas allocation.
 */

const HD = { videoWidth: 1280, videoHeight: 720 };

/** Everything the rectangle must always be true of, whatever the input. */
function assertInsideFrame(
  rect: { sx: number; sy: number; sw: number; sh: number },
  width: number,
  height: number,
) {
  expect(rect.sw).toBeGreaterThan(0);
  expect(rect.sh).toBeGreaterThan(0);
  expect(rect.sx).toBeGreaterThanOrEqual(0);
  expect(rect.sy).toBeGreaterThanOrEqual(0);
  expect(rect.sx + rect.sw).toBeLessThanOrEqual(width + 1e-6);
  expect(rect.sy + rect.sh).toBeLessThanOrEqual(height + 1e-6);
}

describe("faceRect", () => {
  it("cuts a square out of a widescreen frame", () => {
    // The portrait is round, and a rectangle stretched into a circle is how
    // every webcam feature ever built made people look wrong.
    const rect = faceRect(HD.videoWidth, HD.videoHeight, null);
    expect(rect.sw).toBeCloseTo(rect.sh, 4);
    assertInsideFrame(rect, HD.videoWidth, HD.videoHeight);
  });

  it("stays square when the source is taller than it is wide", () => {
    const rect = faceRect(480, 640, null);
    expect(rect.sw).toBeCloseTo(rect.sh, 4);
    assertInsideFrame(rect, 480, 640);
  });

  it("follows a tracked face", () => {
    // A box on the left of the frame must produce a window on the left of the
    // frame. This is the flip that is easy to get backwards: `cy` is measured
    // downward and the crop window it comes from is measured upward.
    const left: FaceBox = { cx: 0.25, cy: 0.4, h: 0.3 };
    const right: FaceBox = { cx: 0.75, cy: 0.4, h: 0.3 };
    expect(faceRect(HD.videoWidth, HD.videoHeight, left).sx).toBeLessThan(
      faceRect(HD.videoWidth, HD.videoHeight, right).sx,
    );
  });

  it("puts a face near the top of the frame near the top of the cut", () => {
    const high: FaceBox = { cx: 0.5, cy: 0.2, h: 0.25 };
    const low: FaceBox = { cx: 0.5, cy: 0.8, h: 0.25 };
    expect(faceRect(HD.videoWidth, HD.videoHeight, high).sy).toBeLessThan(
      faceRect(HD.videoWidth, HD.videoHeight, low).sy,
    );
  });

  it("never samples outside the frame, wherever the face is", () => {
    // A face detected at the very edge would, cropped literally, sample past
    // the border and come back as a smear of stretched edge pixels.
    for (const cx of [0, 0.5, 1]) {
      for (const cy of [0, 0.5, 1]) {
        for (const h of [0.05, 0.4, 1]) {
          const rect = faceRect(HD.videoWidth, HD.videoHeight, { cx, cy, h });
          assertInsideFrame(rect, HD.videoWidth, HD.videoHeight);
        }
      }
    }
  });

  it("does not mirror", () => {
    // A moment card is shown to the whole table, and a mirrored portrait is
    // only correct for the one person looking at themselves.
    const rect = faceRect(HD.videoWidth, HD.videoHeight, {
      cx: 0.3,
      cy: 0.5,
      h: 0.3,
    });
    expect(rect.sw).toBeGreaterThan(0);
    expect(rect.sx).toBeLessThan(HD.videoWidth / 2);
  });
});

describe("capturable", () => {
  const el = (over: Partial<Parameters<typeof capturable>[0]>) =>
    capturable({ readyState: 4, videoWidth: 1280, videoHeight: 720, ...over });

  it("accepts a live element with a decoded frame", () => {
    expect(el({})).toBe(true);
  });

  it("refuses an element with no frame yet", () => {
    // The ordinary case at the moment a hand ends: a peer who joined a second
    // ago, or a camera that has just been turned back on.
    expect(el({ readyState: 0 })).toBe(false);
    expect(el({ readyState: 1 })).toBe(false);
  });

  it("refuses dimensions that have not loaded", () => {
    expect(el({ videoWidth: 0, videoHeight: 0 })).toBe(false);
  });

  it("refuses dimensions no camera could have", () => {
    // These numbers come from a track we did not create, through an SDK, from
    // a device driver, and they are about to size an allocation. A parser
    // accepting them is not the same as them being plausible.
    expect(el({ videoWidth: 999_999, videoHeight: 720 })).toBe(false);
    expect(el({ videoWidth: 1280, videoHeight: 1 })).toBe(false);
    expect(el({ videoWidth: 1, videoHeight: 720 })).toBe(false);
    expect(el({ videoWidth: Number.NaN, videoHeight: 720 })).toBe(false);
    expect(el({ videoWidth: Infinity, videoHeight: 720 })).toBe(false);
    expect(el({ videoWidth: -1280, videoHeight: -720 })).toBe(false);
  });

  it("accepts the aspect ratios real cameras actually publish", () => {
    for (const [w, h] of [
      [640, 480],
      [1280, 720],
      [1920, 1080],
      [480, 640],
      [720, 1280],
    ]) {
      expect(el({ videoWidth: w, videoHeight: h }), `${w}x${h}`).toBe(true);
    }
  });
});
