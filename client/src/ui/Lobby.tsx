import { useState, type FormEvent } from "react";
import {
  DISPLAY_NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
} from "@facecards/shared";

/**
 * The lobby, in two shapes.
 *
 * Arriving on an invite link is a different intent from arriving cold, and the
 * lobby should not make someone re-state something the link already said. If
 * the URL carries a usable room code, the only thing left to ask is who they
 * are: name, Enter, seated. Creating a room becomes the secondary path,
 * because someone following a friend's link almost never wants it.
 *
 * The richer lobby (avatar picker, permission priming) is phase 3 work.
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

  // A malformed code in the URL is not an invite: fall through to the manual
  // form with it prefilled, so a mistyped link is visible and fixable rather
  // than failing at the server for no stated reason.
  const invited = ROOM_CODE_PATTERN.test(initialCode);
  const [showManual, setShowManual] = useState(!invited);

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    if (code.trim().length > 0) onJoin(code, displayName);
  };

  const nameField = (
    <label className="field">
      <span>Display name</span>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        placeholder="optional"
        autoComplete="off"
        // The one thing an invited guest still has to supply, so put the
        // cursor in it and let Enter do the rest.
        autoFocus={!showManual}
      />
    </label>
  );

  const status = (
    <>
      {busy && <p className="note">Connecting…</p>}
      {error && <p className="note note--error">{error}</p>}
    </>
  );

  if (!showManual) {
    return (
      <main className="lobby">
        <h1>FaceCards</h1>
        <p className="lobby__sub">
          You have been invited to a table. Grab a seat.
        </p>

        <form className="lobby__invited" onSubmit={submitJoin}>
          <p className="lobby__room">
            Room <code className="code">{initialCode}</code>
          </p>

          {nameField}

          <button className="btn btn--primary" disabled={busy}>
            Take a seat
          </button>
        </form>

        {status}

        <div className="lobby__alt">
          <button
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => setShowManual(true)}
          >
            Use a different code
          </button>
          <button
            className="btn btn--ghost"
            disabled={busy}
            onClick={() => onCreate(displayName)}
          >
            Create a new room
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="lobby">
      <h1>FaceCards</h1>
      <p className="lobby__sub">Sit down at a table with your friends.</p>

      {nameField}

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

      {status}
    </main>
  );
}
