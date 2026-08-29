import { useEffect, useState } from "react";
import * as THREE from "three";
import { faceCrop } from "../scene/faceCrop.js";

/**
 * `HTMLVideoElement` -> cropped, colour-correct `VideoTexture`.
 *
 * This is the one place a webcam becomes a face on an avatar, and it is the
 * one place in the scene that owns GPU memory with a lifetime shorter than
 * the tab's. A texture leaked per join/leave cycle is invisible for the first
 * few minutes and then is the whole problem, so the disposal below is the
 * point of the hook, not an afterthought.
 *
 * The element itself belongs to the media provider: this hook never creates,
 * moves or removes it. Detaching it here would break LiveKit's visibility-
 * driven quality negotiation, which watches that element.
 */

export interface FaceTextureOptions {
  /** Width / height of the face plane the texture lands on. */
  planeAspect: number;
  /** Your own face should mirror; nobody else's should. */
  mirror: boolean;
  /** < 1 tightens the framing onto the face. */
  zoom: number;
  /** Shifts the crop up the frame, where the face actually sits. */
  yBias: number;
}

export function useFaceTexture(
  el: HTMLVideoElement | null,
  { planeAspect, mirror, zoom, yBias }: FaceTextureOptions,
): THREE.VideoTexture | null {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);

  useEffect(() => {
    if (!el) {
      setTexture(null);
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
    next.wrapS = THREE.ClampToEdgeWrapping;
    next.wrapT = THREE.ClampToEdgeWrapping;

    // The framing depends on the real frame size, which the element does not
    // know until metadata arrives and can change if the sender switches
    // simulcast layer or camera.
    const applyCrop = () => {
      const crop = faceCrop({
        videoWidth: el.videoWidth,
        videoHeight: el.videoHeight,
        planeAspect,
        zoom,
        yBias,
        mirror,
      });
      next.repeat.set(crop.repeatX, crop.repeatY);
      next.offset.set(crop.offsetX, crop.offsetY);
    };

    applyCrop();
    el.addEventListener("loadedmetadata", applyCrop);
    el.addEventListener("resize", applyCrop);
    setTexture(next);

    return () => {
      el.removeEventListener("loadedmetadata", applyCrop);
      el.removeEventListener("resize", applyCrop);
      next.dispose();
      setTexture(null);
    };
  }, [el, planeAspect, mirror, zoom, yBias]);

  return texture;
}
