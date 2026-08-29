import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Seat } from "../scene/layout.js";
import { dampAngle } from "../scene/damp.js";
import type { FaceBox } from "../scene/faceBox.js";
import type { FaceBoxStore } from "../scene/faceBoxStore.js";
import { faceCrop } from "../scene/faceCrop.js";
import { DEFAULT_SMOOTHING, stepFraming } from "../scene/faceSmooth.js";
import { useFaceTexture } from "./useFaceTexture.js";
import {
  faceMaskTexture,
  muteGlyphTexture,
  namePlateTexture,
  speakingRingTexture,
} from "./textures.js";

/**
 * A seated player: torso-up stylised body with a live face on the head.
 *
 * Deliberately procedural. Phase 5 swaps the primitives for the Quaternius
 * modular bodies, and the only contract that has to survive that swap is the
 * face-plane socket: a plane of `FACE_PLANE_*` dimensions, centred at the
 * seat's eye height, facing the seat's forward. Everything else here is
 * placeholder geometry.
 */

/** Portrait, because faces are. The crop honours this exactly. */
export const FACE_PLANE_WIDTH = 0.26;
export const FACE_PLANE_HEIGHT = 0.34;
export const FACE_PLANE_ASPECT = FACE_PLANE_WIDTH / FACE_PLANE_HEIGHT;

/**
 * Fallback framing, for a peer whose face is not being tracked: their browser
 * could not run the detector, or they are on an older build.
 *
 * A guess about where a face probably is, tuned against a real one rather than
 * derived. Tighter than it used to be, because it now only ever runs when
 * nothing better is available, and a crop that clips an ear is a better
 * failure than one that frames a wall.
 */
export const FACE_ZOOM = 0.62;
export const FACE_Y_BIAS = 0.08;

const HEAD_RADIUS = 0.14;
/** How far the face plane floats off the head, so it never z-fights. */
const FACE_INSET = HEAD_RADIUS * 0.94;
/**
 * A few degrees down, so a face reads as looking at the table rather than
 * staring at the far wall. Measured in the flipped, forward-facing frame.
 */
const FACE_PITCH = -0.07;

const CHEST_Y = 0.98;
const NAME_PLATE_Y = 0.86;
const NAME_PLATE_HEIGHT = 0.075;

/**
 * How fast a player slides to a new seat when the table re-flows. Slow enough
 * to read as everyone shuffling round to make room, fast enough not to be a
 * thing you sit and wait for.
 */
const RESEAT_LAMBDA = 3.4;

/** Distinguishes seats before anyone's camera is up. Phase 5 owns the art. */
const SEAT_COLOURS = [
  "#4c6ef5",
  "#12b886",
  "#f08c00",
  "#e64980",
  "#7950f2",
  "#0ca678",
  "#fa5252",
  "#1098ad",
  "#c2255c",
  "#f59f00",
];

export interface AvatarProps {
  seat: Seat;
  displayName: string;
  /** Whose face this is. The key into `faceBoxes`. */
  peerId: string;
  /** Attached, playing element from the media provider, or null. */
  videoEl: HTMLVideoElement | null;
  /** Framing measured on the sender's machine. Read, never written, here. */
  faceBoxes: FaceBoxStore;
  mirror: boolean;
  speaking: boolean;
  micMuted: boolean;
  cameraOff: boolean;
}

