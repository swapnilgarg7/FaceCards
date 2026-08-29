import { describe, expect, it } from "vitest";
import { faceCrop, FOCUS_FACE_FILL, type CropOptions } from "./faceCrop.js";
import type { FaceBox } from "./faceBox.js";

const base: CropOptions = {
  videoWidth: 960,
  videoHeight: 540,
  planeAspect: 0.75,
  zoom: 1,
  yBias: 0,
  mirror: false,
};

/** The sampled window must stay inside the source image on both axes. */
function expectInsideSource(crop: ReturnType<typeof faceCrop>): void {
  const left = Math.min(crop.offsetX, crop.offsetX + crop.repeatX);
  const right = Math.max(crop.offsetX, crop.offsetX + crop.repeatX);
  expect(left).toBeGreaterThanOrEqual(-1e-9);
  expect(right).toBeLessThanOrEqual(1 + 1e-9);
  expect(crop.offsetY).toBeGreaterThanOrEqual(-1e-9);
  expect(crop.offsetY + crop.repeatY).toBeLessThanOrEqual(1 + 1e-9);
}

describe("faceCrop", () => {
  it("crops a 16:9 webcam to a portrait plane without squashing it", () => {
    const crop = faceCrop(base);
    // Full height, narrowed width: the plane's aspect is honoured exactly.
    expect(crop.repeatY).toBeCloseTo(1);
    expect(crop.repeatX).toBeCloseTo(0.75 / (960 / 540));
    // Sampled region's aspect in source pixels matches the plane's aspect.
    const sampledAspect =
      (crop.repeatX * 960) / (crop.repeatY * 540);
    expect(sampledAspect).toBeCloseTo(base.planeAspect);
    expectInsideSource(crop);
  });

  it("centres the crop horizontally", () => {
    const crop = faceCrop(base);
    expect(crop.offsetX).toBeCloseTo((1 - crop.repeatX) / 2);
  });

  it("mirrors by walking the same window backwards", () => {
    const plain = faceCrop(base);
    const mirrored = faceCrop({ ...base, mirror: true });

    expect(mirrored.repeatX).toBeCloseTo(-plain.repeatX);
    // uv 0 now lands on the window's right edge and uv 1 on its left, so the
    // window itself is unchanged: only the direction of travel flipped.
    expect(mirrored.offsetX).toBeCloseTo(plain.offsetX + plain.repeatX);
    expect(mirrored.offsetX + mirrored.repeatX).toBeCloseTo(plain.offsetX);
    expect(mirrored.repeatY).toBeCloseTo(plain.repeatY);
    expectInsideSource(mirrored);
  });

  it("zooms in on the face without leaving the frame", () => {
    const wide = faceCrop(base);
    const tight = faceCrop({ ...base, zoom: 0.6 });

    expect(tight.repeatX).toBeLessThan(wide.repeatX);
    expect(tight.repeatY).toBeLessThan(wide.repeatY);
    // Still the plane's aspect, just a smaller window.
    expect(tight.repeatX / tight.repeatY).toBeCloseTo(
      wide.repeatX / wide.repeatY,
    );
    expectInsideSource(tight);
  });

  it("biases the window upward, where faces actually are", () => {
    const centred = faceCrop({ ...base, zoom: 0.6 });
    const raised = faceCrop({ ...base, zoom: 0.6, yBias: 0.1 });
    expect(raised.offsetY).toBeGreaterThan(centred.offsetY);
    expectInsideSource(raised);
  });

  it("clamps an over-large bias instead of sampling outside the frame", () => {
    // Sampling past the edge does not error, it smears the edge pixel row
    // across the top of someone's face, which looks like a rendering bug.
    const crop = faceCrop({ ...base, zoom: 0.6, yBias: 99 });
    expectInsideSource(crop);
  });

  it("falls back to an uncropped fit when the element has no dimensions yet", () => {
    // videoWidth is 0 until metadata loads. Deriving a crop from it would
    // divide by zero, and trusting a garbage aspect would frame nothing.
    for (const bad of [
      { videoWidth: 0, videoHeight: 0 },
      { videoWidth: 640, videoHeight: 0 },
      { videoWidth: 4, videoHeight: 4000 },
      { videoWidth: 40000, videoHeight: 4 },
      { videoWidth: Number.NaN, videoHeight: 480 },
    ]) {
      const crop = faceCrop({ ...base, ...bad });
      expect(Number.isFinite(crop.repeatX)).toBe(true);
      expect(Number.isFinite(crop.offsetY)).toBe(true);
      expect(crop.repeatX).toBeCloseTo(1);
      expect(crop.repeatY).toBeCloseTo(1);
      expectInsideSource(crop);
    }
  });

  it("crops the other way for a portrait source", () => {
    const crop = faceCrop({ ...base, videoWidth: 480, videoHeight: 960 });
    expect(crop.repeatX).toBeCloseTo(1);
    expect(crop.repeatY).toBeLessThan(1);
    expectInsideSource(crop);
  });
});

