import { useEffect, useState } from "react";
import {
  PokerAction,
  TablePhase,
  type PokerActionType,
} from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { Kbd } from "./Kbd.js";
import { useKeybinds } from "./useKeybinds.js";

/**
 * Fold / Check / Call / Raise, on the keyboard first.
 *
 * The mouse drives the camera, so reaching for a button costs you your
 * eye-line on the way there. Every action here has a key, the key is printed
 * on the button, and the buttons remain because spec section 8 wants a visible
 * fallback - but the keyboard is the intended path, not the accessible
 * alternative.
 *
 * Every button is enabled or disabled by a flag the server sent, and so is
 * every shortcut: a key with no handler does nothing rather than firing an
 * action the server would refuse. This component does not know the min-raise
 * rule, does not know that an all-in for less caps what you owe, and does not
 * know whether betting was reopened. It asks, and it renders the answer.
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
  const [raiseTo, setRaiseTo] = useState(snapshot.minRaiseTo);

  // Reset whenever the decision in front of the player changes, so a stale
  // amount from the previous street is never one keypress from being sent.
  useEffect(() => {
    setRaiseTo(snapshot.minRaiseTo);
  }, [snapshot.minRaiseTo, snapshot.actingSeat, snapshot.handNumber]);

  const canAct = myTurn && enabled;
  // Sizing steps in big blinds, which is how the amount is actually thought
  // about, rather than in single chips which would take fifty presses.
  const step = Math.max(1, snapshot.bigBlind);
  const clampRaise = (value: number) =>
    Math.min(snapshot.maxRaiseTo, Math.max(snapshot.minRaiseTo, value));

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
      raise:
        canAct && snapshot.canRaise
          ? () => onAct(turn, PokerAction.Raise, raiseTo)
          : undefined,
      allIn:
        canAct && snapshot.canRaise
          ? () => onAct(turn, PokerAction.Raise, snapshot.maxRaiseTo)
          : undefined,
      raiseDown:
        canAct && snapshot.canRaise
          ? () => setRaiseTo((value) => clampRaise(value - step))
          : undefined,
      raiseUp:
        canAct && snapshot.canRaise
          ? () => setRaiseTo((value) => clampRaise(value + step))
          : undefined,
      raiseMin:
        canAct && snapshot.canRaise
          ? () => setRaiseTo(snapshot.minRaiseTo)
          : undefined,
      raiseMax:
        canAct && snapshot.canRaise
          ? () => setRaiseTo(snapshot.maxRaiseTo)
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
        <span className="hud__meta">
          {snapshot.phase === TablePhase.Waiting
            ? "Waiting for players"
            : snapshot.phase === TablePhase.Payout
              ? snapshot.lastResult || "Hand over"
              : waitingFor
                ? `${waitingFor.displayName} to act`
                : "Dealing"}
        </span>
        {/* Waiting for someone else is exactly when there is time to read
            these, and when the turn does arrive the same chips are already on
            the buttons. Dim, because none of them do anything yet. */}
        <span className="actions__sizing">
          <Kbd bind="fold" />
          <span>fold</span>
          <Kbd bind="checkCall" />
          <span>check / call</span>
          <Kbd bind="raise" />
          <span>raise</span>
        </span>
      </div>
    );
  }

  const canSlide = snapshot.maxRaiseTo > snapshot.minRaiseTo;
  const isAllIn = raiseTo >= snapshot.maxRaiseTo;
  // "Bet" when nobody has put anything in this round, "Raise" when they have.
  const raiseVerb = snapshot.currentBet === 0 ? "Bet" : "Raise to";

  return (
    <div className="actions">
      <button className="btn" onClick={() => onAct(turn, PokerAction.Fold)}>
        Fold <Kbd bind="fold" />
      </button>

      {snapshot.canCheck ? (
        <button className="btn" onClick={() => onAct(turn, PokerAction.Check)}>
          Check <Kbd bind="checkCall" />
        </button>
      ) : (
        <button className="btn" onClick={() => onAct(turn, PokerAction.Call)}>
          Call {snapshot.callAmount} <Kbd bind="checkCall" />
        </button>
      )}

      {snapshot.canRaise && (
        <span className="actions__raise">
          {canSlide && (
            <input
              className="actions__slider"
              type="range"
              min={snapshot.minRaiseTo}
              max={snapshot.maxRaiseTo}
              step={1}
              value={raiseTo}
              aria-label="raise to"
              onChange={(event) => setRaiseTo(Number(event.target.value))}
            />
          )}
          <button
            className="btn btn--primary"
            onClick={() => onAct(turn, PokerAction.Raise, raiseTo)}
          >
            {isAllIn ? `All in ${snapshot.maxRaiseTo}` : `${raiseVerb} ${raiseTo}`}{" "}
            <Kbd bind="raise" />
          </button>
          {canSlide && (
            <span className="actions__sizing">
              <Kbd bind="raiseDown" />
              <Kbd bind="raiseUp" />
              <span>size</span>
              <Kbd bind="allIn" />
              <span>all in</span>
            </span>
          )}
        </span>
      )}

      {rejection && <span className="note note--error">{rejection}</span>}
    </div>
  );
}
