import { useCallback, useEffect, useState } from "react";
import {
  MAX_PLAYERS,
  TablePhase,
  type PokerActionType,
} from "@facecards/shared";
import { useTableAudio } from "../audio/useTableAudio.js";
import { useFaceTracking } from "../avatars/useFaceTracking.js";
import type { UseMedia } from "../media/useMedia.js";
import { NightInReview } from "../moments/NightInReview.js";
import { PokerMoment } from "../moments/PokerMoment.js";
import { useMoments } from "../moments/useMoments.js";
import type { RoomSnapshot } from "../net/useRoom.js";
import { Room3D } from "../scene/Room3D.js";
import { useQuality } from "../scene/useQuality.js";
import { MediaFaultBanner } from "./MediaFaultBanner.js";
import { useTabLock } from "../net/useTabLock.js";
import { ActionBar } from "./ActionBar.js";
import { FaceDebug } from "./FaceDebug.js";
import { HandHud } from "./HandHud.js";
import { Kbd } from "./Kbd.js";
import {
  Leaderboard,
  loadStandingsOpen,
  saveStandingsOpen,
} from "./Leaderboard.js";
import { PeekHint } from "./PeekHint.js";
import { SettingsPanel, loadSensitivity } from "./SettingsPanel.js";
import { ShowdownOverlay } from "./ShowdownOverlay.js";
import { waitingOn } from "./showdown.js";
import { PlayGate } from "./PlayGate.js";
import { startGate } from "./startGate.js";
import { VideoTile } from "./VideoTile.js";
import { useChipPush } from "./useChipPush.js";
import { useHoldKeybind, useKeybinds } from "./useKeybinds.js";
import { useLookKeys } from "./useLookKeys.js";
import { useView } from "./useViewport.js";

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
 *
 * **On a phone that sentence is false, and the HUD is rebuilt around it being
 * false.** There is no keyboard to be the intended path and no hover to drive
 * the camera, so the buttons stop being a fallback and become the whole
 * interface - which means everything that existed only to teach the keyboard
 * has to go, or the one screen small enough to need the space is the one
 * carrying the most furniture. What comes off, in order of how much room it
 * buys back: the standings column (a sheet you open, because the buy-in
 * control lives in it and a busted player still has to reach it), the key
 * chips on every control, the peek hint and the press-and-hold gesture it
 * describes, the chip push, and the always-live shortcut strip. What is left
 * is a room, your own two cards, and three buttons the size of a thumb.
 */
