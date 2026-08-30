import type { FaceBox } from "../scene/faceBox.js";
import { faceCrop } from "../scene/faceCrop.js";

/**
 * A single webcam frame, taken out of a live video element.
 *
 * **Stills only.** Nothing in this file records, buffers or accumulates
 * frames: it draws exactly one `drawImage` per person per moment, encodes it,
 * and hands back a blob URL that lives in this tab's memory until the reel
 * evicts it. There is no upload, no `MediaRecorder`, and nothing touches disk.
 *
 * The crop is the same crop the avatars use. `scene/faceCrop.ts` already owns
 * "where is this person's face in their own frame", it is already unit-tested,
 * and re-deriving it here would be a second opinion that drifts - so this
 * translates its UV window into a source rectangle and does no framing maths
 * of its own.
 *
 * Everything that can decide something is above `captureFace`; `captureFace`
 * itself is wiring and has no unit test, by the rule in ENGINEERING-STYLE.
 */

/** A source rectangle in video pixels, top-left origin. */
export interface CaptureRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** What comes back. `url` is an object URL and must be revoked by its owner. */
export interface Shot {
  url: string;
  /** Pixels. Square, so one number would do, but both keeps callers honest. */
  width: number;
  height: number;
}

/**
 * How big a captured face is stored.
 *
 * 256 is the largest a face renders anywhere in the moment UI on a 2x display
 * (a 128 CSS pixel hero portrait), so anything above it is memory spent on
 * detail that never reaches a screen. It also keeps a full 12-moment reel
 * under a couple of megabytes, which matters because it is all held live.
 */
export const SHOT_SIZE = 256;

/**
 * JPEG rather than PNG, and not far up the quality curve.
 *
 * These are webcam frames: already noisy, already compressed once by the SFU,
 * and about to be shown at thumbnail size behind a headline. PNG would be
 * roughly eight times the bytes for detail that is not in the source.
 */
const SHOT_TYPE = "image/jpeg";
const SHOT_QUALITY = 0.82;

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: there is a frame to sample. */
const HAVE_CURRENT_DATA = 2;

/**
 * The widest and narrowest a real camera can be.
 *
 * `videoWidth` is metadata: it comes from a track we did not create, through
 * an SDK, from a device driver, and it is about to size an allocation and a
 * `drawImage`. A zero here is routine - it is what an element reports before
 * its metadata has loaded - and a garbage number is not impossible. Neither
 * may reach a canvas, so both are refused here rather than clamped, because a
 * frame we cannot measure is a frame we should not be photographing.
 */
const MIN_ASPECT = 0.2;
const MAX_ASPECT = 5;
/** No camera has a side longer than this. A larger number is a broken driver. */
const MAX_DIMENSION = 8192;

/**
 * How much of the shot the face fills.
 *
 * Tighter than the avatar's crop. An avatar head is seen across a room at an
 * angle and needs a little air around it to read as a head; a Poker Moment is
 * a portrait, shown large, and the entire point of the feature is the
 * expression - so it crops in until the face is most of the frame.
 */
const MOMENT_ZOOM = 0.5;
/**
 * Where to look when nobody is tracking a face.
 *
 * A fallback with real work to do: face tracking is one model load away from
 * not being available at all, and a moment that framed somebody's ceiling
 * because MediaPipe failed to fetch would be worse than no moment. Webcams sit
 * below or above a face and people leave headroom, so the face is reliably
 * above the centre of the frame.
 */
const MOMENT_Y_BIAS = 0.08;

/**
 * The square of a frame that has a face in it.
 *
 * Pure, and the only maths in this file. `faceCrop` returns a UV window - v
 * running upward from the bottom, the way a texture is sampled - and a canvas
 * is indexed downward from the top, so the one thing this does is the flip.
 * Mirroring is deliberately not applied: a moment card is shown to the whole
 * table, and a mirrored portrait is only correct for the one person looking at
 * themselves.
 */
export function faceRect(
  videoWidth: number,
  videoHeight: number,
  focus: FaceBox | null,
): CaptureRect {
  const window = faceCrop({
    videoWidth,
    videoHeight,
    planeAspect: 1,
    zoom: MOMENT_ZOOM,
    yBias: MOMENT_Y_BIAS,
    mirror: false,
    focus,
  });
  const sw = window.repeatX * videoWidth;
  const sh = window.repeatY * videoHeight;
  // Clamped, and not for a rounding error's sake. `faceCrop` already keeps the
  // window inside the frame, but the flip is a subtraction of two floats that
  // were derived from each other, so an edge-of-frame face comes out at
  // -2e-14 rather than 0. Browsers tolerate a negative source offset; passing
  // one is still handing a canvas a rectangle that is not inside the image,
  // and the honest fix is here rather than a looser assertion in the test.
  return {
    sx: clamp(window.offsetX * videoWidth, 0, videoWidth - sw),
    sy: clamp((1 - window.offsetY - window.repeatY) * videoHeight, 0, videoHeight - sh),
    sw,
    sh,
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

/**
 * Is there a frame here worth photographing?
 *
 * Pure, so the "camera off" and "metadata not loaded yet" paths - which are
 * most of the paths, at the moment a hand ends - are testable without a DOM.
 */
export function capturable(source: {
  readyState: number;
  videoWidth: number;
  videoHeight: number;
}): boolean {
  const { readyState, videoWidth: w, videoHeight: h } = source;
  if (readyState < HAVE_CURRENT_DATA) return false;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w <= 0 || h <= 0) return false;
  if (w > MAX_DIMENSION || h > MAX_DIMENSION) return false;
  const aspect = w / h;
  return aspect >= MIN_ASPECT && aspect <= MAX_ASPECT;
}

/**
 * Take one frame off a live element.
 *
 * Resolves to null for every failure, and there are many honest ones: the
 * camera is off, the element has no frame yet, the tab lost its GPU context,
 * the canvas is tainted. **None of them may ever reach the caller as a
 * throw.** A hand of poker does not stop because a photograph did not work,
 * and the moment layer above this renders an avatar and a joke instead.
 */
export async function captureFace(
  el: HTMLVideoElement | null | undefined,
  focus: FaceBox | null,
): Promise<Shot | null> {
  if (!el || !capturable(el)) return null;

  try {
    const rect = faceRect(el.videoWidth, el.videoHeight, focus);
    if (rect.sw <= 0 || rect.sh <= 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = SHOT_SIZE;
    canvas.height = SHOT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      el,
      rect.sx,
      rect.sy,
      rect.sw,
      rect.sh,
      0,
      0,
      SHOT_SIZE,
      SHOT_SIZE,
    );

    // `toBlob`, not `toDataURL`. The synchronous one encodes on the main
    // thread, and six of them back to back at the end of a hand is a visible
    // stutter in a 3D scene that is still rendering behind the overlay. This
    // one hands the encode to the browser and comes back when it is done.
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, SHOT_TYPE, SHOT_QUALITY);
    });
    if (!blob) return null;

    return {
      url: URL.createObjectURL(blob),
      width: SHOT_SIZE,
      height: SHOT_SIZE,
    };
  } catch {
    // A tainted canvas, a lost context, a track that ended between the check
    // and the draw. All of them mean the same thing here: no photograph.
    return null;
  }
}

/** Give a shot's memory back. Safe to call twice, and on a null. */
export function releaseShot(shot: Shot | null | undefined): void {
  if (!shot) return;
  try {
    URL.revokeObjectURL(shot.url);
  } catch {
    // Already revoked, or a document being torn down. Nothing to do and
    // nothing worth saying about it.
  }
}
