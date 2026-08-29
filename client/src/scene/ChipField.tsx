import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { RoomSnapshot } from "../net/useRoom.js";
import {
  CHIP_COLOURS,
  CHIP_RADIUS,
  CHIP_THICKNESS,
  betAnchor,
  chipBreakdown,
  pileLayout,
  potAnchor,
  splitAcrossPiles,
  stackAnchor,
  type Denomination,
} from "./chips.js";
import { assignChips, type ChipInstance, type ChipSlot } from "./chipPool.js";
import { damp } from "./damp.js";
import type { Seat } from "./layout.js";

/**
 * Every chip in the room, in one `InstancedMesh`.
 *
 * That is a project rule (`CLAUDE.md`) and it is also the only way this works
 * at all: six stacks, six bets and a pot is a couple of hundred chips, and a
 * couple of hundred meshes would cost more draw calls than the rest of the
 * scene put together, for objects two centimetres across.
 *
 * The chips are a *picture of numbers the server owns*. Nothing here adds,
 * moves or awards a chip. It is handed a stack, a bet and a pot, and it draws
 * them; if the picture and the number ever disagree, the number is right.
 *
 * The motion falls out of that for free, and it is the nicest thing about the
 * arrangement: when a bet is collected, the same chips are simply wanted in
 * the middle instead of in front of a seat, and they glide there because
 * `chipPool.ts` kept their identity. Nobody wrote a "collect the bets"
 * animation. The pot sliding to the winner at a payout is the same mechanism
 * pointed the other way.
 */

/**
 * Ceiling on drawn chips. Six full stacks, six bets and a pot fit inside this
 * with room to spare; the cap exists so a table that somehow wanted more
 * draws fewer chips rather than resizing a GPU buffer mid-hand.
 */
const MAX_CHIPS = 256;

/** How fast a chip travels to where it now belongs. */
const SLIDE_LAMBDA = 6.4;
/** Appearing and disappearing, in seconds. */
const FADE_SECONDS = 0.16;

interface ChipRender extends ChipInstance {
  targetX: number;
  targetY: number;
  targetZ: number;
  spin: number;
  /** 0 while retired, 1 while on the table. Scales the chip in and out. */
  scale: number;
  wanted: boolean;
  live: boolean;
}

export interface ChipFieldProps {
  snapshot: RoomSnapshot;
  placed: Map<number, Seat>;
  /**
   * What the local player is about to push in, if they are mid-drag. Drawn in
   * front of their seat so the gesture has something to move. Nothing is
   * committed until they let go, and the server decides even then.
   */
  preview: { seat: number; chipsForward: number } | null;
}

export function ChipField({ snapshot, placed, preview }: ChipFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  // Fixed length and pre-filled, never sparse: the pool is addressed by index
  // by `assignChips`, and a hole in it would silently drop a chip.
  const chips = useRef<(ChipRender | undefined)[]>(
    Array.from({ length: MAX_CHIPS }, () => undefined),
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colour = useMemo(() => new THREE.Color(), []);

  // Every chip the table wants drawn right now, recomputed whenever server
  // state changes. Cheap: a couple of hundred objects, a few times a second at
  // most, and never inside the frame loop.
  const slots = useMemo(
    () => tableChips(snapshot, placed, preview),
    [snapshot, placed, preview],
  );

  useEffect(() => {
    const live: (ChipInstance | null)[] = [];
    for (let i = 0; i < MAX_CHIPS; i++) {
      const chip = chips.current[i];
      live.push(chip && chip.live ? chip : null);
    }
    const { assignments, retired } = assignChips(live, slots, MAX_CHIPS);

    for (const index of retired) {
      const chip = chips.current[index];
      if (chip) chip.wanted = false;
    }

    for (const { instance, slot } of assignments) {
      const existing = chips.current[instance];
      const fresh =
        !existing || !existing.live || existing.denomination !== slot.denomination;

      if (fresh) {
        // A chip that was not there, or was a different denomination, has no
        // motion to inherit: it appears where it belongs and scales in.
        chips.current[instance] = {
          denomination: slot.denomination,
          x: slot.x,
          y: slot.y,
          z: slot.z,
          targetX: slot.x,
          targetY: slot.y,
          targetZ: slot.z,
          spin: slot.spin,
          // Scales in from nothing. A chip that has no motion to inherit must
          // not be seen sliding in from wherever the last one happened to be.
          scale: 0,
          wanted: true,
          live: true,
        };
      } else {
        existing.targetX = slot.x;
        existing.targetY = slot.y;
        existing.targetZ = slot.z;
        existing.spin = slot.spin;
        existing.wanted = true;
      }
    }
  }, [slots]);

  useFrame((_, delta) => {
    const node = mesh.current;
    if (!node) return;

    const step = delta / FADE_SECONDS;

    for (let i = 0; i < MAX_CHIPS; i++) {
      const chip = chips.current[i];
      if (!chip || !chip.live) {
        // Parked below the felt at zero scale: an instance is always drawn,
        // so an unused one has to be drawn as nothing.
        dummy.position.set(0, -10, 0);
        dummy.scale.setScalar(0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        node.setMatrixAt(i, dummy.matrix);
        continue;
      }

      chip.scale = Math.min(
        1,
        Math.max(0, chip.scale + (chip.wanted ? step : -step)),
      );
      if (!chip.wanted && chip.scale <= 0) {
        chip.live = false;
      }

      chip.x = damp(chip.x, chip.targetX, SLIDE_LAMBDA, delta);
      chip.y = damp(chip.y, chip.targetY, SLIDE_LAMBDA, delta);
      chip.z = damp(chip.z, chip.targetZ, SLIDE_LAMBDA, delta);

      dummy.position.set(chip.x, chip.y, chip.z);
      dummy.rotation.set(0, chip.spin, 0);
      dummy.scale.setScalar(chip.scale);
      dummy.updateMatrix();
      node.setMatrixAt(i, dummy.matrix);
    }
    node.instanceMatrix.needsUpdate = true;
  });

  // Colour is per instance and changes only when a chip is (re)assigned, so
  // it is written on assignment rather than every frame.
  useEffect(() => {
    const node = mesh.current;
    if (!node) return;
    for (let i = 0; i < MAX_CHIPS; i++) {
      const chip = chips.current[i];
      const hex =
        chip && chip.live
          ? CHIP_COLOURS[chip.denomination as Denomination]
          : "#000000";
      node.setColorAt(i, colour.set(hex ?? "#000000"));
    }
    if (node.instanceColor) node.instanceColor.needsUpdate = true;
  }, [slots, colour]);

  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, MAX_CHIPS]}
      castShadow
      receiveShadow={false}
      // Chips are laid out from server state, which can put one anywhere on
      // the felt; a bounding sphere fitted to the first frame would cull the
      // pot the moment the camera turned away from where the chips started.
      frustumCulled={false}
    >
      <cylinderGeometry args={[CHIP_RADIUS, CHIP_RADIUS, CHIP_THICKNESS, 18]} />
      <meshStandardMaterial roughness={0.55} metalness={0.05} />
    </instancedMesh>
  );
}

