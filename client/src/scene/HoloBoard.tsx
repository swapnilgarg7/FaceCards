import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TablePhase } from "@facecards/shared";
import type { RoomSnapshot } from "../net/useRoom.js";
import { cardAtlasTexture, cardPlaneGeometry } from "./cardAtlas.js";
import { cardIndex } from "./cards.js";
import { damp } from "./damp.js";
import {
  HOLO_CAPTION_ASPECT,
  HOLO_CAPTION_HEIGHT,
  HOLO_CAPTION_Y,
  HOLO_GLOW,
  HOLO_ROW_Y,
  HOLO_SCALE,
  HOLO_TINT,
  HoloCaption,
  holoCardX,
  holoFacing,
  holoGlowGeometry,
} from "./holo.js";

/**
 * The board, projected upright over the middle of the table.
 *
 * See the note at the top of `holo.ts` for why this exists. The short version:
 * five cards lying flat on felt are the hardest thing in the room to read from
 * a seat, the old fix put them in a panel in the corner of the screen, and a
 * panel in the corner of the screen is where six people who came here to look
 * at each other go to stop looking at each other. This puts them back on the
 * table, standing up, facing everybody at once.
 *
 * Everything it draws is already public: the community cards, and the pot.
 * It never reads a hole card, and the only cards it can show are the ones in
 * `snapshot.board`, which the server sends to the whole room. A player's own
 * hand is not here and must never be - it would be a private card, three feet
 * tall, in the middle of a shared table.
 *
 * Motion lives in `useFrame` and writes to refs, never to state: the facing
 * follows the local camera every frame, and each card fades up as it lands.
 */

/** How fast a card materialises, and how fast the projection re-aims. */
const FADE_LAMBDA = 9;
/** Steady-state opacity. Enough to read, translucent enough to be a projection. */
const HOLO_OPACITY = 0.94;
/** A card that is no longer part of the winning five is knocked back. */
const HOLO_DIM = 0.34;
/** How far below its place a card starts before it rises into the row. */
const HOLO_RISE = 0.055;

export interface HoloBoardProps {
  snapshot: RoomSnapshot;
}

export function HoloBoard({ snapshot }: HoloBoardProps) {
  const group = useRef<THREE.Group>(null);

  const cards = snapshot.board;
  const showing = cards.length > 0;

  // Which cards are part of the hand that won, once there is one. The board
  // does not decide this: `reveal.best` is the server's own list of the five
  // cards it scored, and this only reads it.
  const best = useMemo(() => {
    if (snapshot.phase !== TablePhase.Payout) return null;
    const winner = snapshot.reveals.find((reveal) => reveal.won > 0);
    return winner ? new Set(winner.best) : null;
  }, [snapshot.phase, snapshot.reveals]);

  // Square on to whoever is looking, every frame. The camera is the local
  // player's eye, so from every seat the board is face on - which is the whole
  // point of a projection rather than five more objects on the felt.
  useFrame(({ camera }) => {
    const node = group.current;
    if (!node) return;
    node.rotation.y = holoFacing(camera.position.x, camera.position.z);
  });

  if (!showing) return null;

  return (
    <group ref={group} position={[0, 0, 0]}>
      {cards.map((card, i) => (
        <HoloCard
          key={`${snapshot.handNumber}:${i}`}
          card={card}
          x={holoCardX(i, cards.length)}
          // A card the winner did not use is still on the board and still
          // worth seeing; it is just no longer the story.
          dim={best !== null && !best.has(card)}
        />
      ))}
      <HoloBanner snapshot={snapshot} />
    </group>
  );
}

/**
 * One projected card.
 *
 * Two quads: the face, and an additive wash behind it that gives the
 * projection its glow. Both have their own material because each card fades
 * independently as it lands, and five materials for five cards is a rounding
 * error next to one avatar.
 */
