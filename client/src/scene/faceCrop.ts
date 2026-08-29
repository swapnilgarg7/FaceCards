/**
 * Webcam frame -> face plane UV window.
 *
 * A webcam is 16:9 and a face plane is a portrait oval. Stretching one onto
 * the other squashes every face, so the frame has to be *cropped*: pick a
 * window inside the source image and map the plane onto exactly that.
 *
 * Two ways to pick that window. With a `focus` - a detected face box, from the
 * tracker on the machine that owns the camera - the window follows the face.
 * Without one, it falls back to a fixed `zoom` and `yBias`, which is where
 * everyone sat before detection existed and where they sit again if the model
 * fails to load.
 *
 * Pure maths, no three.js, so the framing can be unit-tested rather than
 * eyeballed. The result is applied to `texture.repeat` and `texture.offset`.
 */

import { type FaceBox } from "./faceBox.js";

export interface CropWindow {
  /** three.js `texture.repeat`. Negative x means the image is mirrored. */
  repeatX: number;
  repeatY: number;
  /** three.js `texture.offset`. */
  offsetX: number;
  offsetY: number;
}

export interface CropOptions {
  /** From the element, not from any declared metadata. May be 0 pre-metadata. */
  videoWidth: number;
  videoHeight: number;
  /** Width / height of the face plane. */
  planeAspect: number;
  /** < 1 crops in toward the face. 1 uses the whole cover-fitted window. */
  zoom: number;
  /**
   * Shifts the window up the frame. Webcams sit below or above the face and
   * people leave headroom, so the face is reliably above the frame centre.
   */
  yBias: number;
  /** True for your own preview, false for everyone else's. */
  mirror: boolean;
  /**
   * A tracked face to frame on. When present it supersedes `zoom` and
   * `yBias` entirely: those two are a guess about where a face probably is,
   * and this is a measurement of where it actually is.
   */
  focus?: FaceBox | null;
}

/**
 * A webcam aspect ratio outside this range is not a camera, it is a bug: a
 * zero from an element whose metadata has not loaded, or a garbage dimension
 * from a driver. Falling back to an uncropped square is visibly wrong for a
 * frame or two, which is the correct failure: it never divides by zero and it
 * never derives a crop window from a number nothing has vouched for.
 */
const MIN_PLAUSIBLE_ASPECT = 0.2;
const MAX_PLAUSIBLE_ASPECT = 5;

/**
 * How much of the window's height the face itself fills.
 *
 * This is the whole look of the thing. Push it toward 1 and you get a passport
 * photo cropped at the hairline; drop it to 0.3 and the avatar is wearing a
 * picture of a room with someone in it. Just under two-thirds leaves the
 * forehead and a little chin inside the oval mask, which is what reads as a
 * head rather than a cutout.
 */
export const FOCUS_FACE_FILL = 0.62;

/**
 * Floor on window height, as a fraction of the frame. Someone sitting far back
 * from a wide-angle laptop camera produces a small box, and following it
 * literally would magnify a 40-pixel-tall face across the whole plane. Better
 * a slightly loose crop than a blurred one.
 */
const FOCUS_MIN_WINDOW_HEIGHT = 0.22;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function sourceAspectOf(
  videoWidth: number,
  videoHeight: number,
  planeAspect: number,
): number {
  const measured =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 0;
  return measured >= MIN_PLAUSIBLE_ASPECT && measured <= MAX_PLAUSIBLE_ASPECT
    ? measured
    : // No usable measurement: fit the plane exactly, i.e. do not crop.
      planeAspect;
}

/**
 * Mirroring walks the same window backwards: uv 0 lands on its right edge.
 * The window itself is untouched, so mirroring can never move the framing.
 */
function applyMirror(window: CropWindow, mirror: boolean): CropWindow {
  if (!mirror) return window;
  return {
    repeatX: -window.repeatX,
    repeatY: window.repeatY,
    offsetX: window.offsetX + window.repeatX,
    offsetY: window.offsetY,
  };
}

/** The fixed window: cover-fit the plane, zoom in, nudge upward. */
function staticWindow(
  sourceAspect: number,
  planeAspect: number,
  zoom: number,
  yBias: number,
): CropWindow {
  // Cover fit: use the whole of the tighter axis and crop the looser one.
  let repeatX: number;
  let repeatY: number;
  if (sourceAspect >= planeAspect) {
    repeatY = 1;
    repeatX = planeAspect / sourceAspect;
  } else {
    repeatX = 1;
    repeatY = sourceAspect / planeAspect;
  }

  const z = clamp(zoom, 0.1, 1);
  repeatX *= z;
  repeatY *= z;

  const offsetX = (1 - repeatX) / 2;
  // Positive yBias walks the window up the image. It can only walk as far as
  // the window's own slack, or the crop would sample outside the frame and
  // clamp to a smear of edge pixels.
  const slackY = 1 - repeatY;
  const offsetY = clamp(slackY / 2 + yBias, 0, slackY);

  return { repeatX, repeatY, offsetX, offsetY };
}

/** The tracked window: size it off the face, then centre it on the face. */
function focusWindow(
  sourceAspect: number,
  planeAspect: number,
  focus: FaceBox,
): CropWindow {
  let repeatY = clamp(focus.h / FOCUS_FACE_FILL, FOCUS_MIN_WINDOW_HEIGHT, 1);
  // Derived so the sampled region's aspect *in source pixels* is the plane's,
  // which is the one property that must survive every branch in this file.
  let repeatX = (repeatY * planeAspect) / sourceAspect;

  // A tall narrow source runs out of width first. Shrink both together, so the
  // window stays the plane's shape and simply covers less of the face.
  if (repeatX > 1) {
    repeatY /= repeatX;
    repeatX = 1;
  }

  const offsetX = clamp(focus.cx - repeatX / 2, 0, 1 - repeatX);
  // The one place the flip happens: `focus.cy` is measured downward from the
  // top of the image, and v runs upward from the bottom.
  const offsetY = clamp(1 - focus.cy - repeatY / 2, 0, 1 - repeatY);

  return { repeatX, repeatY, offsetX, offsetY };
}

export function faceCrop(opts: CropOptions): CropWindow {
  const { videoWidth, videoHeight, planeAspect, zoom, yBias, mirror, focus } =
    opts;

  const sourceAspect = sourceAspectOf(videoWidth, videoHeight, planeAspect);

  const window = focus
    ? focusWindow(sourceAspect, planeAspect, focus)
    : staticWindow(sourceAspect, planeAspect, zoom, yBias);

  return applyMirror(window, mirror);
}
