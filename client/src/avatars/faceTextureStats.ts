/**
 * How often each face texture is actually being handed to the GPU.
 *
 * This exists because a frozen face and a live one are pixel-identical in a
 * screenshot of somebody sitting still, and the three things that freeze one -
 * the SFU pausing the track, the element pausing, and the browser never
 * telling three.js that a new frame arrived - are indistinguishable from the
 * outside without a number. `ui/FaceDebug.tsx` prints it beside the source
 * resolution and the face-box rate, so the next freeze is one glance rather
 * than an afternoon.
 *
 * Module-level rather than threaded through props: it is written from inside
 * `useFrame` by every avatar and read twice a second by a dev overlay, and a
 * store passed down the scene for that would cost more than the measurement.
 * Nothing renders from it.
 */

const RATE_WINDOW_MS = 1000;
/** Enough to measure a 60 Hz upload rate over a one-second window. */
const RATE_SAMPLES = 72;

const uploads = new Map<string, number[]>();

export function noteTextureUpload(id: string, at: number): void {
  let recent = uploads.get(id);
  if (!recent) {
    recent = [];
    uploads.set(id, recent);
  }
  recent.push(at);
  if (recent.length > RATE_SAMPLES) recent.shift();
}

/** Uploads in the last second. Zero means that face is a still photograph. */
export function textureUploadRate(
  id: string,
  at: number = performance.now(),
): number {
  const recent = uploads.get(id);
  if (!recent) return 0;
  return recent.filter((t) => at - t <= RATE_WINDOW_MS).length;
}

export function forgetTextureUploads(id: string): void {
  uploads.delete(id);
}
