import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BACK_SLOT, cardGeometry, cardMaterial } from "./cardAtlas.js";
import type { CardSpot } from "./cards.js";
import { arc, easeOutCubic, jitterSigned, progress } from "./tween.js";
import { damp, dampAngle } from "./damp.js";

/**
 * One card on the table.
 *
 * Owns its own motion in a `useFrame`, writing to a ref, and never sets React
 * state per frame - the project rule for scene code. React decides *what* a
 * card is (where it belongs, whether its face is known, whether it is being
 * peeked at); this decides how it gets there.
 *
 * Two kinds of motion, and the difference is the point:
 *
 * - **Arrival** is a tween with a start, an end and a duration, so a deal is
 *   the same flight on every client. See the note in `tween.ts`.
 * - **Everything after** is damping toward wherever the card now belongs,
 *   because those targets move for reasons that are not synchronised - a table
 *   re-flowing as someone joins, a hand being mucked, a peek being held. A
 *   tween would need an end time nobody can agree on.
 *
 * The face is a property of the *geometry*, not a flag: a face-down card is
 * built from `BACK_SLOT` and there is no rank or suit anywhere in the object
 * for anything to leak. See the note at the top of `cards.ts`.
 */

/** How long a card takes to cross the table. Brisk: a deal is a flick. */
const FLIGHT_MS = 360;
/** How high it rises on the way. */
const FLIGHT_LIFT = 0.075;

/** Settling toward a target that is not an arrival. */
const MOVE_LAMBDA = 7;
const TURN_LAMBDA = 9;
/** The peek is a gesture under your hand, so it is the snappiest thing here. */
const PEEK_LAMBDA = 14;

/** Face down and face up, as a rotation about the card's own long axis. */
const FACE_DOWN_PITCH = Math.PI / 2;
const FACE_UP_PITCH = -Math.PI / 2;

/** How far the near edge comes up on a peek, and how far the card slides back. */
const PEEK_PITCH = -0.72;
const PEEK_RISE = 0.045;
const PEEK_DRAW = 0.045;

/**
 * How a peeked pair opens in the hand.
 *
 * At rest the two cards overlap, which is what a hand lying on felt looks
 * like. Lifted, they must not: two cards tilted to the same angle, a
 * centimetre apart and still overlapping, are two nearly-coplanar quads with
 * the near one hiding a fifth of the far one - and the pip they hide is
 * usually the one you picked the cards up to read. Every real player does the
 * same thing here, which is to splay the pair open with a thumb, so the peek
 * spreads them apart and rolls each one out from the middle. It reads as a
 * hand being fanned and it puts clear air between the two surfaces.
 */
const PEEK_SPREAD = 0.024;
const PEEK_ROLL = 0.2;
const PEEK_STAGGER = 0.006;

export interface TableCardProps {
  /**
   * Atlas slot for the face, or `BACK_SLOT` for a card whose value this client
   * has not been sent. Not "a hidden value": there is no value.
   */
  faceSlot: number;
  /** Where the card belongs right now. */
  spot: CardSpot;
  /** Show the face rather than the back. */
  faceUp: boolean;
  /** On the table at all. A seat with no cards dealt renders nothing. */
  visible: boolean;
  /**
   * Where this card flies in from, and when. Changing `arriveKey` starts the
   * flight; a null `from` means it simply appears where it belongs, which is
   * what a reconnecting client wants - it missed the deal, and watching five
   * cards fly out of a deck that is not there would be worse than not.
   */
  from?: CardSpot | null;
  arriveKey?: string;
  delayMs?: number;
  /** 0..1. Lifts the near edge towards the player holding it. */
  peek?: number;
  /**
   * Which way this card fans when the pair is lifted: -1 for the left of the
   * pair, +1 for the right, 0 for anything that is not part of a hand.
   */
  peekFan?: number;
  /** Stable per-card, so no two lie perfectly square to the felt. */
  seed: number;
}