/**
 * The whole table's chips, as a flat list of where each one goes.
 *
 * Exported for the frame loop's sake only: it is a pure function of the
 * snapshot, and it is the seam where "what the server says" becomes "what is
 * drawn". Every number in it comes from `snapshot`; none is computed here.
 */
function tableChips(
  snapshot: RoomSnapshot,
  placed: Map<number, Seat>,
  preview: { seat: number; chipsForward: number } | null,
): ChipSlot[] {
  const slots: ChipSlot[] = [];

  let committed = 0;
  for (const player of snapshot.players) committed += player.bet;
  // What has already been swept into the middle. `pot` counts every chip
  // committed this hand including the current round, so the middle is the
  // difference - which is exactly the pile a real dealer has in front of them.
  const middle = Math.max(0, snapshot.pot - committed);

  for (const player of snapshot.players) {
    const seat = placed.get(player.seat);
    if (!seat) continue;

    // A drag draws what the push *would* be: chips leave the stack and appear
    // in front of the seat, so letting go looks like nothing more than the
    // chips staying where the player put them.
    const previewing = preview?.seat === player.seat;
    const bet = previewing ? preview.chipsForward : player.bet;
    const stack = previewing
      ? Math.max(0, player.stack - (preview.chipsForward - player.bet))
      : player.stack;

    push(slots, `stack:${player.seat}`, stack, stackAnchor(seat), seat.yaw, player.seat * 101);
    push(slots, `bet:${player.seat}`, bet, betAnchor(seat), seat.yaw, player.seat * 101 + 53);
  }

  if (middle > 0) {
    const piles = splitAcrossPiles(chipBreakdown(middle, 24));
    piles.forEach((pile, index) => {
      const anchor = potAnchor(index);
      for (const chip of pileLayout(pile, anchor, anchor.yaw, 7000 + index * 37)) {
        slots.push({ pile: `pot:${index}`, ...chip });
      }
    });
  }

  return slots;
}

function push(
  slots: ChipSlot[],
  pile: string,
  amount: number,
  anchor: { x: number; y: number; z: number },
  yaw: number,
  seed: number,
): void {
  if (amount <= 0) return;
  for (const chip of pileLayout(chipBreakdown(amount), anchor, yaw, seed)) {
    slots.push({ pile, ...chip });
  }
}

/**
 * A grab pad over your own chips.
 *
 * Separate from the chips themselves for the reason the peek pad is separate
 * from the cards: the stack shrinks as you push chips out of it, and a hit
 * target that shrinks under the cursor is one you lose halfway through the
 * gesture.
 */
export function ChipGrabPad({
  seat,
  enabled,
  onGrab,
}: {
  seat: Seat;
  enabled: boolean;
  onGrab(event: { clientY: number }): void;
}) {
  const anchor = useMemo(() => stackAnchor(seat), [seat]);
  if (!enabled) return null;

  return (
    <mesh
      position={[anchor.x, anchor.y + 0.004, anchor.z]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onGrab({ clientY: event.clientY });
      }}
    >
      <planeGeometry args={[0.2, 0.16]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
