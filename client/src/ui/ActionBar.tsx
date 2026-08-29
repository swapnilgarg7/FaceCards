import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  PokerAction,
  TablePhase,
  type PokerActionType,
} from "@facecards/shared";
import { CHIP_COLOURS } from "../scene/chips.js";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import {
  chipFace,
  potRaiseTo,
  sizingPresets,
  snapChips,
  trayChips,
  withChip,
} from "./betSizing.js";
import {
  clampChips,
  formatChips,
  parseChipAmount,
  raiseProblemText,
} from "./chipAmount.js";
import { Kbd } from "./Kbd.js";
import type { KeybindId } from "./keybinds.js";
import { TurnClock } from "./TurnClock.js";
import { useKeybinds } from "./useKeybinds.js";
import { useView } from "./useViewport.js";

/**
 * Fold / Check / Call / Raise, on the keyboard first.
 *
 * The mouse drives the camera, so reaching for a button costs you your
 * eye-line on the way there. Every action here has a key, the key is printed
 * on the button *at the size of the button*, and the buttons remain because
 * spec section 8 wants a visible fallback - but the keyboard is the intended
 * path, not the accessible alternative. A shortcut printed in 8px beside a
 * word is a shortcut nobody learns, so the chips here are as loud as the
 * labels they belong to.
 *
 * Every button is enabled or disabled by a flag the server sent, and so is
 * every shortcut: a key with no handler does nothing rather than firing an
 * action the server would refuse. This component does not know the min-raise
 * rule, does not know that an all-in for less caps what you owe, and does not
 * know whether betting was reopened. It asks, and it renders the answer.
 *
 * Sizing a raise is the one thing here that is not a single button, and it is
 * built the way every poker client people enjoy sizing bets in builds it:
 * **one press for the size you meant.** A pot-sized bet is a key or a pill,
 * not thirty presses of an arrow; an exact number is typed, from the keyboard,
 * without reaching for the mouse and swinging the camera on the way; and a
 * number nobody has a name for is counted out in chips, the same four colours
 * that are stacked on the felt, which is the only one of the three that works
 * with a thumb. The slider and the arrow keys remain for nudging a size that
 * is nearly right. `betSizing.ts` decides what those sizes are.
 *
 * All of them write the same draft and run through the same bounds - see
 * `chipAmount.ts` - so an amount the server would bounce is refused here, with
 * the reason, before it is ever sent.
 */
/**
 * Which preset each shortcut sizes, for the chip printed on the pill.
 *
 * Read from the pill rather than pushed onto it, so a size that has no key -
 * three-quarter pot - simply prints nothing instead of a key that is not
 * wired to anything.
 */
const PRESET_KEYS: Record<string, KeybindId | undefined> = {
  min: "raiseMin",
  half: "raiseHalfPot",
  pot: "raisePot",
  allIn: "raiseMax",
};

