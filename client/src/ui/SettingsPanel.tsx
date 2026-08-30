import { useEffect, useRef, useState } from "react";
import { KEYBINDS, LOOK_KEYBIND_IDS, keyLabel, keybind } from "./keybinds.js";
import type { UseTableAudio } from "../audio/useTableAudio.js";
import type { UseMedia } from "../media/useMedia.js";
import { DEFAULT_SENSITIVITY } from "../scene/lookCurve.js";
import { QUALITY_SETTINGS, type QualitySetting } from "../scene/quality.js";
import type { UseQuality } from "../scene/useQuality.js";
import { MediaFaultBanner } from "./MediaFaultBanner.js";
import { useView } from "./useViewport.js";

/**
 * The Escape menu.
 *
 * While it is open the seated look is released, so the cursor is genuinely
 * free: this is the same job pointer lock's ESC overlay does in an FPS, minus
 * the lock, which we deliberately never took (see `SeatedCamera`).
 *
 * The view holds its angle rather than recentring while the panel is up. You
 * opened a menu, you did not stand up from the table.
 */

const SENSITIVITY_KEY = "facecards.look-sensitivity";

/**
 * Names for the quality settings.
 *
 * Deliberately not "Ultra / High / Medium / Low": there are three tiers and
 * the top one is what an ordinary laptop gets, so calling it anything grander
 * would invite people to hunt for a setting that is not there.
 */
const QUALITY_LABELS: Record<string, string> = {
  auto: "Auto",
  high: "High",
  medium: "Medium",
  low: "Low",
};

/**
 * A settings value that forgets itself on every reload is a bug with extra
 * steps. Storage can throw outright in a private window or with site data
 * blocked, so every access is guarded and the default is always usable.
 */
