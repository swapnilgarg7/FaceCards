/**
 * Where a person's face sits inside their own camera frame, and how that
 * travels between clients.
 *
 * Detection runs once, on the machine that owns the camera, and the result is
 * broadcast. The alternative - every client detecting on every remote video -
 * costs six detectors per machine instead of one, and runs them on downscaled
 * simulcast layers where accuracy is worst. So the sender does the work and
 * everyone else is handed the answer.
 *
 * Pure: no three.js, no DOM, no vendor SDK. The transport is somebody else's
 * problem; this file only knows the shape and the bytes.
 */

/**
 * A framing target in *source-frame* coordinates, normalised to 0..1.
 *
 * `cy` runs top-to-bottom, the way an image is indexed and the way MediaPipe
 * reports it. It is deliberately not UV space: the flip belongs in `faceCrop`,
 * next to the rest of the texture maths, not smeared across two files.
 *
 * These coordinates are on the *raw* frame, before any mirroring. Mirroring is
 * a property of who is looking, not of where the face is, so a box means the
 * same thing on the sender and on every receiver.
 */
export interface FaceBox {
  /** Horizontal centre of the framing target, 0 = left edge of the frame. */
  cx: number;
  /** Vertical centre of the framing target, 0 = top edge of the frame. */
  cy: number;
  /** Detected face height as a fraction of the frame height. */
  h: number;
}

/** Datagram topic. Anything on another topic is not ours. */
export const FACE_BOX_TOPIC = "facebox";

/** Bumped if the layout below ever changes, so old senders decode as invalid. */
const WIRE_VERSION = 1;

/** version, present flag, then three uint16 fields. */
export const FACE_BOX_BYTES = 8;

/**
 * A face smaller than this is not a face, it is a detector twitching at a
 * pattern on someone's wall. It also guards the crop: window height is derived
 * by dividing by this number, so zero here is a division by zero downstream.
 */
export const MIN_FACE_HEIGHT = 0.04;

/**
 * A face taller than the frame is possible - lean close enough and your chin
 * leaves the picture - but the crop window saturates at the whole frame long
 * before that, so there is nothing to gain from representing it.
 */
export const MAX_FACE_HEIGHT = 1;

/** What arrived on the wire, as three cases that must each be handled. */
export type DecodedFaceBox =
  /** A usable framing target. */
  | { kind: "box"; box: FaceBox }
  /** The sender is tracking and currently sees no face. Hold what you have. */
  | { kind: "absent" }
  /** Wrong length, wrong version, or implausible numbers. Drop it. */
  | { kind: "invalid" };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 0..1 -> uint16. Finer than a pixel on any webcam ever made. */
function quantise(v: number): number {
  return Math.round(clamp(v, 0, 1) * 0xffff);
}

function dequantise(v: number): number {
  return v / 0xffff;
}

/**
 * Clamp a locally measured box into the range the wire can carry. Called on
 * the sending side, so the receiver's own validation is a second line of
 * defence rather than the only one.
 */
export function sanitiseFaceBox(box: FaceBox): FaceBox | null {
  if (!Number.isFinite(box.cx) || !Number.isFinite(box.cy)) return null;
  if (!Number.isFinite(box.h)) return null;
  if (box.h < MIN_FACE_HEIGHT) return null;
  return {
    cx: clamp(box.cx, 0, 1),
    cy: clamp(box.cy, 0, 1),
    h: clamp(box.h, MIN_FACE_HEIGHT, MAX_FACE_HEIGHT),
  };
}

/**
 * `null` encodes "tracking, no face right now", which is not the same as
 * sending nothing at all: a steady stream is what lets a receiver tell a peer
 * who has looked away from a peer whose tracker has died.
 */
export function encodeFaceBox(box: FaceBox | null): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(FACE_BOX_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, WIRE_VERSION);

  const safe = box ? sanitiseFaceBox(box) : null;
  if (!safe) {
    view.setUint8(1, 0);
    return bytes;
  }

  view.setUint8(1, 1);
  view.setUint16(2, quantise(safe.cx));
  view.setUint16(4, quantise(safe.cy));
  view.setUint16(6, quantise(safe.h));
  return bytes;
}

/**
 * Bytes from another client, so nothing here is trusted. Every field is
 * range-checked before it can reach a texture window: this number ends up
 * dividing into a crop, and a hostile or simply buggy peer must not be able to
 * make that degenerate.
 */
export function decodeFaceBox(payload: Uint8Array): DecodedFaceBox {
  if (payload.byteLength !== FACE_BOX_BYTES) return { kind: "invalid" };

  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength,
  );
  if (view.getUint8(0) !== WIRE_VERSION) return { kind: "invalid" };

  const present = view.getUint8(1);
  if (present === 0) return { kind: "absent" };
  if (present !== 1) return { kind: "invalid" };

  const box: FaceBox = {
    cx: dequantise(view.getUint16(2)),
    cy: dequantise(view.getUint16(4)),
    h: dequantise(view.getUint16(6)),
  };

  // Quantisation cannot produce anything outside 0..1, so the only thing left
  // to reject is a height too small to divide by. Checked rather than assumed,
  // because "the encoder can't emit that" stops being true the moment someone
  // writes a second encoder.
  const safe = sanitiseFaceBox(box);
  return safe ? { kind: "box", box: safe } : { kind: "invalid" };
}