export function TableCard({
  faceSlot,
  spot,
  faceUp,
  visible,
  from = null,
  arriveKey,
  delayMs = 0,
  peek = 0,
  peekFan = 0,
  seed,
}: TableCardProps) {
  const mesh = useRef<THREE.Mesh>(null);

  // Live animation state. Refs because every one of these changes per frame.
  const pose = useRef({
    x: spot.x,
    y: spot.y,
    z: spot.z,
    yaw: spot.yaw,
    pitch: faceUp ? FACE_UP_PITCH : FACE_DOWN_PITCH,
    peek: 0,
  });
  const placed = useRef(false);
  const flight = useRef<{
    from: CardSpot;
    startAt: number | null;
    delay: number;
  } | null>(null);

  // A new arrival is armed here and consumed in the frame loop, so the flight
  // is timed off the render clock rather than off React's schedule.
  useEffect(() => {
    if (arriveKey === undefined || !from) return;
    flight.current = { from, startAt: null, delay: delayMs / 1000 };
    // `from` and `delayMs` are read at arm time on purpose: a card already in
    // the air must not be re-aimed because the table re-flowed under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arriveKey]);

  useFrame((state, delta) => {
    const node = mesh.current;
    if (!node) return;

    const p = pose.current;
    const restPitch = faceUp ? FACE_UP_PITCH : FACE_DOWN_PITCH;

    if (flight.current) {
      const leg = flight.current;
      if (leg.startAt === null) {
        leg.startAt = state.clock.elapsedTime + leg.delay;
        // Waiting its turn in the deck, not hovering where it was last hand.
        p.x = leg.from.x;
        p.y = leg.from.y;
        p.z = leg.from.z;
        p.yaw = leg.from.yaw;
        p.pitch = FACE_DOWN_PITCH;
      }

      const elapsed = (state.clock.elapsedTime - leg.startAt) * 1000;
      if (elapsed < 0) {
        // Still in the deck. Drawn there, which is what makes the deck read as
        // a deck rather than as cards materialising out of the felt.
        node.position.set(p.x, p.y, p.z);
        node.rotation.set(p.pitch, p.yaw, 0);
        node.visible = visible;
        return;
      }

      const t = easeOutCubic(progress(elapsed, FLIGHT_MS));
      const point = arc(leg.from, spot, FLIGHT_LIFT, t);
      p.x = point.x;
      p.y = point.y;
      p.z = point.z;
      // A flicked card spins a little on the way. Same seed everywhere, so
      // every client watches the same card turn the same way.
      p.yaw =
        leg.from.yaw + (spot.yaw - leg.from.yaw) * t + jitterSigned(seed, 1.4) * (1 - t);
      p.pitch = FACE_DOWN_PITCH;

      node.position.set(p.x, p.y, p.z);
      node.rotation.set(p.pitch, p.yaw, 0);
      node.visible = visible;
      if (t >= 1) {
        flight.current = null;
        placed.current = true;
      }
      return;
    }

    // First frame with no flight: be where you belong rather than sliding in
    // from the origin.
    if (!placed.current) {
      p.x = spot.x;
      p.y = spot.y;
      p.z = spot.z;
      p.yaw = spot.yaw;
      p.pitch = restPitch;
      placed.current = true;
    }

    p.peek = damp(p.peek, peek, PEEK_LAMBDA, delta);

    // The peek pulls the card back towards the player and stands its near edge
    // up: the whole gesture is that the face turns towards exactly one pair of
    // eyes and nobody else's. It also fans the pair open, so the card in front
    // stops covering the corner of the card behind it.
    const drawBack = p.peek * PEEK_DRAW;
    const spread = p.peek * peekFan * PEEK_SPREAD;
    const outX = Math.sin(spot.yaw);
    const outZ = Math.cos(spot.yaw);
    // The seat's right, which is the axis the pair is already laid out along.
    const rightX = Math.cos(spot.yaw);
    const rightZ = -Math.sin(spot.yaw);

    p.x = damp(p.x, spot.x + outX * drawBack + rightX * spread, MOVE_LAMBDA, delta);
    p.z = damp(p.z, spot.z + outZ * drawBack + rightZ * spread, MOVE_LAMBDA, delta);
    p.y = damp(
      p.y,
      // Stepped as well as spread: the far card of a fan sits a little higher
      // than the near one, which is what stops the two faces sharing a plane
      // at the top of the lift.
      spot.y + p.peek * (PEEK_RISE + peekFan * PEEK_STAGGER),
      MOVE_LAMBDA,
      delta,
    );
    p.yaw = dampAngle(p.yaw, spot.yaw, TURN_LAMBDA, delta);

    // Peeking overrides the resting face: the card is turned in the hand, so
    // there is nothing to blend between.
    const target =
      p.peek > 0.001
        ? restPitch + (PEEK_PITCH - restPitch) * p.peek
        : restPitch;
    p.pitch = dampAngle(p.pitch, target, TURN_LAMBDA, delta);

    node.position.set(p.x, p.y, p.z);
    // Roll is the last of the fan: each card of a lifted pair leans out from
    // the middle, the way a hand splayed with a thumb does.
    node.rotation.set(p.pitch, p.yaw, p.peek * peekFan * PEEK_ROLL);
    node.visible = visible;
  });

  return (
    <mesh
      ref={mesh}
      // The face is chosen here, in the geometry, and `faceSlot` is whatever
      // the server told this client - which for every other seat is nothing
      // at all, and resolves to the back.
      geometry={cardGeometry(faceSlot)}
      material={cardMaterial()}
      rotation-order="YXZ"
      // Neither cast nor received, and the cast is the one that matters. A
      // card is 1.6mm thick and lies flush on felt that already has the
      // table's own contact shadow on it, so its shadow is invisible - but
      // seventeen of them are seventeen extra objects in the shadow pass,
      // which doubles what phase 4 costs in draw calls for nothing anybody
      // can see. Receiving one would only ever darken a face people are being
      // asked to read.
      castShadow={false}
      receiveShadow={false}
    />
  );
}

export { BACK_SLOT };
