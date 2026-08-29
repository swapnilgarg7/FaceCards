import { describe, expect, it } from "vitest";
import { faceCrop, type CropOptions } from "./faceCrop.js";

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
