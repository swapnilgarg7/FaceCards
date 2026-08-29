import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Seat } from "../scene/layout.js";
import { dampAngle } from "../scene/damp.js";
import type { FaceBox } from "../scene/faceBox.js";
import type { FaceBoxStore } from "../scene/faceBoxStore.js";
import {
  FACE_INSET,
  FACE_PLANE_ASPECT,
  FACE_PLANE_HEIGHT,
  FACE_PLANE_WIDTH,
  HEAD_RADIUS,
  NECK_RADIUS_BOTTOM,
  NECK_RADIUS_TOP,
  TORSO_BREATH_RISE,
  TORSO_BREATH_SCALE,
  TORSO_DEPTH,
  TORSO_LENGTH,
  TORSO_RADIUS,
  bodyGeometry,
} from "../scene/body.js";
import { HALO_SCALE } from "../scene/decor.js";
import { faceCrop } from "../scene/faceCrop.js";
import { avatarLook } from "./archetypes.js";
import { AT_REST, idlePose } from "./idle.js";
import { HeadPieceMesh } from "./HeadPiece.js";
import { OutfitMesh } from "./Outfit.js";
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
 * Deliberately procedural, and phase 5 kept it that way rather than swapping in
 * the Quaternius modular bodies. The reason is the socket: everything about
 * these bodies is derived from `EYE_HEIGHT` through `body.ts`, which is what
 * makes a face plane land on a neck instead of floating over one. A downloaded
 * rig arrives with its own proportions and its own idea of where a head is, so
 * adopting one means re-deriving that relationship against a mesh nobody can
 * edit - to gain skinned shoulders on a body that is visible from the chest up
 * and mostly in shadow.
 *
 * What phase 5 added instead is the two things the plan actually wanted out of
 * that swap. **Personality**: every archetype now sits differently, from
 * `idle.ts`, bounded so a sway can never take a face out of frame.
 * **Silhouette**: every archetype now wears something that changes its
 * outline, from `Outfit.tsx`. Six people should be tellable apart with the
 * sound off and three cameras dark.
 *
 * The contract that has to survive any future swap is unchanged: a plane of
 * `FACE_PLANE_*` dimensions, centred at the seat's eye height, facing the
 * seat's forward. The socket does not know or care which body it is on, which
 * is the entire point of routing it through one lookup.
 */

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

/**
 * A few degrees down, so a face reads as looking at the table rather than
 * staring at the far wall. Measured in the flipped, forward-facing frame.
 */
const FACE_PITCH = -0.07;

const NAME_PLATE_Y = 0.86;
const NAME_PLATE_HEIGHT = 0.075;
/** Clear of the longest name, so the badge never lands on the text. */
const MUTE_GLYPH_SIZE = 0.075;
const MUTE_GLYPH_GAP = 0.028;

/**
 * How fast a player slides to a new seat when the table re-flows. Slow enough
 * to read as everyone shuffling round to make room, fast enough not to be a
 * thing you sit and wait for.
 */
const RESEAT_LAMBDA = 3.4;

/**
 * What every material drops to while a player is mid-reconnect. One flat,
 * unsaturated grey reads across the table as "nobody home" without needing a
 * badge nobody would be looking at.
 */
const AWAY_COLOUR = "#3a3f48";

/**
 * Where a seated body bends: hip height, not the floor.
 *
 * The seat's origin is on the carpet, so rolling the body about it would swing
 * the head through an arc a metre and a bit long - six centimetres sideways
 * for the two degrees `idle.ts` allows. Pivoting here puts the head about
 * two thirds of a metre out instead, which is what a person shifting their
 * weight in a chair actually looks like.
 */
const PIVOT_Y = 0.5;

export interface AvatarProps {
  seat: Seat;
  displayName: string;
  /** Archetype id from server state. Validated there, resolved here. */
  avatar: string;
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
  /**
   * Dropped, and inside their reconnection window. The seat is still theirs
   * and their chips are still in the pot, so the body stays; what changes is
   * that it reads as unoccupied rather than as someone sitting very still.
   */
  away: boolean;
}

