import { useEffect, useState } from "react";
import * as THREE from "three";

/**
 * `HTMLVideoElement` -> colour-correct `VideoTexture`.
 *
 * This is the one place in the scene that owns GPU memory with a lifetime
 * shorter than the tab's. A texture leaked per join/leave cycle is invisible
 * for the first few minutes and then is the whole problem, so the disposal
 * below is the point of the hook, not an afterthought.
 *
 * Framing deliberately does not live here. The crop window follows a tracked
 * face and therefore changes every frame, and this hook runs on React's
 * schedule, not the renderer's. `Avatar` owns the window and writes it inside
 * `useFrame`; all this hook does is hand over a texture pointed at the right
 * element with the right colour space.
 *
 * The element itself belongs to the media provider: this hook never creates,
 * moves or removes it. Detaching it here would break LiveKit's visibility-
 * driven quality negotiation, which watches that element.
 */
export function useFaceTexture(
  el: HTMLVideoElement | null,
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
    // The crop window is clamped to stay inside the frame, so this never
    // repeats in practice. It is set anyway: without it, a rounding error at
    // the edge of the window wraps a sliver of the far side of someone's room
    // onto the opposite cheek.
    next.wrapS = THREE.ClampToEdgeWrapping;
    next.wrapT = THREE.ClampToEdgeWrapping;

    setTexture(next);

    return () => {
      next.dispose();
      setTexture(null);
    };
  }, [el]);

  return texture;
}