export function ActionBar({
  snapshot,
  me,
  rejection,
  enabled,
  onAct,
}: {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  rejection: string | null;
  /** False while an overlay owns the keyboard. */
  enabled: boolean;
  onAct(turn: number, type: PokerActionType, amount?: number): void;
}) {
  const view = useView();
  const myTurn = !!me && snapshot.actingSeat === me.seat;
  // Every intent answers the decision that was on screen when it was chosen.
  const turn = snapshot.turn;
  const bounds = { min: snapshot.minRaiseTo, max: snapshot.maxRaiseTo };

  // The raise amount is held as *text*, not as a number, because a field you
  // can type in is a field you can empty, and a number has nowhere to put
  // "the player is halfway through typing 1200".
  const [draft, setDraft] = useState(() => String(snapshot.minRaiseTo));
  // Focused by its shortcut, so typing "460" never costs an eye-line.
  const amount = useRef<HTMLInputElement>(null);
  const setAmount = (value: number) => setDraft(String(value));

  // Reset whenever the decision in front of the player changes, so a stale
  // amount from the previous street is never one keypress from being sent.
  useEffect(() => {
    setDraft(String(snapshot.minRaiseTo));
  }, [snapshot.minRaiseTo, snapshot.actingSeat, snapshot.handNumber]);

  const canAct = myTurn && enabled;
  const parsed = parseChipAmount(draft, bounds);
  // What a key or a click would send. The slider still has to sit somewhere
  // while the field holds something illegal, so it follows the clamped value.
  const raiseTo = parsed.value === null ? bounds.min : parsed.value;
  const sliderAt = clampChips(raiseTo, bounds);
  const raiseReady = parsed.problem === null;
  // What a chip tap adds to. The *typed* value, not the clamped one: a player
  // counting out five hundreds passes through 100 on the way, and lifting that
  // first tap to the minimum would make the count come out wrong.
  const composed = parsed.value ?? 0;

  // Sizes, and the chips to build one out of. Both are derived from what the
  // server published, so neither can aim at something it would refuse.
  const presets = sizingPresets(snapshot);
  const tray = trayChips(bounds.max);

  // Sizing steps in big blinds, which is how the amount is actually thought
  // about, rather than in single chips which would take fifty presses.
  const step = Math.max(1, snapshot.bigBlind);
  const nudge = (delta: number) =>
    setDraft(String(clampChips(sliderAt + delta, bounds)));

  useKeybinds(
    {
      fold: canAct ? () => onAct(turn, PokerAction.Fold) : undefined,
      checkCall: canAct
        ? () =>
            onAct(
              turn,
              snapshot.canCheck ? PokerAction.Check : PokerAction.Call,
            )
        : undefined,
      // A raise the field has already refused is not sent. The key does
      // nothing at all, exactly as it does when raising is not legal.
      raise:
        canAct && snapshot.canRaise && raiseReady
          ? () => onAct(turn, PokerAction.Raise, raiseTo)
          : undefined,
      allIn:
        canAct && snapshot.canRaise
          ? () => onAct(turn, PokerAction.Raise, bounds.max)
          : undefined,
      raiseDown: canAct && snapshot.canRaise ? () => nudge(-step) : undefined,
      raiseUp: canAct && snapshot.canRaise ? () => nudge(step) : undefined,
      raiseMin:
        canAct && snapshot.canRaise ? () => setAmount(bounds.min) : undefined,
      raiseMax:
        canAct && snapshot.canRaise ? () => setAmount(bounds.max) : undefined,
      raisePot:
        canAct && snapshot.canRaise
          ? () => setAmount(potRaiseTo(snapshot, 1))
          : undefined,
      raiseHalfPot:
        canAct && snapshot.canRaise
          ? () => setAmount(potRaiseTo(snapshot, 0.5))
          : undefined,
      // The key is claimed by `useKeybinds` before the browser sees it, so the
      // letter that opened the field does not also land in it.
      raiseType:
        canAct && snapshot.canRaise ? () => amount.current?.focus() : undefined,
    },
    enabled,
  );

  if (!me) return null;

  if (!myTurn) {
    const waitingFor = snapshot.players.find(
      (p) => p.seat === snapshot.actingSeat,
    );
    return (
      <div className="actions actions--idle">
        {/* Someone else is on the clock. Ambient rather than urgent, but on
            screen, because "are they still there" is the question the whole
            table is silently asking - and it is the answer to why the hand is
            about to move on without them. */}
        <TurnClock
          turn={snapshot.turn}
          actingMs={snapshot.actingMs}
          mine={false}
          label={`Time left for ${waitingFor?.displayName ?? "the acting player"}`}
        />
        <span className="hud__meta">
          {snapshot.phase === TablePhase.Waiting
            ? "Waiting for players"
            : snapshot.phase === TablePhase.Payout
              ? snapshot.lastResult || "Hand over"
              : waitingFor
                ? `${waitingFor.displayName} to act${waitingFor.connected ? "" : " (reconnecting)"}`
                : "Dealing"}
        </span>
        {/* Waiting for someone else is exactly when there is time to learn
            these, so they are laid out as the three buttons they are about to
            become rather than as a footnote. Dim, because none of them do
            anything yet.

            It is only ever a rehearsal of the keyboard, so on a touchscreen
            it is three words with nothing to learn from them - and the space
            it costs is space the room could be using. */}
        {!view.touch && (
          <div className="actions__legend">
            <span className="legend__item">
              <Kbd bind="fold" /> Fold
            </span>
            <span className="legend__item">
              <Kbd bind="checkCall" /> Check / Call
            </span>
            <span className="legend__item">
              <Kbd bind="raise" /> Raise
            </span>
          </div>
        )}
      </div>
    );
  }

  const canSlide = bounds.max > bounds.min;
  const isAllIn = raiseReady && raiseTo >= bounds.max;
  // "Bet" when nobody has put anything in this round, "Raise to" when they
  // have.
  const raiseVerb = snapshot.currentBet === 0 ? "Bet" : "Raise to";
  // The size of the raise being answered, which is the number that explains
  // why the minimum is what it is. Zero when nothing was raised.
  const lastRaise = Math.max(0, bounds.min - snapshot.currentBet);

  return (
    <div className="actions actions--live">
      {/* Your clock. The server checks for you when checking is free and folds
          you when it is not, so this is a countdown to a decision being made
          rather than to being knocked out. */}
      <TurnClock
        turn={snapshot.turn}
        actingMs={snapshot.actingMs}
        mine
        label="Your time to act"
      />

      {snapshot.canRaise && (
        <div className="sizer">
          <label className="sizer__field">
            <span className="sizer__verb">{raiseVerb}</span>
            <input
              ref={amount}
              className={`sizer__amount${raiseReady ? "" : " sizer__amount--bad"}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              aria-label={`${raiseVerb} amount in chips`}
              aria-invalid={!raiseReady}
              onChange={(event) => setDraft(event.target.value)}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                // Enter commits, which is what a field with a bet in it is
                // expected to do. Escape hands the keyboard back to the table
                // rather than leaving F and C swallowed by the field.
                if (event.key === "Enter" && raiseReady) {
                  event.preventDefault();
                  onAct(turn, PokerAction.Raise, raiseTo);
                } else if (event.key === "Escape") {
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="sizer__bounds">of {formatChips(bounds.max)}</span>
          </label>

          {canSlide && (
            <input
              className="sizer__slider"
              type="range"
              min={bounds.min}
              max={bounds.max}
              step={1}
              value={sliderAt}
              aria-label="raise to"
              // Snapped to a whole big blind on the way in, so the drag stops
              // where a bet gets announced rather than on 1,337 - and so one
              // pixel of drag and one press of an arrow key mean the same
              // size. Both ends of the range stay reachable; see `snapChips`.
              onChange={(event) =>
                setAmount(snapChips(Number(event.target.value), snapshot))
              }
            />
          )}

          {!view.touch && (
            <span className="sizer__nudge">
              {canSlide && (
                <>
                  <Kbd bind="raiseDown" />
                  <Kbd bind="raiseUp" />
                  <span>by {formatChips(step)}</span>
                </>
              )}
              <Kbd bind="raiseType" />
              <span>to type</span>
            </span>
          )}

          {/* The two ways of picking a size that are not a number, on one row,
              because they are one question - "how much" - answered in
              whichever way the player already happens to think. */}
          <div className="sizer__sizes">
            {/* The sizes a player says out loud. This is the row that has to be
              right: "half pot" is the thought, and 137 is only ever the answer
              to it, so the thought gets the button and the arithmetic is done
              here. A pill that would send the same amount as its neighbour is
              not drawn - see `sizingPresets`. */}
            {presets.length > 0 && (
              <div className="sizer__presets">
                {presets.map((preset) => {
                  const chosen = raiseReady && preset.amount === raiseTo;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset${chosen ? " preset--on" : ""}`}
                      aria-pressed={chosen}
                      onClick={() => setAmount(preset.amount)}
                    >
                      <span className="preset__label">
                        {preset.label}
                        {PRESET_KEYS[preset.id] && (
                          <Kbd bind={PRESET_KEYS[preset.id]!} />
                        )}
                      </span>
                      <span className="preset__amount">
                        {formatChips(preset.amount)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* And the amount nobody has a name for, counted out rather than
              computed: tap the hundred five times and the bet is 500. It is
              the same denominations and the same colours that are stacked on
              the felt, because a tray whose chips are not the table's chips is
              a second currency to learn - and on a phone it is the only one of
              the three ways in that a thumb can drive. */}
            {tray.length > 0 && (
              <div className="sizer__tray">
                {tray.map((denom) => (
                  <button
                    key={denom}
                    type="button"
                    className="chipbtn"
                    style={{ "--chip": CHIP_COLOURS[denom] } as CSSProperties}
                    aria-label={`Add ${formatChips(denom)} to the amount`}
                    onClick={() =>
                      setAmount(withChip(composed, denom, bounds.max))
                    }
                  >
                    {chipFace(denom)}
                  </button>
                ))}
                {/* Back to nothing, not back to the minimum: counting out five
                  hundreds only comes to 500 if the count starts at zero. */}
                <button
                  type="button"
                  className="btn btn--ghost btn--clear"
                  onClick={() => setAmount(0)}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* The rule, said while it is still being broken rather than after
              the server has bounced the intent. An unfinished amount - empty,
              or zeroed to count chips out from scratch - is not an error yet,
              only a bet that is not there, so it is said quietly. */}
          {!raiseReady && (
            <p
              className={`note sizer__why${composed === 0 ? "" : " note--error"}`}
            >
              {raiseProblemText(parsed.problem!, bounds, lastRaise)}
            </p>
          )}
        </div>
      )}

      <div className="actions__buttons">
        <button
          className="btn btn--act btn--fold"
          onClick={() => onAct(turn, PokerAction.Fold)}
        >
          <Kbd bind="fold" />
          <span className="btn__label">Fold</span>
        </button>

        {snapshot.canCheck ? (
          <button
            className="btn btn--act btn--call"
            onClick={() => onAct(turn, PokerAction.Check)}
          >
            <Kbd bind="checkCall" />
            <span className="btn__label">Check</span>
          </button>
        ) : (
          <button
            className="btn btn--act btn--call"
            onClick={() => onAct(turn, PokerAction.Call)}
          >
            <Kbd bind="checkCall" />
            <span className="btn__label">
              Call <b>{formatChips(snapshot.callAmount)}</b>
            </span>
          </button>
        )}

        {snapshot.canRaise && (
          <button
            className="btn btn--act btn--raise"
            disabled={!raiseReady}
            onClick={() => onAct(turn, PokerAction.Raise, raiseTo)}
          >
            <Kbd bind="raise" />
            <span className="btn__label">
              {isAllIn ? "All in" : raiseVerb} <b>{formatChips(raiseTo)}</b>
            </span>
          </button>
        )}
      </div>

      {rejection && <span className="note note--error">{rejection}</span>}
    </div>
  );
}
