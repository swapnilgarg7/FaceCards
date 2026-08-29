import { useEffect, useState } from "react";
import {
  PokerAction,
  TablePhase,
  type PokerActionType,
} from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import {
  clampChips,
  formatChips,
  parseChipAmount,
  raiseProblemText,
} from "./chipAmount.js";
import { Kbd } from "./Kbd.js";
import { TurnClock } from "./TurnClock.js";
import { useKeybinds } from "./useKeybinds.js";

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
 * The raise size can be dragged on the slider, stepped with the arrow keys or
 * simply typed, because the first two cannot reach "make it exactly 460" and
 * the third is how somebody who plays poker thinks about a bet. All three run
 * through the same bounds - see `chipAmount.ts` - so a typed amount the server
 * would bounce is refused here, with the reason, before it is ever sent.
 */
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
  const myTurn = !!me && snapshot.actingSeat === me.seat;
  // Every intent answers the decision that was on screen when it was chosen.
  const turn = snapshot.turn;
  const bounds = { min: snapshot.minRaiseTo, max: snapshot.maxRaiseTo };

  // The raise amount is held as *text*, not as a number, because a field you
  // can type in is a field you can empty, and a number has nowhere to put
  // "the player is halfway through typing 1200".
  const [draft, setDraft] = useState(() => String(snapshot.minRaiseTo));

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
        canAct && snapshot.canRaise
          ? () => setDraft(String(bounds.min))
          : undefined,
      raiseMax:
        canAct && snapshot.canRaise
          ? () => setDraft(String(bounds.max))
          : undefined,
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
            anything yet. */}
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
              onChange={(event) => setDraft(event.target.value)}
            />
          )}

          <div className="sizer__quick">
            <button
              className="btn btn--ghost btn--quick"
              onClick={() => setDraft(String(bounds.min))}
            >
              Min {formatChips(bounds.min)} <Kbd bind="raiseMin" />
            </button>
            <button
              className="btn btn--ghost btn--quick"
              onClick={() => setDraft(String(bounds.max))}
            >
              All in {formatChips(bounds.max)} <Kbd bind="allIn" />
            </button>
            {canSlide && (
              <span className="sizer__nudge">
                <Kbd bind="raiseDown" />
                <Kbd bind="raiseUp" />
                <span>by {formatChips(step)}</span>
              </span>
            )}
          </div>

          {/* The rule, said while it is still being broken rather than after
              the server has bounced the intent. */}
          {!raiseReady && (
            <p className="note note--error sizer__why">
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