export function Avatar({
  seat,
  displayName,
  avatar,
  peerId,
  videoEl,
  faceBoxes,
  mirror,
  speaking,
  micMuted,
  cameraOff,
  away,
}: AvatarProps) {
  const faceTexture = useFaceTexture(videoEl);

  const look = useMemo(() => avatarLook(avatar), [avatar]);
  // Drained rather than hidden. An empty chair at a real table is still a
  // chair, and removing the body would make the seat look free when it is
  // being held.
  const colour = away ? AWAY_COLOUR : look.body;
  const headColour = away ? AWAY_COLOUR : look.headColour;
  const faceMask = faceMaskTexture();
  const ringMask = speakingRingTexture();
  const plate = useMemo(() => namePlateTexture(displayName), [displayName]);

  // The whole body hangs off this seat's eye-line, so nothing can drift out
  // of proportion with the face plane it has to sit under. Memoised on the one
  // input it has, like the archetype lookup beside it: this component
  // re-renders whenever anyone starts or stops talking, and none of that
  // changes how tall a person is.
  const body = useMemo(() => bodyGeometry(seat.eyeY), [seat.eyeY]);

  const rootRef = useRef<THREE.Group>(null);
  /** Everything above the seat: swayed and leaned as one, so a body bends. */
  const poseRef = useRef<THREE.Group>(null);
  /** The head and the face plane it carries. Glances on top of the sway. */
  const headRef = useRef<THREE.Group>(null);
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

    // The idle. Pure function of time and archetype, so six clients draw the
    // same six people without a byte on the wire - and bounded in `idle.ts`,
    // where the amplitudes are asserted, because the failure mode here is a
    // body that takes a face with it.
    //
    // A dropped player stops dead rather than easing to a halt: the seat is
    // still theirs, but a body that is still breathing says somebody is in it.
    const pose = away ? AT_REST : idlePose(state.clock.elapsedTime, look.idle, phase);

    const posed = poseRef.current;
    if (posed) {
      posed.rotation.z = pose.roll;
      posed.rotation.x = pose.pitch;
      posed.position.y = pose.rise;
    }
    const head = headRef.current;
    if (head) {
      head.rotation.y = pose.headYaw;
      head.rotation.x = pose.headPitch;
    }

    // Breathing. Mutating the ref rather than setting state, because state
    // per frame would re-render every avatar sixty times a second.
    const torso = torsoRef.current;
    if (torso) {
      // Only y is touched: the x and z scale set in JSX are what make the
      // chest a chest rather than a column, and must survive every frame.
      torso.scale.y = 1 + Math.sin(t * 0.9) * TORSO_BREATH_SCALE;
      torso.position.y = body.torsoY + Math.sin(t * 0.9) * TORSO_BREATH_RISE;
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
        speaking && !away ? 0.85 : 0,
        6,
        delta,
      );
    }
  });

  // A dropped player's track is gone from the SFU too, so the texture would
  // already be null; saying so explicitly means the placeholder does not
  // depend on the media layer having noticed first.
  const showVideo = faceTexture !== null && !cameraOff && !away;

  return (
    <group ref={rootRef}>
      {/*
        Three nested groups so that a sway pivots at the hips rather than at
        the floor. `poseRef` carries the roll, the lean and the breath rise;
        the pair around it move the pivot up to `PIVOT_Y` and back down, which
        is what lets every child below keep the absolute heights `body.ts`
        derived. Rolling about the seat origin instead would swing a head
        through six centimetres for a two-degree shift of weight.
      */}
      <group position={[0, PIVOT_Y, 0]}>
        <group ref={poseRef}>
          <group position={[0, -PIVOT_Y, 0]}>
            <mesh
              ref={torsoRef}
              position={[0, body.torsoY, 0]}
              scale={[1, 1, TORSO_DEPTH]}
              castShadow
            >
              <capsuleGeometry args={[TORSO_RADIUS, TORSO_LENGTH, 4, 12]} />
              <meshStandardMaterial color={colour} roughness={0.72} />
            </mesh>

            {/*
              The neck. Without one the head is a ball resting on a shoulder,
              and the gap the face plane needs in order to show a chin reads as
              a floating head instead of a person.
            */}
            <mesh position={[0, body.neckY, 0]} castShadow>
              <cylinderGeometry
                args={[NECK_RADIUS_TOP, NECK_RADIUS_BOTTOM, body.neckHeight, 12]}
              />
              <meshStandardMaterial color={headColour} roughness={0.85} />
            </mesh>

            {/*
              The head, on its own pivot at the eye-line, by the same
              move-and-move-back. A glance turns the skull, the hat and the
              face plane together, because from the neck up they are one thing.
            */}
            <group position={[0, seat.eyeY, 0]}>
              <group ref={headRef}>
                <group position={[0, -seat.eyeY, 0]}>
                  <mesh
                    position={[0, seat.eyeY, 0]}
                    scale={look.headScale}
                    castShadow
                  >
                    <sphereGeometry args={[HEAD_RADIUS, 18, 14]} />
                    <meshStandardMaterial color={headColour} roughness={0.85} />
                  </mesh>

                  {/* Hat, antennae or fin. Above the skull or behind it, never
                      across the face plane - see the socket contract in
                      `archetypes.ts`. */}
                  <HeadPieceMesh
                    piece={look.headPiece}
                    headTopY={seat.eyeY + HEAD_RADIUS * look.headScale[1]}
                    colour={colour}
                    accent={away ? AWAY_COLOUR : look.accent}
                  />

                  {/*
                    A three.js object faces its local -Z, so everything inside
                    this group is authored facing the viewer and the group
                    turns it around. Rotating the whole group also carries its
                    UVs, so this introduces no mirroring of its own: all
                    mirroring lives in the crop.
                  */}
                  <group rotation-y={Math.PI}>
                    <mesh position={[0, seat.eyeY, FACE_INSET - 0.012]}>
                      <planeGeometry
                        args={[
                          FACE_PLANE_WIDTH * HALO_SCALE,
                          FACE_PLANE_HEIGHT * HALO_SCALE,
                        ]}
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
                      <planeGeometry
                        args={[FACE_PLANE_WIDTH, FACE_PLANE_HEIGHT]}
                      />
                      {showVideo ? (
                        // Basic, not standard: the frame already carries the
                        // light of the room the person is sitting in, and tone
                        // mapping a face is what makes skin look grey.
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
                  </group>
                </group>
              </group>
            </group>

            {/* Everything worn or written on the body. Outside the head pivot,
                because a name plate that turned with a glance would read as a
                badge swinging on a hook. */}
            <group rotation-y={Math.PI}>
              <OutfitMesh
                outfit={look.outfit}
                body={body}
                colour={colour}
                accent={away ? AWAY_COLOUR : look.accent}
              />

              {look.tie && (
                // Business dress. Inside the flipped group, so +Z is the
                // direction this player faces, which is where a tie hangs.
                <mesh
                  position={[0, body.shoulderY - 0.15, body.chestFrontZ * 0.94]}
                  castShadow
                >
                  <boxGeometry args={[0.038, 0.17, 0.02]} />
                  <meshStandardMaterial
                    color={away ? AWAY_COLOUR : look.accent}
                    roughness={0.6}
                  />
                </mesh>
              )}

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
                // Spec section 7: the mute state belongs on the avatar, near
                // the chest, not only in a HUD nobody is looking at. It rides
                // beside the name plate, which is what now marks chest height.
                <mesh
                  position={[
                    -(
                      (NAME_PLATE_HEIGHT * plate.aspect) / 2 +
                      MUTE_GLYPH_GAP +
                      MUTE_GLYPH_SIZE / 2
                    ),
                    NAME_PLATE_Y,
                    0.24,
                  ]}
                >
                  <planeGeometry args={[MUTE_GLYPH_SIZE, MUTE_GLYPH_SIZE]} />
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
        </group>
      </group>
    </group>
  );
}
