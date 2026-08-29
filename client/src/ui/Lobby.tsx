import { useState, type FormEvent } from "react";
import { DISPLAY_NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from "@facecards/shared";

/**
 * Phase-0 lobby. Deliberately plain: the real lobby (landing, avatar picker,
 * permission priming) is phase 3 work, and building it now would only be
 * rebuilt then.
 */
export function Lobby({
  busy,
  error,
  initialCode,
  onCreate,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  initialCode: string;
  onCreate(displayName: string): void;
  onJoin(code: string, displayName: string): void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState(initialCode);

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length > 0) onJoin(code, displayName);
  };

  return (
    <main className="lobby">
      <h1>FaceCards</h1>
      <p className="lobby__sub">Phase 0 spike: shared state, camera and mic.</p>

      <label className="field">
        <span>Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder="optional"
          autoComplete="off"
        />
      </label>

      <button
        className="btn btn--primary"
        disabled={busy}
        onClick={() => onCreate(displayName)}
      >
        Create room
      </button>

      <div className="lobby__or">or</div>

      <form className="lobby__join" onSubmit={submitJoin}>
        <label className="field">
          <span>Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={ROOM_CODE_LENGTH + 2}
            placeholder={"A".repeat(ROOM_CODE_LENGTH)}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button className="btn" disabled={busy || code.trim().length === 0}>
          Join
        </button>
      </form>

      {busy && <p className="note">Connecting…</p>}
      {error && <p className="note note--error">{error}</p>}
    </main>
  );
}