export function loadSensitivity(): number {
  try {
    const raw = window.localStorage.getItem(SENSITIVITY_KEY);
    if (raw === null) return DEFAULT_SENSITIVITY;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : DEFAULT_SENSITIVITY;
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

function saveSensitivity(value: number): void {
  try {
    window.localStorage.setItem(SENSITIVITY_KEY, String(value));
  } catch {
    // Not worth surfacing: the setting still applies for this session.
  }
}

export interface SettingsPanelProps {
  roomCode: string;
  shareUrl: string;
  media: UseMedia;
  /** Table sound: chips, cards and the room bed. Never the voices. */
  audio: UseTableAudio;
  sensitivity: number;
  /** The quality tier, what the player chose, and what the frame clock says. */
  quality: UseQuality;
  /** Dealt out of the next hand. Server-owned; this is what it says. */
  sittingOut: boolean;
  onSitOutChange(sittingOut: boolean): void;
  onSensitivityChange(value: number): void;
  onClose(): void;
  onLeave(): void;
}

export function SettingsPanel({
  roomCode,
  shareUrl,
  media,
  audio,
  sensitivity,
  quality,
  sittingOut,
  onSitOutChange,
  onSensitivityChange,
  onClose,
  onLeave,
}: SettingsPanelProps) {
  const { touch } = useView();
  const panelRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Move focus in on open, so Escape and Tab go somewhere sensible and the
  // panel is reachable without a mouse at all.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard?.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings__panel" ref={panelRef} tabIndex={-1}>
        <header className="settings__header">
          <h2>Settings</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <section className="settings__section">
          <h3>Camera and mic</h3>
          <div className="settings__row">
            <button className="btn" onClick={() => void media.toggleMic()}>
              {media.micMuted ? "Unmute mic" : "Mute mic"}
            </button>
            <button className="btn" onClick={() => void media.toggleCamera()}>
              {media.cameraOff ? "Turn camera on" : "Turn camera off"}
            </button>
          </div>
          {media.audioBlocked && (
            <button className="banner" onClick={() => void media.startAudio()}>
              {touch ? "Tap to enable sound" : "Click to enable sound"}
            </button>
          )}
          {/* The same banner the table shows, repeated here on purpose. The
              table's copy is suppressed while this panel is open, and this is
              also where somebody arrives after going to fix a permission in
              the browser's own settings - so it has to be reachable from the
              menu rather than only from the room behind it. */}
          <MediaFaultBanner media={media} />
          {media.error && <p className="note note--error">{media.error}</p>}
          <p className="note">
            Nothing you say or show here is recorded or stored, by this app or
            by anybody at the table. Both of these are reversible at any
            moment, from here or with a key.
          </p>
        </section>

        <section className="settings__section">
          <h3>Graphics</h3>
          <div className="settings__row" role="group" aria-label="Graphics quality">
            {QUALITY_SETTINGS.map((option) => (
              <button
                key={option}
                className={`btn${quality.setting === option ? " btn--primary" : ""}`}
                aria-pressed={quality.setting === option}
                onClick={() => quality.choose(option as QualitySetting)}
              >
                {QUALITY_LABELS[option]}
              </button>
            ))}
          </div>
          <p className="note">
            {quality.setting === "auto"
              ? `Watching the frame rate and adjusting. Currently ${QUALITY_LABELS[quality.autoTier]}.`
              : "Fixed. Automatic adjustment is off until this is set back to Auto."}
          </p>
          <p className="note">
            Lower settings spend less on shadows and pixels so that the faces
            keep moving, which is the one thing this is all for. Even the
            lowest still shows everybody.
          </p>
        </section>

        <section className="settings__section">
          <h3>Table sound</h3>
          <div className="settings__row">
            <button className="btn" onClick={() => audio.setMuted(!audio.muted)}>
              {audio.muted ? "Unmute table sound" : "Mute table sound"}
            </button>
          </div>
          <label className="settings__slider">
            <span>Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audio.volume}
              disabled={audio.muted}
              onChange={(event) =>
                audio.setVolume(Number.parseFloat(event.target.value))
              }
            />
          </label>
          <p className="note">
            Cards, chips and the room underneath them. Separate from everyone's
            voices, which have their own path and are never turned down by this.
          </p>
        </section>

        <section className="settings__section">
          <h3>Look</h3>
          <label className="settings__slider">
            <span>Sensitivity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sensitivity}
              onChange={(event) => {
                const value = Number.parseFloat(event.target.value);
                onSensitivityChange(value);
                saveSensitivity(value);
              }}
            />
          </label>
          <p className="note">
            {touch
              ? "How far the view turns for a given drag. Every setting still reaches the whole table; a lower one just asks for a longer sweep to get there."
              : "How far the view turns for a given cursor position. Every setting still reaches the whole table; a lower one just asks for a more deliberate movement to get there."}
          </p>
          {touch && (
            <p className="note">
              Drag anywhere on the table to look around. Your head stays where
              you leave it.
            </p>
          )}
        </section>

        {/* The whole section is about a device this player does not have.
            Printing eighteen shortcuts on a phone is eighteen instructions
            that cannot be followed, in the one panel small enough that
            scrolling past them costs something. */}
        {!touch && (
          <section className="settings__section">
            <h3>Keyboard</h3>
            <dl className="settings__keys">
              {KEYBINDS.map((bind) => (
                <div key={bind.id} className="settings__key">
                  <dt>
                    <kbd className="kbd">{keyLabel(bind.id)}</kbd>
                  </dt>
                  <dd>
                    {bind.label}
                    {bind.hold && <span className="settings__hold">hold</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="note">
              The mouse turns your head, so reaching for a button swings the
              view on the way there. Everything you do on your turn has a key
              so it does not have to.
            </p>
            <p className="note">
              {LOOK_KEYBIND_IDS.map((id) =>
                keybind(id).key.toUpperCase(),
              ).join("")}{" "}
              turn your head, and they add to the mouse rather than taking over
              from it. Let go and the cursor is still steering.
            </p>
          </section>
        )}

        <section className="settings__section">
          <h3>Room</h3>
          <div className="settings__row">
            <span className="hud__code">{roomCode}</span>
            <button className="btn" onClick={() => void copyInvite()}>
              {copied ? "Copied" : "Copy invite link"}
            </button>
          </div>
          <p className="note">Anyone with this link can take a seat.</p>
        </section>

        <section className="settings__section">
          <h3>Your seat</h3>
          <div className="settings__row">
            <button className="btn" onClick={() => onSitOutChange(!sittingOut)}>
              {sittingOut ? "Deal me back in" : "Sit out next hand"}
            </button>
          </div>
          <p className="note">
            {sittingOut
              ? "You are dealt out. Your seat and your chips are still yours, and you can talk to everyone the whole time."
              : "Skips the deals, keeps the seat. It takes effect at the next hand: nothing pulls you out of one you are already in."}
          </p>
        </section>

        <section className="settings__section">
          <button className="btn btn--ghost" onClick={onLeave}>
            Leave table
          </button>
          <p className="note">
            Leaving gives up the seat and the chips. A dropped connection does
            not: that holds your seat for a minute while you come back.
          </p>
        </section>

        {!touch && (
          <p className="note settings__hint">
            Press Esc to go back to the table.
          </p>
        )}
      </div>
    </div>
  );
}
