import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { forgetTextureUploads, noteTextureUpload } from "./faceTextureStats.js";

/**
 * `HTMLVideoElement` -> colour-correct `VideoTexture`, and the clock that
 * keeps it moving.
 *
 * This is the one place in the scene that owns GPU memory with a lifetime
 * shorter than the tab's. A texture leaked per join/leave cycle is invisible
 * for the first few minutes and then is the whole problem, so the disposal
 * below is the point of the hook, not an afterthought.
 *
 * **The upload clock is the other point.** three.js marks a `VideoTexture`
 * dirty from `requestVideoFrameCallback` alone: where the browser has rVFC,
 * `VideoTexture.update()` deliberately does nothing. rVFC fires when a frame
 * is *presented for composition*, so it is a callback about drawing, not about
 * decoding - and every element here lives in a hidden sink and is never drawn.
 * The browser stops presenting frames to it, rVFC stops firing, and the
 * avatar's face freezes on whichever frame was up when that happened, which is
 * usually the first one. Everything around it keeps working, which is what
 * makes it so confusing to look at: the face box still arrives a dozen times a
 * second, so the crop window goes on sliding around a photograph.
 *
 * So the upload is driven from `refresh()` instead, once per rendered frame,
 * off the element's decoded-frame counter where the browser has one and off
 * its media clock where it does not. rVFC is left registered underneath:
 * where it works it is the cheapest possible signal, and marking a texture
 * dirty twice for one frame costs nothing.
 *
 * Framing deliberately does not live here. The crop window follows a tracked
 * face and therefore changes every frame, and this hook runs on React's
 * schedule, not the renderer's. `Avatar` owns the window and writes it inside
 * `useFrame`; all this hook does is hand over a texture pointed at the right
 * element with the right colour space, and keep it fed.
 *
 * The element itself belongs to the media provider: this hook never creates,
 * moves or removes it. Detaching it here would break LiveKit's visibility-
 * driven quality negotiation, which watches that element.
 */

/** `HTMLMediaElement.HAVE_CURRENT_DATA`: there is a frame to sample. */
const HAVE_CURRENT_DATA = 2;

/**
 * Ceiling on uploads per second when we are driving from the media clock
 * rather than from a frame counter.
 *
 * That clock advances whether or not a new frame arrived, so without a cap
 * this would re-upload identical pixels at the full render rate: six faces at
 * 960x540 is most of a gigabyte a second of texture traffic for no visible
 * difference. Thirty is above every camera rate we publish.
 */
const FALLBACK_UPLOAD_HZ = 30;
const FALLBACK_MIN_GAP_MS = 1000 / FALLBACK_UPLOAD_HZ;

/**
 * How long the media clock may sit still before we stop uploading at all. A
 * track the SFU has paused is a still image, and re-uploading it is pure heat.
 */
const CLOCK_IDLE_MS = 250;

/**
 * How far the media clock may run past the last movement of the decoded-frame
 * counter before we stop believing that counter.
 *
 * Some browsers tie it to compositing as well, which would leave us exactly
 * where three.js was. Half a second is several frames at any real camera rate,
 * so a counter that is genuinely working never trips this, and one that has
 * quietly stopped hands over to the clock instead of freezing the face.
 */
const COUNTER_STALL_MS = 600;

/** Events that decide whether an element still has anything to show. */
const ALIVE_EVENTS = ["loadeddata", "canplay", "playing"] as const;
const DEAD_EVENTS = ["emptied", "ended", "error"] as const;

interface UploadClock {
  /** Last decoded-frame count seen. Negative means "not read yet". */
  frames: number;
  /** When that counter last moved. */
  countedAt: number;
  /** False once the counter has proved useless on this element. */
  trustCounter: boolean;
  /** Last `currentTime` seen, and when it last changed. */
  time: number;
  movedAt: number;
  uploadedAt: number;
}

function newClock(): UploadClock {
  return {
    frames: -1,
    countedAt: 0,
    trustCounter: true,
    time: -1,
    movedAt: 0,
    uploadedAt: 0,
  };
}

/**
 * Frames the decoder has produced, or -1 where the browser will not say.
 *
 * This is the signal we actually want - it moves when, and only when, there
 * are new pixels - so it is worth the fallback to get at it.
 */