function HoloCard({ card, x, dim }: { card: string; x: number; dim: boolean }) {
  const face = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  // Two separate quantities on purpose. `risen` is the card arriving and only
  // ever runs 0 to 1; `shown` is how strongly it is lit, which drops again
  // when the winning five are picked out. Driving the rise off the opacity
  // would sink every unused card back into the felt at the showdown.
  const risen = useRef(0);
  const shown = useRef(0);

  const slot = cardIndex(card);

  const materials = useMemo(() => {
    const faceMaterial = new THREE.MeshBasicMaterial({
      map: cardAtlasTexture(),
      color: HOLO_TINT,
      transparent: true,
      opacity: 0,
      // A projection is light in the air: it must not write depth, or two of
      // them overlapping would fight over which is in front, and it must not
      // be dimmed by the tone mapper that exists to roll off real surfaces.
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: HOLO_GLOW,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    return { faceMaterial, glowMaterial };
  }, []);

  // Two materials per card on a table that deals all evening is a leak if
  // nothing frees them.
  useEffect(() => {
    const { faceMaterial, glowMaterial } = materials;
    return () => {
      faceMaterial.dispose();
      glowMaterial.dispose();
    };
  }, [materials]);

  useFrame((_state, delta) => {
    risen.current = damp(risen.current, 1, FADE_LAMBDA, delta);
    shown.current = damp(
      shown.current,
      dim ? HOLO_DIM : HOLO_OPACITY,
      FADE_LAMBDA,
      delta,
    );

    materials.faceMaterial.opacity = shown.current * risen.current;
    materials.glowMaterial.opacity = shown.current * risen.current * 0.22;

    // It comes up out of the felt rather than switching on in mid-air, which
    // is what makes the run-out of an all-in read as cards arriving.
    const y = HOLO_ROW_Y - (1 - risen.current) * HOLO_RISE;
    face.current?.position.setY(y);
    glow.current?.position.setY(y);
  });

  if (slot < 0) return null;

  return (
    <group>
      <mesh
        ref={glow}
        position={[x, HOLO_ROW_Y, -0.004]}
        scale={[HOLO_SCALE * 1.16, HOLO_SCALE * 1.12, 1]}
        // Shared across every card in the row and kept for the life of the
        // tab, like the atlas geometries: the wash is the same quad whatever
        // card is behind it.
        geometry={holoGlowGeometry()}
        renderOrder={9}
      >
        <primitive object={materials.glowMaterial} attach="material" />
      </mesh>
      <mesh
        ref={face}
        position={[x, HOLO_ROW_Y, 0]}
        scale={[HOLO_SCALE, HOLO_SCALE, 1]}
        geometry={cardPlaneGeometry(slot)}
        renderOrder={10}
      >
        <primitive object={materials.faceMaterial} attach="material" />
      </mesh>
    </group>
  );
}

/**
 * The line over the board: the pot while the hand is live, and how it ended
 * once it has.
 *
 * The pot belongs here rather than in the corner of the screen for the same
 * reason the board does - it is the number everybody checks before deciding,
 * it belongs to nobody, and there is exactly one of it.
 */
function HoloBanner({ snapshot }: { snapshot: RoomSnapshot }) {
  const caption = useMemo(() => new HoloCaption(), []);

  useEffect(() => () => caption.dispose(), [caption]);

  const decided = snapshot.phase === TablePhase.Payout;
  const label = decided ? snapshot.lastResult || "Hand over" : "POT";
  const value = decided ? "" : String(snapshot.pot);

  useEffect(() => {
    caption.draw(label, value);
  }, [caption, label, value]);

  const width = HOLO_CAPTION_HEIGHT * HOLO_CAPTION_ASPECT;

  return (
    <mesh position={[0, HOLO_CAPTION_Y, 0]} renderOrder={11}>
      <planeGeometry args={[width, HOLO_CAPTION_HEIGHT]} />
      <meshBasicMaterial
        map={caption.texture}
        transparent
        opacity={0.92}
        depthWrite={false}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
