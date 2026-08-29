import { MAX_PLAYERS } from "@facecards/shared";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { Room3D } from "../scene/Room3D.js";
import { VideoTile } from "./VideoTile.js";

/**
 * The table: a full-bleed 3D room with a thin HUD floating over it.
 *
 * The HUD is deliberately sparse. Everything it could show about a player -
 * who they are, whether they are talking, whether they are muted - is already
 * on their avatar, and every element added here is one more thing competing
 * with the faces, which are the product.
 */
export function Table({
  snapshot,
  sessionId,
  media,
  onBump,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  media: UseMedia;
  onBump(): void;
  onLeave(): void;
}) {
  const shareUrl = `${window.location.origin}/?room=${snapshot.code}`;

  return (
    <main className="room">
      <div className="room__scene">
        <Room3D
          players={snapshot.players}
          sessionId={sessionId}
          media={media}
        />
      </div>

      <header className="hud hud--top">
        <div className="hud__group">
          <span className="hud__code">{snapshot.code}</span>
          <button
            className="btn btn--ghost"
            onClick={() => void navigator.clipboard?.writeText(shareUrl)}
          >
            Copy invite
          </button>
          <span className="hud__meta">
            {snapshot.players.length}/{MAX_PLAYERS} seated · {media.state}
          </span>
        </div>

        <div className="hud__group">
          <button className="btn" onClick={() => void media.toggleMic()}>
            {media.micMuted ? "Unmute" : "Mute"}
          </button>
          <button className="btn" onClick={() => void media.toggleCamera()}>
            {media.cameraOff ? "Camera on" : "Camera off"}
          </button>
          <button className="btn btn--ghost" onClick={onLeave}>
            Leave
          </button>
        </div>
      </header>

      {media.audioBlocked && (
        <button
          className="banner hud__banner"
          onClick={() => void media.startAudio()}
        >
          Click to enable sound
        </button>
      )}
      {media.error && (
        <p className="banner banner--error hud__banner">{media.error}</p>
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

      {/* Phase-0 plumbing proof, kept until real poker state replaces it in
          phase 2. It is the cheapest possible check that server state still
          reaches both tabs. */}
      <footer className="hud hud--bottom">
        <button className="btn btn--ghost" onClick={onBump}>
          Bump
        </button>
        <span className="hud__meta">
          {snapshot.counter}
          {snapshot.lastBumpBy && ` · ${snapshot.lastBumpBy}`}
        </span>
      </footer>
    </main>
  );
}