export function Avatar({
  seat,
  displayName,
  peerId,
  videoEl,
  faceBoxes,
  mirror,
  speaking,
  micMuted,
  cameraOff,
}: AvatarProps) {
  const faceTexture = useFaceTexture(videoEl);

  const colour = SEAT_COLOURS[seat.index % SEAT_COLOURS.length]!;
  const faceMask = faceMaskTexture();
  const ringMask = speakingRingTexture();
  const plate = useMemo(() => namePlateTexture(displayName), [displayName]);

  const rootRef = useRef<THREE.Group>(null);
  const torsoRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.MeshBasicMaterial>(null);
  const seated = useRef(false);
  const phase = useMemo(() => seat.index * 1.7, [seat.index]);
  /** The framing on screen, as opposed to the one last measured. */
  const framing = useRef<FaceBox | null>(null);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime + phase;

    // Seat placement is driven here rather than through JSX props, so a
    // re-flow eases across the table instead of teleporting. The first frame
    // snaps, because arriving should not look like sliding in from the floor.
    const root = rootRef.current;
    if (root) {
      if (!seated.current) {
        root.position.set(seat.x, 0, seat.z);
        root.rotation.y = seat.yaw;
        seated.current = true;
      } else {
        root.position.x = THREE.MathUtils.damp(
          root.position.x,
          seat.x,
          RESEAT_LAMBDA,
          delta,
        );
        root.position.z = THREE.MathUtils.damp(
          root.position.z,
          seat.z,
          RESEAT_LAMBDA,
          delta,
        );
        root.rotation.y = dampAngle(
          root.rotation.y,
          seat.yaw,
          RESEAT_LAMBDA,
          delta,
        );
      }
    }

    // Breathing. Mutating the ref rather than setting state, because state
    // per frame would re-render every avatar sixty times a second.
    const torso = torsoRef.current;
    if (torso) {
      torso.scale.y = 1 + Math.sin(t * 0.9) * 0.012;
      torso.position.y = 0.8 + Math.sin(t * 0.9) * 0.004;
    }

    // Framing runs here rather than in an effect because it is animation: the
    // tracker delivers a dozen measurements a second and this is what turns
    // them into sixty frames of movement. Writing to the texture's own
    // vectors, not to state, for the same reason the breathing above does.
    if (faceTexture && videoEl) {
      const measured = faceBoxes.get(peerId);
      if (measured) {
        // First box snaps. Easing in from a default would show every face
        // sliding into position a second after they sat down.
        framing.current = framing.current
          ? stepFraming(framing.current, measured, DEFAULT_SMOOTHING, delta)
          : measured;
      } else {
        framing.current = null;
      }

      const crop = faceCrop({
        // Read off the element every frame rather than cached on a metadata
        // event: a sender switching camera or simulcast layer changes these
        // underneath us, and this costs two property reads.
        videoWidth: videoEl.videoWidth,
        videoHeight: videoEl.videoHeight,
        planeAspect: FACE_PLANE_ASPECT,
        zoom: FACE_ZOOM,
        yBias: FACE_Y_BIAS,
        mirror,
        focus: framing.current,
      });
      faceTexture.repeat.set(crop.repeatX, crop.repeatY);
      faceTexture.offset.set(crop.offsetX, crop.offsetY);
    }

    const ring = ringRef.current;
    if (ring) {
      // Damped rather than switched, so a halo fades in with the voice
      // instead of strobing on every syllable boundary.
      ring.opacity = THREE.MathUtils.damp(
        ring.opacity,
        speaking ? 0.85 : 0,
        6,
        delta,
      );
    }
  });

  const showVideo = faceTexture !== null && !cameraOff;

  return (
    <group ref={rootRef}>
      <mesh ref={torsoRef} position={[0, 0.8, 0]} castShadow>
        <capsuleGeometry args={[0.21, 0.36, 4, 12]} />
        <meshStandardMaterial color={colour} roughness={0.72} />
      </mesh>

      <mesh position={[0, seat.eyeY, 0]} scale={[0.94, 1.06, 0.9]} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 18, 14]} />
        <meshStandardMaterial color="#2b3038" roughness={0.85} />
      </mesh>

      {/*
        A three.js object faces its local -Z, so everything inside this group
        is authored facing the viewer and the group turns it around. Rotating
        the whole group also carries its UVs, so this introduces no mirroring
        of its own: all mirroring lives in the crop.
      */}
      <group rotation-y={Math.PI}>
        <mesh position={[0, seat.eyeY, FACE_INSET - 0.012]}>
          <planeGeometry
            args={[FACE_PLANE_WIDTH * 1.28, FACE_PLANE_HEIGHT * 1.24]}
          />
          <meshBasicMaterial
            ref={ringRef}
            color="#ffd479"
            alphaMap={ringMask}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        <mesh
          position={[0, seat.eyeY, FACE_INSET]}
          rotation-x={FACE_PITCH}
          renderOrder={1}
        >
          <planeGeometry args={[FACE_PLANE_WIDTH, FACE_PLANE_HEIGHT]} />
          {showVideo ? (
            // Basic, not standard: the frame already carries the light of the
            // room the person is sitting in, and tone mapping a face is what
            // makes skin look grey.
            <meshBasicMaterial
              map={faceTexture}
              alphaMap={faceMask}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          ) : (
            <meshStandardMaterial
              color={colour}
              emissive={colour}
              emissiveIntensity={0.12}
              alphaMap={faceMask}
              transparent
              depthWrite={false}
              roughness={0.9}
            />
          )}
        </mesh>

        <mesh position={[0, NAME_PLATE_Y, 0.24]}>
          <planeGeometry
            args={[NAME_PLATE_HEIGHT * plate.aspect, NAME_PLATE_HEIGHT]}
          />
          <meshBasicMaterial
            map={plate.texture}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {micMuted && (
          // Spec section 7: the mute state belongs on the avatar, near the
          // chest, not only in a HUD nobody is looking at.
          <mesh position={[0.13, CHEST_Y, 0.2]}>
            <planeGeometry args={[0.075, 0.075]} />
            <meshBasicMaterial
              map={muteGlyphTexture()}
              transparent
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        )}
      </group>
    </group>
  );
}
