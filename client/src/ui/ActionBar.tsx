import { useEffect, useState } from "react";
import {
  PokerAction,
  TablePhase,
  type PokerActionType,
} from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";

/**
 * Fold / Check / Call / Raise.
 *
 * Every button here is enabled or disabled by a flag the server sent. This
 * component does not know the min-raise rule, does not know that an all-in
 * for less caps what you owe, and does not know whether betting was reopened.
 * It asks, and it renders the answer. Spec section 8 wants these controls as
 * the reliable path to acting; phase 4's chip-pushing is flavour layered on
 * top of exactly these intents.
 */
export function ActionBar({
  snapshot,
  me,
  rejection,
  onAct,
}: {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  rejection: string | null;
  onAct(turn: number, type: PokerActionType, amount?: number): void;
}) {
  const myTurn = !!me && snapshot.actingSeat === me.seat;
  // Every intent answers the decision that was on screen when it was clicked.
  const turn = snapshot.turn;
  const [raiseTo, setRaiseTo] = useState(snapshot.minRaiseTo);

  // Reset the slider whenever the decision in front of the player changes,
  // so a stale amount from the previous street is never one click from being
  // sent. The server would reject it, but a surprising rejection is still a
  // bad moment at the table.
  useEffect(() => {
    setRaiseTo(snapshot.minRaiseTo);
  }, [snapshot.minRaiseTo, snapshot.actingSeat, snapshot.handNumber]);

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
        Fold
      </button>

      {snapshot.canCheck ? (
        <button className="btn" onClick={() => onAct(turn, PokerAction.Check)}>
          Check
        </button>
      ) : (
        <button className="btn" onClick={() => onAct(turn, PokerAction.Call)}>
          Call {snapshot.callAmount}
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
            {isAllIn ? `All in ${snapshot.maxRaiseTo}` : `${raiseVerb} ${raiseTo}`}
          </button>
        </span>
      )}

      {rejection && <span className="note note--error">{rejection}</span>}
    </div>
  );
}
