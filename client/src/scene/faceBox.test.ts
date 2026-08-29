import { describe, expect, it } from "vitest";
import {
  decodeFaceBox,
  encodeFaceBox,
  FACE_BOX_BYTES,
  MIN_FACE_HEIGHT,
  sanitiseFaceBox,
  type FaceBox,
} from "./faceBox.js";

const box: FaceBox = { cx: 0.42, cy: 0.31, h: 0.28 };

/** Round-trips a payload the way the receiving client will. */
function roundTrip(input: FaceBox | null) {
  return decodeFaceBox(encodeFaceBox(input));
}

describe("faceBox wire format", () => {
  it("round-trips a box within quantisation error", () => {
    const decoded = roundTrip(box);
    expect(decoded.kind).toBe("box");
    if (decoded.kind !== "box") return;

    // uint16 over 0..1 is finer than a pixel on any webcam, so this bound is
    // generous by three orders of magnitude and still passes.
    expect(decoded.box.cx).toBeCloseTo(box.cx, 4);
    expect(decoded.box.cy).toBeCloseTo(box.cy, 4);
    expect(decoded.box.h).toBeCloseTo(box.h, 4);
  });

  it("distinguishes 'no face right now' from 'nothing arrived'", () => {
    // The difference matters: absent is a heartbeat that keeps a peer's last
    // framing alive, and silence is what eventually expires it.
    expect(roundTrip(null).kind).toBe("absent");
  });

  it("is a fixed-size datagram", () => {
    expect(encodeFaceBox(box).byteLength).toBe(FACE_BOX_BYTES);
    expect(encodeFaceBox(null).byteLength).toBe(FACE_BOX_BYTES);
  });

  it("rejects payloads that are not ours", () => {
    // Wrong length, wrong version, and a present flag that is neither 0 nor 1.
    expect(decodeFaceBox(new Uint8Array(0)).kind).toBe("invalid");
    expect(decodeFaceBox(new Uint8Array(FACE_BOX_BYTES - 1)).kind).toBe(
      "invalid",
    );
    expect(decodeFaceBox(new Uint8Array(FACE_BOX_BYTES + 1)).kind).toBe(
      "invalid",
    );

    const wrongVersion = encodeFaceBox(box);
    wrongVersion[0] = 99;
    expect(decodeFaceBox(wrongVersion).kind).toBe("invalid");

    const wrongFlag = encodeFaceBox(box);
    wrongFlag[1] = 7;
    expect(decodeFaceBox(wrongFlag).kind).toBe("invalid");
  });

  it("rejects a zero-height face rather than dividing by it", () => {
    // This is the one hostile value that matters. Face height divides into the
    // crop window, so a peer that can push a zero through here can make every
    // other client's framing degenerate.
    const zeroed = encodeFaceBox(box);
    zeroed[6] = 0;
    zeroed[7] = 0;
    expect(decodeFaceBox(zeroed).kind).toBe("invalid");
  });

  it("decodes a hand-built payload from a byte offset into a larger buffer", () => {
    // A transport is entitled to hand over a view into a pooled buffer, and
    // reading a DataView without honouring byteOffset silently decodes the
    // wrong bytes rather than failing.
    const encoded = encodeFaceBox(box);
    const backing = new Uint8Array(FACE_BOX_BYTES + 8);
    backing.set(encoded, 5);
    const view = backing.subarray(5, 5 + FACE_BOX_BYTES);

    const decoded = decodeFaceBox(view);
    expect(decoded.kind).toBe("box");
    if (decoded.kind !== "box") return;
    expect(decoded.box.cx).toBeCloseTo(box.cx, 4);
  });
});

describe("sanitiseFaceBox", () => {
  it("clamps a face that is half out of frame back onto the edge", () => {
    const clamped = sanitiseFaceBox({ cx: 1.4, cy: -0.3, h: 0.3 });
    expect(clamped).toEqual({ cx: 1, cy: 0, h: 0.3 });
  });

  it("caps a face taller than the frame", () => {
    const capped = sanitiseFaceBox({ cx: 0.5, cy: 0.5, h: 3 });
    expect(capped?.h).toBe(1);
  });

  it("rejects detector noise and non-finite numbers", () => {
    expect(sanitiseFaceBox({ cx: 0.5, cy: 0.5, h: 0 })).toBeNull();
    expect(
      sanitiseFaceBox({ cx: 0.5, cy: 0.5, h: MIN_FACE_HEIGHT / 2 }),
    ).toBeNull();
    expect(sanitiseFaceBox({ cx: Number.NaN, cy: 0.5, h: 0.3 })).toBeNull();
    expect(sanitiseFaceBox({ cx: 0.5, cy: Infinity, h: 0.3 })).toBeNull();
    expect(sanitiseFaceBox({ cx: 0.5, cy: 0.5, h: Number.NaN })).toBeNull();
  });
});
