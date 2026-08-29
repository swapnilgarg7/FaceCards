import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SeatStatus } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { damp, dampAngle } from "./damp.js";
import { TABLE, type Seat } from "./layout.js";
import { dealerButtonTexture, stackPlaque, type PlaqueTone } from "./plaques.js";
import { RAIL_CROWN_R, RAIL_INNER, railSurfaceAt } from "./tableProfile.js";

/**
 * What each seat is worth, engraved on the rail in front of it, plus the
 * dealer button lying on the felt.
 *
 * The plaques sit on the *inner slope of the rail*, which is the one surface
 * at this table that faces every other seat. From where you are sitting, the
 * plaque belonging to the person opposite is directly below their face, so
 * their stack and their expression are read in one glance instead of two - and
 * the number is on the table where a real one would be, rather than in a list
 * in the corner of the screen.
 *
 * Nothing here owns a number. Every value comes straight off the snapshot, and
 * the plaque is a picture of it, exactly as the chips are.
 */

/** Where on the rail's inner slope the plate is let in, and how big it is. */
const PLAQUE_RADIUS = (RAIL_INNER + RAIL_CROWN_R) / 2;
const PLAQUE_HEIGHT = 0.052;

/**
 * The height and angle of the leather right there, read off the real profile
 * rather than typed in, so a plate stays flush if the rail is ever reshaped.
 */
const RAIL_AT_PLAQUE = railSurfaceAt(PLAQUE_RADIUS);
const RAIL_SLOPE = RAIL_AT_PLAQUE.slope;

/**
 * How far the plate stands proud of the leather.
 *
 * Not styling: the plate is flat and the rail is round, so a plate 0.17m wide
 * on a 0.98m radius dips about 4mm at its corners. Lifting it clear is what
 * stops the ends of every plaque disappearing into the upholstery.
 */
const PLAQUE_LIFT = 0.006;
const PLAQUE_Y = TABLE.topY + RAIL_AT_PLAQUE.y + PLAQUE_LIFT;

/** Dealer button: on the felt, out past the stack and clear of the deck. */
const BUTTON_FORWARD = 0.84;
const BUTTON_SIDE = 0.26;
const BUTTON_RADIUS = 0.026;
const BUTTON_THICKNESS = 0.008;
/**
 * How fast the button slides to the next seat. Slow: it is the one thing on
 * the felt that shows the button moving, and a button that teleports between
 * hands is a button nobody ever sees move.
 */
const BUTTON_LAMBDA = 3.2;

/** Matches the avatars, so a plaque and its owner cross the table together. */
const RESEAT_LAMBDA = 3.4;

export interface SeatPlaquesProps {
  snapshot: RoomSnapshot;
  /** Server seat index -> where that seat sits in the ring right now. */
  placed: Map<number, Seat>;
}

export function SeatPlaques({ snapshot, placed }: SeatPlaquesProps) {
  const seats = snapshot.players.flatMap((player) => {
    const seat = placed.get(player.seat);
    return seat ? [{ player, seat }] : [];
  });

  const buttonSeat = placed.get(snapshot.buttonSeat) ?? null;

  return (
    <group>
      {seats.map(({ player, seat }) => (
        <RailPlaque
          key={player.sessionId}
          seat={seat}
          player={player}
          acting={snapshot.actingSeat === player.seat}
        />
      ))}
      <DealerButton seat={buttonSeat} />
    </group>
  );
}