function decodedFrames(el: HTMLVideoElement): number {
  const quality = el.getVideoPlaybackQuality?.();
  if (quality) return quality.totalVideoFrames;
  const legacy = (el as { webkitDecodedFrameCount?: number })
    .webkitDecodedFrameCount;
  return typeof legacy === "number" ? legacy : -1;
}

export interface FaceTexture {
  texture: THREE.VideoTexture | null;
  /**
   * False once the element has been emptied or has ended, so a face plane
   * cannot go on showing the last frame of somebody who has left. Fail-open:
   * anything we have not been *told* is dead counts as live, because a face
   * that is a second stale is a far smaller bug than a face that never
   * appears at all.
   */
  live: boolean;
  /**
   * Mark the texture for upload if the element has produced anything new.
   * Call once per rendered frame, from inside `useFrame`.
   */
  refresh(): void;
}

export function useFaceTexture(
  el: HTMLVideoElement | null,
  /** Whose face this is. Only used to label the dev readout's counters. */
  id: string,
): FaceTexture {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const [dead, setDead] = useState(false);
  // The frame loop reads these. State would be a render behind, and would cost
  // a re-render of the whole avatar per video frame.
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const clockRef = useRef<UploadClock>(newClock());

  useEffect(() => {
    if (!el) {
      textureRef.current = null;
      setTexture(null);
      setDead(false);
      return;
    }

    const next = new THREE.VideoTexture(el);
    // Without this, skin tones wash out: the frame is sRGB and three would
    // otherwise treat it as linear.
    next.colorSpace = THREE.SRGBColorSpace;
    next.minFilter = THREE.LinearFilter;
    next.magFilter = THREE.LinearFilter;
    // A video frame changes every frame, so mipmaps would be rebuilt every
    // frame for a plane that is never minified far.
    next.generateMipmaps = false;
    // The crop window is clamped to stay inside the frame, so this never
    // repeats in practice. It is set anyway: without it, a rounding error at
    // the edge of the window wraps a sliver of the far side of someone's room
    // onto the opposite cheek.
    next.wrapS = THREE.ClampToEdgeWrapping;
    next.wrapT = THREE.ClampToEdgeWrapping;

    textureRef.current = next;
    clockRef.current = newClock();
    setTexture(next);
    setDead(false);

    const markAlive = () => setDead(false);
    const markDead = () => setDead(true);
    for (const event of ALIVE_EVENTS) el.addEventListener(event, markAlive);
    for (const event of DEAD_EVENTS) el.addEventListener(event, markDead);

    return () => {
      for (const event of ALIVE_EVENTS) {
        el.removeEventListener(event, markAlive);
      }
      for (const event of DEAD_EVENTS) el.removeEventListener(event, markDead);
      next.dispose();
      textureRef.current = null;
      forgetTextureUploads(id);
      setTexture(null);
      setDead(false);
    };
  }, [el, id]);

  const refresh = useCallback(() => {
    const current = textureRef.current;
    if (!current || !el) return;
    if (el.readyState < HAVE_CURRENT_DATA) return;

    const clock = clockRef.current;
    const now = performance.now();

    // The media clock: it says whether anything is playing at all, and it is
    // the fallback source of "something changed".
    const time = el.currentTime;
    if (time !== clock.time) {
      clock.time = time;
      clock.movedAt = now;
    }

    const upload = () => {
      clock.uploadedAt = now;
      current.needsUpdate = true;
      noteTextureUpload(id, now);
    };

    if (clock.trustCounter) {
      const frames = decodedFrames(el);
      if (frames < 0) {
        clock.trustCounter = false;
      } else if (frames !== clock.frames) {
        clock.frames = frames;
        clock.countedAt = now;
        upload();
        return;
      } else if (clock.movedAt - clock.countedAt > COUNTER_STALL_MS) {
        clock.trustCounter = false;
      } else {
        // The counter works and has not moved: same pixels, nothing to send.
        return;
      }
    }

    if (now - clock.movedAt > CLOCK_IDLE_MS) return;
    if (now - clock.uploadedAt < FALLBACK_MIN_GAP_MS) return;
    upload();
  }, [el, id]);

  return { texture, live: !dead, refresh };
}
