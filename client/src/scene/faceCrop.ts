/**
 * Webcam frame -> face plane UV window.
 *
 * A webcam is 16:9 and a face plane is a portrait oval. Stretching one onto
 * the other squashes every face, so the frame has to be *cropped*: pick a
 * window inside the source image and map the plane onto exactly that.
 *
 * Pure maths, no three.js, so the framing can be unit-tested rather than
 * eyeballed. The result is applied to `texture.repeat` and `texture.offset`.
 */

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

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function faceCrop(opts: CropOptions): CropWindow {
  const { videoWidth, videoHeight, planeAspect, zoom, yBias, mirror } = opts;

  const measured =
    videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 0;
  const sourceAspect =
    measured >= MIN_PLAUSIBLE_ASPECT && measured <= MAX_PLAUSIBLE_ASPECT
      ? measured
      : // No usable measurement: fit the plane exactly, i.e. do not crop.
        planeAspect;

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

  if (!mirror) return { repeatX, repeatY, offsetX, offsetY };

  // Mirroring walks the same window backwards: uv 0 lands on its right edge.
  return { repeatX: -repeatX, repeatY, offsetX: offsetX + repeatX, offsetY };
}
