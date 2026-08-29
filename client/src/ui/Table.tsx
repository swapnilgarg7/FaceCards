import { useCallback, useState } from "react";
import { MAX_PLAYERS, type PokerActionType } from "@facecards/shared";
import { useTableAudio } from "../audio/useTableAudio.js";
import { useFaceTracking } from "../avatars/useFaceTracking.js";
import type { UseMedia } from "../media/useMedia.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { Room3D } from "../scene/Room3D.js";
import { ActionBar } from "./ActionBar.js";
import { FaceDebug } from "./FaceDebug.js";
import { HandHud } from "./HandHud.js";
import { Kbd } from "./Kbd.js";
import { Leaderboard } from "./Leaderboard.js";
import { PeekHint } from "./PeekHint.js";
import { SettingsPanel, loadSensitivity } from "./SettingsPanel.js";
import { PlayGate } from "./PlayGate.js";
import { startGate } from "./startGate.js";
import { VideoTile } from "./VideoTile.js";
import { useChipPush } from "./useChipPush.js";
import { useHoldKeybind, useKeybinds } from "./useKeybinds.js";
import { useLookKeys } from "./useLookKeys.js";

/**
 * The table: a full-bleed 3D room with a thin HUD floating over it.
 *
 * The HUD is deliberately sparse. Everything it could show about a player -
 * who they are, whether they are talking, whether they are muted - is already
 * on their avatar, and every element added here is one more thing competing
 * with the faces, which are the product. Anything that is not needed mid-hand
 * lives behind Escape instead.
 *
 * It is also, deliberately, mostly keyboard. The mouse drives the camera, so
 * every trip to a button turns your head on the way; the buttons stay as a
 * visible fallback and as the place the shortcuts are advertised, but the keys
 * are the intended path. See `keybinds.ts`.
 */
