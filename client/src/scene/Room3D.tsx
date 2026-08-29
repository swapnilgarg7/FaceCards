import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping } from "three";
import { Avatar } from "../avatars/Avatar.js";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { AttentionDirector, type AttentionPeer } from "./AttentionDirector.js";
import { ChipField, ChipGrabPad } from "./ChipField.js";
import { PokerTable } from "./PokerTable.js";
import { SeatedCamera } from "./SeatedCamera.js";
import { TableCards } from "./TableCards.js";
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
  return (
    <>
      {/* Even fill from every direction, so no seat is better lit than any
          other. A single rim light would flatter whoever happened to sit in
          front of it and silhouette whoever sat opposite. */}
      <hemisphereLight args={["#b9c6ff", "#3a2a1e", 1.1]} />

      {/* The pooled light over the table the spec asks for. One shadow
          caster, small map: six avatars is well inside budget, and the
          contact shadow is most of what sells the table as a physical
          object. */}
      <spotLight
        position={[0, 2.6, 0]}
        angle={0.95}
        penumbra={0.75}
        intensity={26}
        distance={9}
        color="#ffe6b8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0015}
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
      <color attach="background" args={["#0b0d12"]} />
      <fog attach="fog" args={["#0b0d12", 4, 12]} />

      <Lighting />
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