describe("faceCrop with a tracked face", () => {
  /** Middle of the frame, a comfortable arm's length from the camera. */
  const focus: FaceBox = { cx: 0.5, cy: 0.4, h: 0.3 };

  /** Centre of the sampled window, back in image coordinates (y downward). */
  function windowCentre(crop: ReturnType<typeof faceCrop>) {
    return {
      cx: crop.offsetX + crop.repeatX / 2,
      cy: 1 - (crop.offsetY + crop.repeatY / 2),
    };
  }

  it("centres the window on the face", () => {
    const crop = faceCrop({ ...base, focus });
    const centre = windowCentre(crop);
    expect(centre.cx).toBeCloseTo(focus.cx);
    expect(centre.cy).toBeCloseTo(focus.cy);
    expectInsideSource(crop);
  });

  it("sizes the window so the face fills a known fraction of it", () => {
    const crop = faceCrop({ ...base, focus });
    // This is the framing decision made numeric: change FOCUS_FACE_FILL and
    // this is the test that tells you what you changed.
    expect(focus.h / crop.repeatY).toBeCloseTo(FOCUS_FACE_FILL);
    expectInsideSource(crop);
  });

  it("keeps the plane's aspect in source pixels, like the fixed crop does", () => {
    const crop = faceCrop({ ...base, focus });
    const sampledAspect =
      (crop.repeatX * base.videoWidth) / (crop.repeatY * base.videoHeight);
    expect(sampledAspect).toBeCloseTo(base.planeAspect);
  });

  it("supersedes zoom and yBias rather than compounding with them", () => {
    // Two guesses about where a face is do not average into a better guess.
    const plain = faceCrop({ ...base, focus });
    const fiddled = faceCrop({ ...base, focus, zoom: 0.3, yBias: 0.4 });
    expect(fiddled).toEqual(plain);
  });

  it("follows the face up the frame", () => {
    // A face nearer the top of the image must raise the window, which in UV
    // terms means a *larger* offsetY. Getting this flip backwards is the
    // classic version of this bug and it looks almost plausible on screen.
    const high = faceCrop({ ...base, focus: { ...focus, cy: 0.2 } });
    const low = faceCrop({ ...base, focus: { ...focus, cy: 0.7 } });
    expect(high.offsetY).toBeGreaterThan(low.offsetY);
    expectInsideSource(high);
    expectInsideSource(low);
  });

  it("follows the face across the frame", () => {
    const left = faceCrop({ ...base, focus: { ...focus, cx: 0.2 } });
    const right = faceCrop({ ...base, focus: { ...focus, cx: 0.8 } });
    expect(left.offsetX).toBeLessThan(right.offsetX);
    expectInsideSource(left);
    expectInsideSource(right);
  });

  it("zooms out as someone leans toward the camera", () => {
    const far = faceCrop({ ...base, focus: { ...focus, h: 0.2 } });
    const near = faceCrop({ ...base, focus: { ...focus, h: 0.55 } });
    expect(near.repeatY).toBeGreaterThan(far.repeatY);
    expectInsideSource(near);
    expectInsideSource(far);
  });

  it("slides the window inside the frame rather than sampling off the edge", () => {
    // Someone sitting hard against the left of the frame. The window cannot be
    // centred on them without leaving the image, and leaving the image smears
    // a column of edge pixels across their cheek.
    for (const edge of [
      { cx: 0, cy: 0.5 },
      { cx: 1, cy: 0.5 },
      { cx: 0.5, cy: 0 },
      { cx: 0.5, cy: 1 },
      { cx: 0, cy: 0 },
      { cx: 1, cy: 1 },
    ]) {
      const crop = faceCrop({ ...base, focus: { ...focus, ...edge } });
      expectInsideSource(crop);
    }
  });

  it("caps the window at the whole frame for a very close face", () => {
    const crop = faceCrop({ ...base, focus: { ...focus, h: 1 } });
    expect(crop.repeatY).toBeLessThanOrEqual(1);
    expectInsideSource(crop);
  });

  it("does not magnify a tiny detection into a blur", () => {
    // A far-away face on a wide-angle laptop camera. Following it literally
    // would stretch a handful of pixels across the whole plane.
    const crop = faceCrop({ ...base, focus: { ...focus, h: 0.05 } });
    expect(crop.repeatY).toBeGreaterThan(0.05 / FOCUS_FACE_FILL);
    expectInsideSource(crop);
  });

  it("mirrors without moving the framing", () => {
    // The box is measured on the raw frame, and mirroring is a property of who
    // is looking. If this ever fails, self-view and everyone else disagree
    // about which way a head is turned.
    const plain = faceCrop({ ...base, focus });
    const mirrored = faceCrop({ ...base, focus, mirror: true });

    expect(mirrored.repeatX).toBeCloseTo(-plain.repeatX);
    expect(mirrored.offsetX).toBeCloseTo(plain.offsetX + plain.repeatX);
    expect(mirrored.offsetX + mirrored.repeatX).toBeCloseTo(plain.offsetX);
    expect(mirrored.repeatY).toBeCloseTo(plain.repeatY);
    expect(mirrored.offsetY).toBeCloseTo(plain.offsetY);
    expectInsideSource(mirrored);
  });

  it("stays inside the frame for a portrait source", () => {
    const crop = faceCrop({
      ...base,
      videoWidth: 480,
      videoHeight: 960,
      focus: { cx: 0.5, cy: 0.3, h: 0.5 },
    });
    expect(crop.repeatX).toBeLessThanOrEqual(1 + 1e-9);
    expectInsideSource(crop);
    // Still the plane's aspect after the width-limited rescale.
    const sampledAspect = (crop.repeatX * 480) / (crop.repeatY * 960);
    expect(sampledAspect).toBeCloseTo(base.planeAspect);
  });

  it("falls back to the fixed crop when there is no focus", () => {
    expect(faceCrop({ ...base, focus: null })).toEqual(faceCrop(base));
  });
});
