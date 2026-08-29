import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { lookOffset, qualityForAngle, type StreamQuality } from "./attention.js";
import type { Seat } from "./layout.js";

/**
 * Spends the video budget on the person you are actually looking at.
 *
 * `adaptiveStream` is already on and is the baseline the spec asks for, but it
 * decides from the *elements*, and ours are six identically sized panes in a
 * hidden sink. The thing that really varies is where the head is pointing, and
 * only the scene knows that. So the scene tells the media layer, through
 * `MediaProvider.setQuality`, which is vendor-neutral by design.
 *
 * Renders nothing. It reads the camera and writes to the media provider, both
 * inside `useFrame`, and never touches React state - a component that
 * re-rendered the room every time somebody turned their head would cost more
 * than the bandwidth it saves.
 */

/**
 * Seconds between decisions. Fast enough that turning to face someone
 * upgrades them before they finish a sentence, slow enough that the whole
 * thing costs a handful of angle computations a second rather than six per
 * frame. Layer changes are also renegotiations, so asking sixty times a
 * second would be worse than not asking at all.
 */
const CHECK_INTERVAL_S = 0.2;

export interface AttentionPeer {
  peerId: string;
  seat: Seat;
}

export function AttentionDirector({
  peers,
  setQuality,
}: {
  peers: AttentionPeer[];
  setQuality(peerId: string, quality: StreamQuality): void;
}) {
  const camera = useThree((s) => s.camera);

  /** What each peer is on now, so hysteresis has something to hold onto. */
  const levels = useRef(new Map<string, StreamQuality>());
  const nextCheckAt = useRef(0);
  // Allocated once. A Vector3 per frame per peer is exactly the kind of
  // garbage that shows up as a stutter every few seconds on a laptop.
  const forward = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now < nextCheckAt.current) return;
    nextCheckAt.current = now + CHECK_INTERVAL_S;

    camera.getWorldDirection(forward);
    const eye = { x: camera.position.x, z: camera.position.z };
    const facing = { x: forward.x, z: forward.z };

    const present = new Set<string>();
    for (const peer of peers) {
      present.add(peer.peerId);
      const angle = lookOffset(eye, facing, peer.seat);
      const current = levels.current.get(peer.peerId);
      const next = qualityForAngle(angle, current);
      // Only on a change. Re-asserting the same level every fifth of a second
      // is a request the SFU has to answer for no gain.
      if (next === current) continue;
      levels.current.set(peer.peerId, next);
      setQuality(peer.peerId, next);
    }

    // Forget people who left, so a peer who rejoins is decided fresh rather
    // than inheriting the level they had when they dropped.
    for (const peerId of levels.current.keys()) {
      if (!present.has(peerId)) levels.current.delete(peerId);
    }
  });

  return null;
}
