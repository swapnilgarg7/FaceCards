import { useMemo, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { Avatar } from "../avatars/Avatar.js";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { AttentionDirector, type AttentionPeer } from "./AttentionDirector.js";
import { ChipField, ChipGrabPad } from "./ChipField.js";
import { PokerTable } from "./PokerTable.js";
import { RoomShell } from "./RoomShell.js";
import { SeatPlaques } from "./SeatPlaques.js";
import { SeatedCamera } from "./SeatedCamera.js";
import { TableCards } from "./TableCards.js";
import { FIXTURES, PALETTE_FOG, ROOM_RADIUS } from "./decor.js";
import type { LookAxes } from "./keyboardLook.js";
import { assignSeats, seatLayout } from "./layout.js";

/**
 * The room: table, lights, one avatar per remote player, and the local
 * player's own seated camera.
 *
 * The local player gets no avatar. You are sitting in that seat, so their
 * head would be inside the near plane; the self-view lives in the HUD, where
 * it also does the job of letting someone frame their own face.
 */

export interface Room3DProps {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  media: UseMedia;
  /** False while an overlay owns the cursor, so the view stops following it. */
  lookEnabled: boolean;
  /** 0..1 look sensitivity, from the settings panel. */
  sensitivity: number;
  /** Which way the held W/A/S/D keys are turning the view. */
  lookKeys?: RefObject<LookAxes> | undefined;
  /** The local player is holding their own cards up to look at them. */
  peeking: boolean;
  onPeekChange(peeking: boolean): void;
  /** Chips the local player is mid-way through pushing in, or null. */
  betPreview: { seat: number; chipsForward: number } | null;
  /** True when a chip push is a legal thing to start right now. */
  canPushChips: boolean;
  onChipGrab(clientY: number): void;
}

function Lighting() {
  const pendant = FIXTURES.find((f) => f.id === "pendant")!;

  return (
    <>
      {/*
        Fill, and the one rule it exists to keep: **no seat is better lit than
        any other.** A single rim light would flatter whoever happened to sit
        in front of it and silhouette whoever sat opposite, and at a round
        table where everyone can see everyone that is a real unfairness rather
        than a stylistic one.

        Warm from above, cool from below, because that is what the room
        actually contains: a warm pendant over the table and a cold neon cove
        washing the carpet. The hemisphere is doing the bounce those two would
        do if this scene could afford global illumination.
      */}
      <hemisphereLight args={["#ffcf9c", "#2a3f66", 0.62]} />

      {/* So that nothing is ever pure black - a face in shadow is a face
          nobody can read, which defeats the entire product. */}
      <ambientLight intensity={0.16} color="#ffe6c9" />

      {/*
        The pooled light the spec asks for, hanging inside the pendant shade
        `RoomShell` draws. One shadow caster, one bounded map: six avatars and
        a table are well inside budget, and the contact shadow is most of what
        sells the felt as a surface objects are resting *on*.
      */}
      <spotLight
        position={[0, pendant.y - 0.14, 0]}
        angle={0.78}
        penumbra={0.82}
        intensity={34}
        distance={7}
        color="#ffdca8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.4}
        shadow-camera-far={4}
        shadow-bias={-0.0015}
      />

      {/*
        A dim, shadowless wash for the walls. Without it the room shell is a
        silhouette and the table appears to float in a void - which is the
        thing the shell was added to fix. Placed on the axis and high, so like
        everything else in the room it treats every bearing the same.
      */}
      <pointLight
        position={[0, 2.5, 0]}
        intensity={9}
        distance={ROOM_RADIUS * 2.2}
        decay={2}
        color="#ffb98f"
      />
    </>
  );
}

export function Room3D({
  snapshot,
  sessionId,
  media,
  lookEnabled,
  sensitivity,
  lookKeys,
  peeking,
  onPeekChange,
  betPreview,
  canPushChips,
  onChipGrab,
}: Room3DProps) {
  const players = snapshot.players;

  // Placement follows who is actually here, so two players sit opposite
  // rather than taking the first two slots of a table built for six.
  const placed = useMemo(
    () => assignSeats(players.map((player) => player.seat)),
    [players],
  );

  // Falls back to a lone seat for the frames between joining and the first
  // state patch arriving, where the local player is not in the list yet.
  const mySeatIndex = players.find((p) => p.sessionId === sessionId)?.seat;
  const mySeat =
    (mySeatIndex === undefined ? undefined : placed.get(mySeatIndex)) ??
    seatLayout(1)[0]!;

  const others = players.filter((player) => player.sessionId !== sessionId);
  const mySeatRing = mySeatIndex === undefined ? undefined : placed.get(mySeatIndex);

  // Where every other head is, for the quality director. Derived from the same
  // placement the avatars use, so what it upgrades is what you are looking at.
  const attentionPeers: AttentionPeer[] = others.flatMap((player) => {
    const seat = placed.get(player.seat);
    return seat ? [{ peerId: player.sessionId, seat }] : [];
  });

  return (
    <Canvas
      shadows
      // Cap the pixel ratio: a Retina MacBook Air renders four times the
      // pixels for a difference nobody sees on a stylised scene, and the 60
      // FPS target is a design constraint rather than a phase-6 cleanup.
      dpr={[1, 1.75]}
      camera={{ fov: 55, near: 0.05, far: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      {/* The background is only ever seen through the gap under the table
          and above the cornice, but it has to agree with the walls or those
          gaps read as holes cut in the room. */}
      <color attach="background" args={[PALETTE_FOG]} />
      {/* Far enough out that the near wall is unaffected and the far one is
          softened: at four and a half metres across, this is the whole of the
          depth cue a room this small gets. */}
      <fog attach="fog" args={[PALETTE_FOG, 3.4, 11]} />

      <Lighting />
      <RoomShell />
      <PokerTable />

      {/* Phase 4: the game as objects. Cards on the felt you can pick up and
          peek at, and every chip in the room in one instanced mesh. Both read
          server state and neither owns any of it. */}
      <TableCards
        snapshot={snapshot}
        placed={placed}
        sessionId={sessionId}
        peeking={peeking}
        onPeekChange={onPeekChange}
      />
      <ChipField snapshot={snapshot} placed={placed} preview={betPreview} />

      {/* Phase 5: the numbers, on the table instead of in a list. Each seat's
          stack is engraved on the rail in front of it, which from every other
          seat is directly under that person's face. */}
      <SeatPlaques snapshot={snapshot} placed={placed} />
      {mySeatRing && (
        <ChipGrabPad
          seat={mySeatRing}
          enabled={canPushChips}
          onGrab={(event) => onChipGrab(event.clientY)}
        />
      )}

      <SeatedCamera
        seat={mySeat}
        lookEnabled={lookEnabled}
        sensitivity={sensitivity}
        lookKeys={lookKeys}
      />

      {/* Spec sections 6 and 12: the face you turn towards gets the top
          simulcast layer and the rest step down. Renders nothing. */}
      <AttentionDirector peers={attentionPeers} setQuality={media.setQuality} />

      {others
        .map((player) => {
          const seat = placed.get(player.seat);
          if (!seat) return null;
          return (
            <Avatar
              key={player.sessionId}
              seat={seat}
              displayName={player.displayName}
              avatar={player.avatar}
              peerId={player.sessionId}
              videoEl={media.remotes.get(player.sessionId) ?? null}
              // Their machine measured where their face is and sent it. This
              // client never runs detection on a remote video: six detectors
              // per tab is the cost, and a downscaled simulcast layer is the
              // worst possible input to give one.
              faceBoxes={media.faceBoxes}
              // Only your own image mirrors. Mirroring someone else's face
              // puts their wedding ring on the wrong hand.
              mirror={false}
              speaking={media.speaking.has(player.sessionId)}
              micMuted={media.remoteMicMuted.has(player.sessionId)}
              cameraOff={media.remoteCameraOff.has(player.sessionId)}
              // Their seat is being held through a reconnection window. The
              // body stays put, drained, so the chair does not read as free.
              away={!player.connected}
            />
          );
        })}
    </Canvas>
  );
}
