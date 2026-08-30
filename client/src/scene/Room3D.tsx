import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, PerspectiveCamera } from "three";
import { Avatar } from "../avatars/Avatar.js";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { AttentionDirector, type AttentionPeer } from "./AttentionDirector.js";
import { ChipField, ChipGrabPad } from "./ChipField.js";
import { HoloBoard } from "./HoloBoard.js";
import { PokerTable } from "./PokerTable.js";
import { RoomShell } from "./RoomShell.js";
import { SeatPlaques } from "./SeatPlaques.js";
import { SeatedCamera } from "./SeatedCamera.js";
import { TableCards } from "./TableCards.js";
import { FIXTURES, PALETTE_FOG, ROOM_RADIUS } from "./decor.js";
import type { LookAxes } from "./keyboardLook.js";
import { assignSeats, seatLayout } from "./layout.js";
import { fitFov } from "./mobileView.js";
import { capStream, type QualityProfile } from "./quality.js";
import { FrameSampler } from "./useQuality.js";

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
  /** How the pointer turns the head. See `SeatedCamera`. */
  lookMode?: "hover" | "drag";
  /**
   * How much this machine is asked to draw.
   *
   * Replaces the `lite` flag phase 5 carried. `lite` was a single boolean that
   * meant "this is a phone", and it was right about phones and silent about
   * everything else - a five-year-old laptop, a machine with hardware
   * acceleration turned off, a browser that has been throttled because the
   * battery is low. All of those need the same three savings a phone needs,
   * and none of them are a phone. See `scene/quality.ts`.
   */
  quality: QualityProfile;
  /**
   * Where each frame's duration goes. The automatic fallback's only input.
   *
   * Passed in rather than owned here because the tier it produces has to reach
   * the settings panel, which lives outside the Canvas.
   */
  onFrame(dtMs: number): void;
}

/**
 * Keep the lens matched to the window's shape.
 *
 * The camera prop on `Canvas` is read once at creation, and a phone changes
 * shape twice: when it is turned, and every time the URL bar collapses. This
 * is the only thing in the scene that touches the projection matrix, and it
 * does so on resize rather than per frame - `fitFov` is stepped precisely so
 * that a slow URL-bar collapse cannot make the lens breathe.
 */
function FitLens() {
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const fov = fitFov(width, height);
    if (camera.fov === fov) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [camera, width, height]);

  return null;
}

function Lighting({ quality }: { quality: QualityProfile }) {
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
        castShadow={quality.shadows}
        shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
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
  lookMode = "hover",
  quality,
  onFrame,
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

  // Multisampling is a property of the WebGL context, so it is decided when
  // the context is created and can never be changed afterwards. R3F builds its
  // renderer exactly once for the life of a `<Canvas>` and quietly ignores a
  // later `antialias` - so writing `antialias={quality.antialias}` inline would
  // read as a live setting while being a dead one, which is worse than not
  // having it.
  //
  // Captured at first render instead, which is the moment it is actually read,
  // and correct for the case that matters: the probe in `useQuality` runs
  // before anything mounts, so a phone or a software rasteriser creates its
  // context without MSAA in the first place. A machine the *frame clock* later
  // demotes keeps whatever it started with, and still gets the three savings
  // that can be applied live - pixel ratio, shadows and the video ceiling.
  // Rebuilding the renderer to recover the fourth would throw away the whole
  // scene and every texture in it, which costs far more than the multisampling
  // is worth, and would do it at the exact moment the machine is struggling.
  const antialias = useRef(quality.antialias).current;

  /**
   * The attention director's request, capped by the tier.
   *
   * A ceiling, never a floor: a face the director wants at `low` stays at
   * `low`. This is the lever that matters most on a weak machine, because
   * eight simultaneous video decodes cost more than everything else in the
   * frame put together - and it is the one saving that is paid on the CPU,
   * where a laptop under thermal pressure has the least left to give.
   *
   * Wrapped here rather than inside `AttentionDirector` because that component
   * decides *where you are looking*, which is a question about the scene, and
   * this is a question about the machine. Keeping them apart means the
   * hysteresis in `attention.ts` stays testable without a quality tier in it.
   */
  const mediaSetQuality = media.setQuality;
  const setQuality = useCallback(
    (peerId: string, wanted: "high" | "medium" | "low") => {
      mediaSetQuality(peerId, capStream(wanted, quality));
    },
    // The *method*, not the `media` object. `useMedia` returns a fresh object
    // every render, so depending on it would give this a new identity every
    // render too - and `AttentionDirector` takes it as a prop and reads it
    // inside `useFrame`, which is the one place in the scene that must not be
    // re-subscribed sixty times a second. `media.setQuality` is itself a
    // stable `useCallback`, for exactly this reason.
    [mediaSetQuality, quality],
  );

  return (
    <Canvas
      // The contact shadow under the chips is most of what sells the felt as
      // a surface - and on a handset it is also the single most expensive
      // thing in the frame. A phone keeps the faces and loses the shadow.
      // This one does take effect on a later render: R3F reapplies it to the
      // existing renderer's shadow map rather than rebuilding anything.
      shadows={quality.shadows}
      // Cap the pixel ratio: a Retina MacBook Air renders four times the
      // pixels for a difference nobody sees on a stylised scene, and the 60
      // FPS target is a design constraint rather than a phase-6 cleanup. A
      // phone at DPR 3 is nine times the pixels, on a tenth of the GPU.
      dpr={quality.dpr}
      camera={{ fov: fitFov(window.innerWidth, window.innerHeight), near: 0.05, far: 40 }}
      gl={{ antialias, powerPreference: "high-performance" }}
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

      <FitLens />
      {/* The frame clock the automatic fallback reads. Renders nothing, and
          costs two additions against a ref per frame. See `quality.ts`. */}
      <FrameSampler sample={onFrame} />
      <Lighting quality={quality} />
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
        // Press-and-hold on the felt is a mouse gesture. On a touchscreen the
        // same press is the drag that turns your head, and two readings of one
        // finger is a table that lifts its cards every time you look left. The
        // phone shows the two cards face up in the footer instead.
        peekPad={lookMode !== "drag"}
      />
      <ChipField snapshot={snapshot} placed={placed} preview={betPreview} />

      {/* The same five cards, stood up over the middle of the table and
          turned to face whoever is looking. The felt still holds the real
          board - this is the copy you can actually read from a seat, so that
          nobody has to break eye contact with the table to find out what the
          turn was. See `holo.ts`. */}
      <HoloBoard snapshot={snapshot} />

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
        lookMode={lookMode}
      />

      {/* Spec sections 6 and 12: the face you turn towards gets the top
          simulcast layer and the rest step down. Renders nothing. */}
      <AttentionDirector peers={attentionPeers} setQuality={setQuality} />

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
              // The table is waiting on this seat. Drawn over their head as
              // well as on their rail plaque, because the plaque is a number
              // you have to already be looking at and the question "whose turn
              // is it" is asked from wherever you happen to be looking.
              acting={snapshot.actingSeat === player.seat}
              // Their seat is being held through a reconnection window. The
              // body stays put, drained, so the chair does not read as free.
              away={!player.connected}
            />
          );
        })}
    </Canvas>
  );
}
