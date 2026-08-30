import { useEffect, useState, type FormEvent } from "react";
import {
  DEFAULT_AVATAR,
  DISPLAY_NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
  isAvatarId,
} from "@facecards/shared";
import { useServerWake } from "../net/useServerWake.js";
import {
  assessSupport,
  readCapabilities,
  supportHeadline,
} from "../support.js";
import {
  queryMediaPermission,
  requestMediaPermission,
  type MediaPermission,
} from "../media/permissions.js";
import { AvatarPicker } from "./AvatarPicker.js";
import { ServerWaking } from "./ServerWaking.js";

/**
 * The lobby, in two shapes.
 *
 * Arriving on an invite link is a different intent from arriving cold, and the
 * lobby should not make someone re-state something the link already said. If
 * the URL carries a usable room code, the only things left to ask are who they
 * are and what they look like: name, avatar, Enter, seated. Creating a room
 * becomes the secondary path, because someone following a friend's link almost
 * never wants it.
 *
 * Spec section 3 puts camera and mic permission here, before the seat, and it
 * belongs here for a reason: the prompt is browser chrome that blocks until
 * answered, and the worst moment to meet it is the instant a 3D room finishes
 * loading. Asking in the lobby means the answer is known before anyone sits
 * down. It is not a gate, though - a refusal seats you anyway, because being
 * at the table watching is better than being stuck on a form.
 */

const NAME_KEY = "facecards.display-name";
const AVATAR_KEY = "facecards.avatar";

/**
 * Storage can throw outright in a private window or with site data blocked, so
 * every access is guarded and the default is always usable.
 */
function load(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not worth surfacing: the choice still applies for this session.
  }
}

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
  onCreate(displayName: string, avatar: string): void;
  onJoin(code: string, displayName: string, avatar: string): void;
}) {
  const [displayName, setDisplayName] = useState(() => load(NAME_KEY, ""));
  const [avatar, setAvatar] = useState(() => {
    const stored = load(AVATAR_KEY, DEFAULT_AVATAR);
    // A stored id from an older build is not an id this one ships.
    return isAvatarId(stored) ? stored : DEFAULT_AVATAR;
  });
  const [code, setCode] = useState(initialCode);
  const [permission, setPermission] = useState<MediaPermission>("unknown");
  /**
   * What this browser cannot do, probed once.
   *
   * In the lobby rather than at the table, for the same reason the permission
   * prompt is: the worst moment to find out that hardware acceleration is off
   * is after a 3D room has failed to appear. `useState` with an initialiser
   * rather than an effect, because the probe creates and destroys a WebGL
   * context and doing that twice under StrictMode is two contexts against a
   * browser limit of about sixteen.
   */
  const [support] = useState(() => assessSupport(readCapabilities()));
  // Starts the server booting the moment this mounts, so the wait overlaps
  // with filling the form in rather than following it. See net/wake.ts.
  const wake = useServerWake();
  const [permissionNote, setPermissionNote] = useState<string | null>(null);

  // A malformed code in the URL is not an invite: fall through to the manual
  // form with it prefilled, so a mistyped link is visible and fixable rather
  // than failing at the server for no stated reason.
  const invited = ROOM_CODE_PATTERN.test(initialCode);
  const [showManual, setShowManual] = useState(!invited);

  // What the browser already knows, without prompting. Someone who granted
  // this yesterday should not be asked to click a button about it today.
  useEffect(() => {
    let live = true;
    void queryMediaPermission().then((state) => {
      if (live) setPermission(state);
    });
    return () => {
      live = false;
    };
  }, []);

  const ask = async (): Promise<void> => {
    setPermission("asking");
    const result = await requestMediaPermission();
    setPermission(result.state);
    setPermissionNote(result.fault?.message ?? null);
  };

  /**
   * Prime permission, then sit down either way.
   *
   * One click does both, because two buttons in a row that must be pressed in
   * order is a form, not a door. `await` matters: joining while the prompt is
   * still up would load the room behind a modal dialog.
   */
  const seat = async (go: () => void): Promise<void> => {
    if (permission === "unknown") await ask();
    save(NAME_KEY, displayName);
    save(AVATAR_KEY, avatar);
    go();
  };

  const submitJoin = (e: FormEvent) => {
    e.preventDefault();
    const target = showManual ? code : initialCode;
    if (target.trim().length === 0) return;
    void seat(() => onJoin(target, displayName, avatar));
  };

  const create = () => void seat(() => onCreate(displayName, avatar));

  const nameField = (
    <label className="field">
      <span>Display name</span>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        placeholder="john"
        autoComplete="off"
        // The one thing an invited guest still has to supply, so put the
        // cursor in it and let Enter do the rest.
        autoFocus={!showManual}
      />
    </label>
  );

  const picker = (
    <AvatarPicker value={avatar} onChange={setAvatar} disabled={busy} />
  );

  const permissionRow = (
    <div className="lobby__permission">
      {permission === "granted" ? (
        <p className="note note--ok">Camera and mic ready.</p>
      ) : (
        <>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy || permission === "asking"}
            onClick={() => void ask()}
          >
            {permission === "asking"
              ? "Waiting for the browser…"
              : "Allow camera and mic"}
          </button>
          <p className="note">
            {permissionNote ??
              "Your face on your avatar and your voice at the table. Nothing is recorded or stored."}
          </p>
        </>
      )}
    </div>
  );

  /**
   * What this browser is missing, said once, up front.
   *
   * Never a gate, even when the level is "unsupported". Somebody on a locked
   * down work laptop deserves to be told why the room will not draw rather
   * than to be told they may not try - and the one case that genuinely cannot
   * work, an insecure origin, is a case where refusing the button would not
   * help either. See `support.ts`.
   */
  const supportNote = supportHeadline(support);
  const banner = supportNote && (
    <p
      className={`note ${support.level === "unsupported" ? "note--error" : ""}`}
      role={support.level === "unsupported" ? "alert" : "status"}
    >
      {supportNote}
    </p>
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

        <ServerWaking status={wake} />
        {banner}

        <form className="lobby__invited" onSubmit={submitJoin}>
          <p className="lobby__room">
            Room <code className="code">{initialCode}</code>
          </p>

          {nameField}
          {picker}
          {permissionRow}

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
          <button className="btn btn--ghost" disabled={busy} onClick={create}>
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

      <ServerWaking status={wake} />
      {banner}

      {nameField}
      {picker}
      {permissionRow}

      <button className="btn btn--primary" disabled={busy} onClick={create}>
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