export function Table({
  snapshot,
  sessionId,
  media,
  rejection,
  reconnecting,
  onAct,
  onReady,
  onSitOutChange,
  onBuyIn,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  media: UseMedia;
  rejection: string | null;
  /** The socket dropped and we are inside the server's grace window. */
  reconnecting: boolean;
  onAct(turn: number, type: PokerActionType, amount?: number): void;
  /** "I am ready." Nothing is dealt to this seat until it has been sent. */
  onReady(): void;
  onSitOutChange(sittingOut: boolean): void;
  /** Ask for more chips behind this seat. The server decides how many, and when. */
  onBuyIn(amount: number): void;
  onLeave(): void;
}) {
  const me = snapshot.players.find((p) => p.sessionId === sessionId);
  // Whether the evening has begun. Until it has, the bottom of the screen
  // belongs to Play rather than to Fold/Check/Raise.
  const gate = startGate(snapshot, me);
  const shareUrl = `${window.location.origin}/?room=${snapshot.code}`;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState(loadSensitivity);
  const [peeking, setPeeking] = useState(false);

  // The table's own sound, derived from the difference between one snapshot
  // and the next. See `audio/cues.ts`: there is no event stream, only state
  // and state that changed.
  const audio = useTableAudio(snapshot);

  // Pushing chips towards the pot. Every value it can land on is one the
  // server published as legal, so a gesture cannot aim at an illegal action;
  // the intent goes down the same `act()` path the buttons use.
  const push = useChipPush({
    snapshot,
    me,
    enabled: !settingsOpen,
    onAct,
    onDetent: useCallback(
      () => audio.play("clink", 0, 0.45),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [audio.play],
    ),
  });

  // Hold to look at your cards. Local and view-only: the server already sent
  // this client its own two cards, so there is nothing to ask for and nothing
  // to tell anyone. Two ways in, because both are the same gesture: hold the
  // key, or press and hold on the cards themselves.
  const changePeek = useCallback(
    (next: boolean) => {
      setPeeking((current) => {
        if (current === next) return current;
        audio.play(next ? "deal" : "flip", 0, 0.5);
        return next;
      });
    },
    [audio],
  );
  useHoldKeybind("peek", changePeek, !settingsOpen);

  // W, A, S and D, tracked outside React because the camera reads them once a
  // frame and a render per keystroke is the one thing the scene must not do.
  // Released for the same three reasons the cursor is: a menu is up, or the
  // mouse is already busy holding a card or pushing chips.
  const lookKeys = useLookKeys(!settingsOpen && !peeking && !push.active);

  // Find our own face and tell the room where it is, so that the avatar
  // everyone else is looking at frames it properly. Nothing on this screen
  // shows the result: it is entirely for other people's benefit, which is also
  // why it is here rather than buried in the scene that never renders us.
  const tracking = useFaceTracking(media.localVideo, media.sendFaceBox);

  // Room-level shortcuts. Escape is free to mean this because we never took
  // pointer lock: in a locked FPS the browser owns that key and shows its own
  // overlay. Mute and camera are here rather than only in the menu because
  // they are the two things someone reaches for mid-sentence, and opening a
  // panel to find them is exactly the wrong moment for it.
  useKeybinds({
    settings: () => setSettingsOpen((open) => !open),
    mute: () => void media.toggleMic(),
    camera: () => void media.toggleCamera(),
  });

  return (
    <main className="room">
      <div className="room__scene">
        <Room3D
          snapshot={snapshot}
          sessionId={sessionId}
          media={media}
          // The whole point of the Escape menu: the cursor is handed back and
          // stops dragging the view around with it. Peeking and pushing chips
          // release it for a different reason - both are gestures made with
          // the mouse, and a head that swung across the table halfway through
          // one would make it unusable.
          lookEnabled={!settingsOpen && !peeking && !push.active}
          sensitivity={sensitivity}
          lookKeys={lookKeys}
          peeking={peeking}
          onPeekChange={changePeek}
          betPreview={push.preview}
          canPushChips={!settingsOpen && push.rungCount > 0}
          onChipGrab={push.begin}
        />
      </div>

      <header className="hud hud--top">
        <div className="hud__group hud__group--stacked">
          <div className="hud__group">
            <span className="hud__code">{snapshot.code}</span>
            <span className="hud__meta">
              {snapshot.players.length}/{MAX_PLAYERS} seated · {media.state}
            </span>
          </div>
          {/* The keys that are always live and belong to the room rather than
              to a decision. The ones that depend on whose turn it is are
              printed on the action buttons instead, where they mean
              something, and the peek lives over the cards it lifts. */}
          <div className="hud__keys">
            <Kbd bind="lookUp" />
            <Kbd bind="lookLeft" />
            <Kbd bind="lookDown" />
            <Kbd bind="lookRight" /> look around
            <Kbd bind="settings" /> settings
            <Kbd bind="mute" /> {media.micMuted ? "unmute" : "mute"}
            <Kbd bind="camera" /> camera
          </div>
        </div>

        <div className="hud__group">
          {/* Mute and camera stay out here as well as in the menu: they are
              the two things someone reaches for mid-sentence. */}
          <button className="btn" onClick={() => void media.toggleMic()}>
            {media.micMuted ? "Unmute" : "Mute"} <Kbd bind="mute" />
          </button>
          <button className="btn" onClick={() => void media.toggleCamera()}>
            {media.cameraOff ? "Camera on" : "Camera off"} <Kbd bind="camera" />
          </button>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            Settings <Kbd bind="settings" />
          </button>
        </div>
      </header>

      {/* The table stays up while the socket is down, because the seat, the
          stack and the cards are all still held on the server. What changes is
          that nothing on screen is being updated any more, and saying so is
          better than letting a frozen table read as a live one. */}
      {reconnecting && (
        <div className="banner banner--error hud__banner" role="status">
          Connection lost. Holding your seat and reconnecting…
        </div>
      )}

      {media.audioBlocked && !settingsOpen && !reconnecting && (
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

      {/* The left column, read top to bottom: who is winning and what it
          cost them, then the pot and your own hand. It sits on the left rather
          than the middle because the middle is where the faces are, and it is
          one column rather than two panels because the standings answer every
          question the old seat list did, with the buy-in numbers that give
          them meaning. */}
      <div className="hud hud--table">
        <Leaderboard
          snapshot={snapshot}
          sessionId={sessionId}
          me={me}
          onBuyIn={onBuyIn}
        />
        <HandHud snapshot={snapshot} me={me} />
      </div>

      {/* The push, while it is happening. The chips in front of your seat are
          already showing the amount; this says what letting go will do, which
          is the one thing a pile of chips cannot say for itself. */}
      {push.active && push.rung && (
        <div
          className={`push${push.armed ? " push--armed" : ""}`}
          role="status"
          aria-live="polite"
        >
          <b>{push.rung.label}</b>
          <span>
            {push.armed ? "Let go to commit" : "Keep pushing towards the pot"}
          </span>
        </div>
      )}

      {/* Bottom centre, stacked: the peek hint sits directly over the two
          cards on the felt in front of this seat, and the decision on the
          clock sits under it where a player's eyes already are. */}
      <footer className="hud hud--bottom">
        <PeekHint hasCards={!!me && me.cardCount > 0} peeking={peeking} />
        {gate.show ? (
          <PlayGate
            gate={gate}
            snapshot={snapshot}
            me={me}
            onReady={onReady}
          />
        ) : (
          <ActionBar
            snapshot={snapshot}
            me={me}
            rejection={rejection}
            // The menu owns the keyboard while it is open, so a stray F does
            // not fold the hand behind it.
            enabled={!settingsOpen}
            onAct={onAct}
          />
        )}
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
          audio={audio}
          sensitivity={sensitivity}
          sittingOut={me?.sittingOut ?? false}
          onSitOutChange={onSitOutChange}
          onSensitivityChange={setSensitivity}
          onClose={() => setSettingsOpen(false)}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}
