import { MAX_PLAYERS } from "@facecards/shared";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { VideoTile } from "./VideoTile.js";

/**
 * Phase-0 "table": a video grid, the shared counter, and the seat list.
 *
 * There is no 3D here on purpose. Phase 0's job is to prove the plumbing;
 * phase 1 replaces this whole view with the R3F scene and keeps the hooks.
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
  const me = snapshot.players.find((p) => p.sessionId === sessionId);

  return (
    <main className="table">
      <header className="table__header">
        <div>
          <h1>
            Room <code className="code">{snapshot.code}</code>
          </h1>
          <button
            className="btn btn--ghost"
            onClick={() => void navigator.clipboard?.writeText(shareUrl)}
          >
            Copy invite link
          </button>
        </div>
        <div className="table__controls">
          <button className="btn" onClick={() => void media.toggleMic()}>
            {media.micMuted ? "Unmute mic" : "Mute mic"}
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
        // Browsers block playback until a gesture. Solved here rather than in
        // phase 5, because it is a one-line fix now and a mystery later.
        <button className="banner" onClick={() => void media.startAudio()}>
          Click to enable sound
        </button>
      )}
      {media.error && <p className="banner banner--error">{media.error}</p>}

      <section className="grid">
        <VideoTile
          el={media.localVideo}
          label={`${me?.displayName ?? "You"} (you)`}
          mirrored
          muted={media.micMuted}
          cameraOff={media.cameraOff}
          speaking={sessionId ? media.speaking.has(sessionId) : false}
        />
        {snapshot.players
          .filter((p) => p.sessionId !== sessionId)
          .map((p) => (
            <VideoTile
              key={p.sessionId}
              el={media.remotes.get(p.sessionId) ?? null}
              label={`${p.displayName} · seat ${p.seat + 1}`}
              speaking={media.speaking.has(p.sessionId)}
            />
          ))}
      </section>

      <section className="panel">
        <h2>Shared state</h2>
        <p className="counter">{snapshot.counter}</p>
        <button className="btn btn--primary" onClick={onBump}>
          Bump
        </button>
        <p className="note">
          {snapshot.lastBumpBy
            ? `Last bumped by ${snapshot.lastBumpBy}`
            : "Nobody has bumped yet"}
        </p>
        <p className="note">
          The client sends an intent with no number in it. The server owns the
          value, and both tabs are showing what it decided.
        </p>
      </section>

      <section className="panel">
        <h2>
          Seats ({snapshot.players.length}/{MAX_PLAYERS}) · media {media.state}
        </h2>
        <ul className="seats">
          {snapshot.players.map((p) => (
            <li key={p.sessionId}>
              <strong>seat {p.seat + 1}</strong> {p.displayName}
              {p.sessionId === sessionId && " (you)"}
              {/* Present for you, absent for everyone else. Not hidden by
                  this component: genuinely not in the other client's data. */}
              <span className="private">
                {p.privateNote ?? "private field not in this payload"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