export function Table({
  snapshot,
  sessionId,
  media,
  rejection,
  reconnecting,
  onAct,
  onReady,
  onNextHand,
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
  /** "I have seen the showdown." The server deals when every seat has. */
  onNextHand(): void;
  onSitOutChange(sittingOut: boolean): void;
  /** Ask for more chips behind this seat. The server decides how many, and when. */
  onBuyIn(amount: number): void;
  onLeave(): void;
}) {
  const view = useView();
  const me = snapshot.players.find((p) => p.sessionId === sessionId);
  // Whether the evening has begun. Until it has, the bottom of the screen
  // belongs to Play rather than to Fold/Check/Raise.
  const gate = startGate(snapshot, me);
  const shareUrl = `${window.location.origin}/?room=${snapshot.code}`;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState(loadSensitivity);
  const [peeking, setPeeking] = useState(false);
  // Whether the standings are up. Remembered across sessions, like the look
  // sensitivity: it is a preference about how much HUD somebody wants over
  // the room, not a thing about this hand.
  const [standingsOpen, setStandingsOpen] = useState(loadStandingsOpen);
  const changeStandings = useCallback(
    (open: boolean) => {
      setStandingsOpen(open);
      // Only a column has a state worth remembering. Compact turns this into a
      // sheet over the whole room, and "it was up when I closed the app" is
      // not a preference anybody expressed about that - it would just be a
      // table hidden behind a panel on arrival. It is also not allowed to
      // overwrite what a player chose on their laptop.
      if (!view.compact) saveStandingsOpen(open);
    },
    [view.compact],
  );

  // Put the sheet away the moment there is no room for a column, which covers
  // both arriving on a phone with the preference set and dragging a desktop
  // window narrow mid-hand.
  useEffect(() => {
    if (view.compact) setStandingsOpen(false);
  }, [view.compact]);

  // Whether the night's recap is up. Not a moment: it is a thing somebody
  // opens on purpose, from the menu, usually while the table is arguing about
  // the hand before.
  const [reviewOpen, setReviewOpen] = useState(false);

  // Poker Moments. Nothing about the table reads this, and that is deliberate:
  // if the whole hook threw on every call the hand would play out unchanged.
  const moments = useMoments(media, sessionId);
  // Depends on `moments.capture` rather than on `moments`, which is a fresh
  // object every render: the showdown overlay lists this callback as an effect
  // dependency, so a new identity per render would re-run that effect on every
  // patch of a payout. `capture` is idempotent per hand either way; this keeps
  // it from being called forty times to find that out.
  const onRevealed = useCallback(
    () => moments.capture(snapshot),
    [moments.capture, snapshot],
  );

  // The card comes down when the table moves on, and only then. It holds the
  // screen for as long as the conversation about the hand lasts, which is the
  // same rule the payout underneath it follows and the reason the server waits
  // for every seat before dealing.
  //
  // This is also the card's backstop. `PAYOUT_MAX_MS` deals the next hand for
  // a table that walked away from its laptops, and when it does the phase
  // leaves the payout and this clears - so there is no sequence of events that
  // leaves a photograph over a live hand.
  const decided = snapshot.phase === TablePhase.Payout;
  useEffect(() => {
    if (!decided) moments.dismiss();
  }, [decided, moments.dismiss]);

  // The table's own sound, derived from the difference between one snapshot
  // and the next. See `audio/cues.ts`: there is no event stream, only state
  // and state that changed.
  const audio = useTableAudio(snapshot);

  // How much this machine is asked to draw: what the player chose, and what
  // the frame clock has since decided. See `scene/quality.ts`.
  const quality = useQuality(view.handheld);

  // Whether this table is already open in another tab of this browser. Not a
  // server question - two tabs are two honest sessions - but the loudest
  // failure in the product, because both of them publish the same microphone.
  // See `net/tabLock.ts`.
  const duplicateTab = useTabLock(snapshot.code);

  // Pushing chips towards the pot. Every value it can land on is one the
  // server published as legal, so a gesture cannot aim at an illegal action;
  // the intent goes down the same `act()` path the buttons use.
  const push = useChipPush({
    snapshot,
    me,
    // Off on a touchscreen. The push is a press and a drag on the felt, which
    // is the same finger movement that turns the head, and a gesture that
    // might mean either is a gesture that will one day call a bet when
    // somebody meant to look at the player opposite. The action bar sizes a
    // raise perfectly well and cannot be misread.
    enabled: !settingsOpen && !view.touch,
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
    standings: () => changeStandings(!standingsOpen),
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
          canPushChips={!settingsOpen && !view.touch && push.rungCount > 0}
          onChipGrab={push.begin}
          // A finger has no position until it is down, so it cannot point at
          // anything. Drag to turn instead. See `scene/mobileView.ts`.
          lookMode={view.touch ? "drag" : "hover"}
          quality={quality.profile}
          onFrame={quality.sample}
        />
      </div>

      <header className="hud hud--top">
        <div className="hud__group hud__group--stacked">
          <div className="hud__group">
            <span className="hud__code">{snapshot.code}</span>
            {/* Who is here and whether the media is up. Off on a small
                screen: the standings sheet answers the first properly and the
                reconnect banner answers the second louder, and neither is
                worth the width next to a room code that has to stay readable
                enough to say out loud. */}
            {!view.compact && (
              <span className="hud__meta">
                {snapshot.players.length}/{MAX_PLAYERS} seated · {media.state}
              </span>
            )}
          </div>
          {/* The keys that are always live and belong to the room rather than
              to a decision. The ones that depend on whose turn it is are
              printed on the action buttons instead, where they mean
              something, and the peek lives over the cards it lifts.

              Off on a touchscreen because there is no keyboard, and off on a
              narrow window because there is no line: eight chips and five
              labels is a strip wider than a phone, and what it does at that
              width is run under the self-view. */}
          {!view.compact && !view.touch && (
            <div className="hud__keys">
              <Kbd bind="lookUp" />
              <Kbd bind="lookLeft" />
              <Kbd bind="lookDown" />
              <Kbd bind="lookRight" /> look around
              <Kbd bind="standings" /> standings
              <Kbd bind="settings" /> settings
              <Kbd bind="mute" /> {media.micMuted ? "unmute" : "mute"}
              <Kbd bind="camera" /> camera
            </div>
          )}
        </div>

        <div className="hud__group hud__group--controls">
          {/* Mute and camera stay out here as well as in the menu: they are
              the two things someone reaches for mid-sentence. The labels
              shorten rather than turning into icons - a row of unlabelled
              glyphs is a quiz, and "Mic off" is three characters wider than a
              crossed-out microphone and infinitely less ambiguous. */}
          <button
            className="btn"
            onClick={() => void media.toggleMic()}
            aria-label={media.micMuted ? "Unmute" : "Mute"}
          >
            {view.compact
              ? media.micMuted
                ? "Mic off"
                : "Mic"
              : media.micMuted
                ? "Unmute"
                : "Mute"}{" "}
            <Kbd bind="mute" />
          </button>
          <button
            className="btn"
            onClick={() => void media.toggleCamera()}
            aria-label={media.cameraOff ? "Turn camera on" : "Turn camera off"}
          >
            {view.compact
              ? media.cameraOff
                ? "Cam off"
                : "Cam"
              : media.cameraOff
                ? "Camera on"
                : "Camera off"}{" "}
            <Kbd bind="camera" />
          </button>
          {/* The way back to the standings once the column has become a
              sheet. On a wide screen the column is simply there, and its own
              peg is the way back, so this would be a second answer to a
              question that already has one. */}
          {view.compact && (
            <button
              className="btn"
              onClick={() => changeStandings(!standingsOpen)}
              aria-expanded={standingsOpen}
            >
              Chips
            </button>
          )}
          <button
            className="btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            {view.compact ? "Menu" : "Settings"} <Kbd bind="settings" />
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

      {/* Two tabs of one browser at one table. The server is not wrong - they
          are two sessions with two seats - but they are also two publications
          of the same microphone half a second apart, which is the loudest and
          least diagnosable failure this product has. Advisory on purpose:
          nothing is closed automatically, because a stale claim from a tab
          that crashed must never lock somebody out of their own table. */}
      {duplicateTab && !settingsOpen && (
        <div className="banner banner--error hud__banner" role="alert">
          This table is already open in another tab. Close one, or you will
          hear yourself twice.
        </div>
      )}

      {media.audioBlocked && !settingsOpen && !reconnecting && (
        <button
          className="banner hud__banner"
          onClick={() => void media.startAudio()}
        >
          {view.touch ? "Tap to enable sound" : "Click to enable sound"}
        </button>
      )}

      {/* The player's own camera or microphone, and the way back. Under the
          reconnect banner in priority because a socket that is down means
          nothing is being updated at all, and above everything else because a
          person who cannot be seen or heard is not at the table in the sense
          this product means. */}
      {!settingsOpen && !reconnecting && (
        <MediaFaultBanner media={media} className="hud__banner" />
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

      {/* The left column: who is winning and what it cost them. It sits on
          the left rather than the middle because the middle is where the
          faces are, and it is one panel rather than two because the standings
          answer every question the old seat list did, with the buy-in numbers
          that give them meaning.

          The pot and your own hand used to live under it and no longer do.
          The pot is projected over the middle of the table with the board
          (see `scene/holo.ts`), which is where a pot is, and the flat readout
          of your own two cards has moved down to the footer - directly over
          the cards it is a fallback for, rather than in the far corner of the
          screen from them. */}
      {/* On a small screen this stops being a column and becomes a sheet you
          open over the room, from the Chips button in the top bar. It is not
          simply dropped, and the reason is the buy-in control at the bottom of
          it: a player who has just lost their last chip has exactly one thing
          left to do, and no other surface in the product does it. Closed, it
          renders nothing at all rather than leaving its peg over the felt,
          because at this size the peg is a hole in the table. */}
      {(!view.compact || standingsOpen) && (
        <div
          className={`hud hud--table${standingsOpen ? "" : " hud--table-away"}`}
        >
          <Leaderboard
            snapshot={snapshot}
            sessionId={sessionId}
            me={me}
            open={standingsOpen}
            onOpenChange={changeStandings}
            onBuyIn={onBuyIn}
          />
        </div>
      )}

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
        <HandHud snapshot={snapshot} me={me} />
        {/* The hint, and the gesture it describes, are both gone on a
            touchscreen: there is no key to hold and the press it would take
            instead is the one that turns your head. The two cards in the
            readout above are already face up, which on a phone is the whole
            of "look at your hand". */}
        {!view.touch && (
          <PeekHint hasCards={!!me && me.cardCount > 0} peeking={peeking} />
        )}
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

      {/* The end of a hand, played out rather than announced: the run-out
          turns over a card at a time, then every hand that had to show, then
          the winner - and it stays up until the table asks for the next one.
          See `ShowdownOverlay.tsx`. */}
      <ShowdownOverlay
        snapshot={snapshot}
        me={me}
        onNextHand={onNextHand}
        onBuyIn={onBuyIn}
        onRevealed={onRevealed}
        suspended={!!moments.current}
      />

      {/* The photograph, over the showdown that produced it. It dismisses
          itself; see `PokerMoment.tsx` for why it is never allowed to be the
          thing standing between a table and the next hand. */}
      {moments.current && (
        <PokerMoment
          moment={moments.current}
          onNextHand={onNextHand}
          asked={me?.readyNext ?? false}
          waiting={waitingOn(snapshot)}
          onDismiss={moments.dismiss}
        />
      )}

      {reviewOpen && (
        <NightInReview reel={moments.reel} onClose={() => setReviewOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsPanel
          roomCode={snapshot.code}
          shareUrl={shareUrl}
          media={media}
          audio={audio}
          sensitivity={sensitivity}
          quality={quality}
          sittingOut={me?.sittingOut ?? false}
          momentsEnabled={moments.enabled}
          momentCount={moments.reel.length}
          onMomentsChange={moments.setEnabled}
          onOpenReview={() => {
            setSettingsOpen(false);
            setReviewOpen(true);
          }}
          onSitOutChange={onSitOutChange}
          onSensitivityChange={setSensitivity}
          onClose={() => setSettingsOpen(false)}
          onLeave={onLeave}
        />
      )}
    </main>
  );
}