function RailPlaque({
  seat,
  player,
  acting,
}: {
  seat: Seat;
  player: SeatSnapshot;
  acting: boolean;
}) {
  const tone = plaqueTone(player, acting);
  const caption = plaqueCaption(player);
  const plaque = useMemo(
    () => stackPlaque(player.stack, caption, tone),
    [player.stack, caption, tone],
  );

  // The plaque follows its seat the way the avatar does: the ring re-flows as
  // people join and leave, and a number that teleported while its owner slid
  // would come off the rail it is set into.
  const root = useRef<THREE.Group>(null);
  const seated = useRef(false);

  useFrame((_, delta) => {
    const node = root.current;
    if (!node) return;
    if (!seated.current) {
      node.rotation.y = seat.yaw;
      seated.current = true;
    } else {
      // Rotation only: the plaque's whole position is a rotation about the
      // table's axis, so one damped angle carries it round the rail.
      node.rotation.y = dampAngle(node.rotation.y, seat.yaw, RESEAT_LAMBDA, delta);
    }
  });

  return (
    <group ref={root}>
      {/*
        `rotation-y = yaw` points the group's -Z at the middle, which puts its
        +Z on the seat's own bearing - so the plate sits at +Z, out on the
        rail, and is turned by pi to face back across the table. The X term
        then lays it over by the rail's own slope.

        Euler order is XYZ, so that yaw is applied before the tilt and the
        tilt happens about a horizontal axis square to the plate. Folding both
        into one rotation on the mesh would tilt about the wrong axis for
        every seat except the one at bearing zero.
      */}
      <mesh
        position={[0, PLAQUE_Y, PLAQUE_RADIUS]}
        rotation={[RAIL_SLOPE, Math.PI, 0]}
      >
        <planeGeometry args={[PLAQUE_HEIGHT * plaque.aspect, PLAQUE_HEIGHT]} />
        <meshBasicMaterial
          map={plaque.texture}
          transparent
          depthWrite={false}
          // The plate carries its own contrast: lighting it would make the
          // seat furthest from the pendant the seat whose number you cannot
          // read, which is exactly the inequality the round table exists to
          // avoid.
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function DealerButton({ seat }: { seat: Seat | null }) {
  const root = useRef<THREE.Group>(null);
  const placedOnce = useRef(false);

  useFrame((_, delta) => {
    const node = root.current;
    if (!node || !seat) return;

    const outX = Math.sin(seat.yaw);
    const outZ = Math.cos(seat.yaw);
    const rightX = Math.cos(seat.yaw);
    const rightZ = -Math.sin(seat.yaw);
    const x = outX * BUTTON_FORWARD + rightX * BUTTON_SIDE;
    const z = outZ * BUTTON_FORWARD + rightZ * BUTTON_SIDE;

    if (!placedOnce.current) {
      node.position.set(x, TABLE.topY + BUTTON_THICKNESS / 2, z);
      placedOnce.current = true;
      return;
    }
    node.position.x = damp(node.position.x, x, BUTTON_LAMBDA, delta);
    node.position.z = damp(node.position.z, z, BUTTON_LAMBDA, delta);
  });

  if (!seat) return null;

  return (
    <group ref={root}>
      <mesh castShadow>
        <cylinderGeometry
          args={[BUTTON_RADIUS, BUTTON_RADIUS, BUTTON_THICKNESS, 20]}
        />
        <meshStandardMaterial color="#e9e2d4" roughness={0.55} />
      </mesh>
      {/* The face, just proud of the disc so the D never z-fights the plastic. */}
      <mesh position={[0, BUTTON_THICKNESS / 2 + 0.0004, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[BUTTON_RADIUS, 20]} />
        <meshBasicMaterial map={dealerButtonTexture()} transparent />
      </mesh>
    </group>
  );
}

function plaqueTone(player: SeatSnapshot, acting: boolean): PlaqueTone {
  if (!player.connected) return "away";
  if (player.status === SeatStatus.Folded) return "folded";
  if (player.status === SeatStatus.AllIn) return "allin";
  return acting ? "acting" : "idle";
}

/**
 * The one word under the number.
 *
 * Ordered by what changes a decision. Whether someone is all in beats whether
 * they are folded beats whether they have gone; a live bet beats all three,
 * because that is the number the player on the clock is actually doing
 * arithmetic against.
 */
function plaqueCaption(player: SeatSnapshot): string {
  if (player.bet > 0) return `bet ${player.bet}`;
  if (player.status === SeatStatus.AllIn) return "all in";
  if (player.status === SeatStatus.Folded) return "folded";
  if (!player.connected) return "away";
  if (player.sittingOut) return "sitting out";
  if (player.stack === 0) return "out of chips";
  return "";
}
