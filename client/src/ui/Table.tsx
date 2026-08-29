import { useEffect, useState } from "react";
import { MAX_PLAYERS, type PokerActionType } from "@facecards/shared";
import { useFaceTracking } from "../avatars/useFaceTracking.js";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { Room3D } from "../scene/Room3D.js";
import { ActionBar } from "./ActionBar.js";
import { FaceDebug } from "./FaceDebug.js";
import { HandHud } from "./HandHud.js";
import { SettingsPanel, loadSensitivity } from "./SettingsPanel.js";
import { VideoTile } from "./VideoTile.js";

/**
 * The table: a full-bleed 3D room with a thin HUD floating over it.
 *
 * The HUD is deliberately sparse. Everything it could show about a player -
 * who they are, whether they are talking, whether they are muted - is already
 * on their avatar, and every element added here is one more thing competing
 * with the faces, which are the product. Anything that is not needed mid-hand
 * lives behind Escape instead.
 */
export function Table({
  snapshot,
  sessionId,
  media,
  rejection,
  onAct,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  media: UseMedia;
  rejection: string | null;
  onAct(turn: number, type: PokerActionType, amount?: number): void;
  onLeave(): void;
}) {
  const me = snapshot.players.find((p) => p.sessionId === sessionId);
  const shareUrl = `${window.location.origin}/?room=${snapshot.code}`;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState(loadSensitivity);

  // Find our own face and tell the room where it is, so that the avatar
  // everyone else is looking at frames it properly. Nothing on this screen
  // shows the result: it is entirely for other people's benefit, which is also
  // why it is here rather than buried in the scene that never renders us.
  const tracking = useFaceTracking(media.localVideo, media.sendFaceBox);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape is free to mean this, because we never took pointer lock: in a
      // locked FPS the browser owns this key and shows its own overlay.
      event.preventDefault();
      setSettingsOpen((open) => !open);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="room">
      <div className="room__scene">
        <Room3D
          players={snapshot.players}
          sessionId={sessionId}
          media={media}
          // The whole point of the Escape menu: the cursor is handed back and
          // stops dragging the view around with it.
          lookEnabled={!settingsOpen}
          sensitivity={sensitivity}
        />
      </div>

      <header className="hud hud--top">
        <div className="hud__group">
          <span className="hud__code">{snapshot.code}</span>
          <span className="hud__meta">
            {snapshot.players.length}/{MAX_PLAYERS} seated · {media.state}
          </span>
        </div>

        <div className="hud__group">
          {/* Mute and camera stay out here as well as in the menu: they are
              the two things someone reaches for mid-sentence. */}
          <button className="btn" onClick={() => void media.toggleMic()}>
            {media.micMuted ? "Unmute" : "Mute"}
          </button>
          <button className="btn" onClick={() => void media.toggleCamera()}>
            {media.cameraOff ? "Camera on" : "Camera off"}
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            Settings <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      {media.audioBlocked && !settingsOpen && (
        <button
          className="banner hud__banner"
          onClick={() => void media.startAudio()}
        >
          Click to enable sound
        </button>
      )}

      {/* Self-view. You have no avatar, because you are sitting in that seat,
          and this is also where someone frames their own face - which is what
          makes the crop on everyone else's avatar look right. */}
      <div className="hud hud--self">
        <VideoTile
          el={media.localVideo}
          label="You"
          mirrored
          muted={media.micMuted}
          cameraOff={media.cameraOff}
          speaking={sessionId ? media.speaking.has(sessionId) : false}
        />
      </div>

      {/* The game itself. Cards, board, pot and stacks read straight off
          server state; the action bar sends intents back and nothing else.
          All of it moves onto the table as physical objects in phases 4 and
          5, at which point this becomes the fallback rather than the game. */}
      <div className="hud hud--table">
        <HandHud snapshot={snapshot} me={me} />
      </div>

      <footer className="hud hud--bottom">
        <ActionBar
          snapshot={snapshot}
          me={me}
          rejection={rejection}
          onAct={onAct}
        />
      </footer>

      {/* Dev only. `import.meta.env.DEV` is substituted with `false` at build
          time, so this cannot render in production. The component itself is
          not tree-shaken out of the bundle - about a kilobyte of dead code
          that never executes - which is a fair price for the afternoon it
          saves the next time framing looks wrong. */}
      {import.meta.env.DEV && <FaceDebug media={media} tracking={tracking} />}

      {settingsOpen && (
        <SettingsPanel
          roomCode={snapshot.code}
          shareUrl={shareUrl}
          media={media}
          sensitivity={sensitivity}
          onSensitivityChange={setSensitivity}
          onClose={() => setSettingsOpen(false)}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}
