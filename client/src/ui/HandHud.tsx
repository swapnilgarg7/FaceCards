import { SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { CardRow } from "./PlayingCard.js";

/**
 * The board, the pot, the stacks, and your own two cards.
 *
 * Phase 2's brief is "minimal HUD, not pretty yet": enough to prove the rules
 * end to end and no more. Everything here moves onto the table itself later -
 * stack counts read better as chips in front of a seat than as a number in a
 * list, and cards belong in your hands - so nothing in this file is worth
 * polishing in place.
 */
export function HandHud({
  snapshot,
  me,
}: {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
}) {
  const dealing = snapshot.phase !== TablePhase.Waiting;
  const revealBySeat = new Map(snapshot.reveals.map((r) => [r.seat, r]));

  return (
    <div className="hand">
      <div className="hand__board">
        <CardRow cards={snapshot.board} />
        {dealing && (
          <span className="hand__pot">
            Pot <b>{snapshot.pot}</b>
          </span>
        )}
      </div>

      <ol className="hand__seats">
        {snapshot.players.map((player) => {
          const reveal = revealBySeat.get(player.seat);
          const isMe = me?.sessionId === player.sessionId;
          const acting = snapshot.actingSeat === player.seat;
          const classes = [
            "hand__seat",
            acting ? "hand__seat--acting" : "",
            player.status === SeatStatus.Folded ? "hand__seat--folded" : "",
            // A held seat and a folded one look different on purpose: one is
            // out of this hand, the other may be out of the game.
            player.connected ? "" : "hand__seat--away",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <li key={player.sessionId} className={classes}>
              <span className="hand__name">
                {player.displayName}
                {isMe && " (you)"}
                {snapshot.buttonSeat === player.seat && (
                  <span className="hand__button" title="dealer button">
                    D
                  </span>
                )}
              </span>

              <span className="hand__stack">{player.stack}</span>
              {player.bet > 0 && <span className="hand__bet">{player.bet}</span>}

              {/* Your own cards come from a private field only your client
                  receives. Everyone else is a count of face-down backs until
                  a showdown publishes the real thing. */}
              <CardRow
                cards={isMe ? player.holeCards : reveal?.cards}
                count={player.cardCount}
                dimmed={player.status === SeatStatus.Folded}
              />

              {reveal && (
                <span className="hand__reveal">
                  {reveal.description}
                  {reveal.won > 0 && <b> +{reveal.won}</b>}
                </span>
              )}
              {player.status === SeatStatus.AllIn && (
                <span className="hand__tag">all in</span>
              )}
              {player.status === SeatStatus.Folded && (
                <span className="hand__tag">folded</span>
              )}
              {player.stack === 0 && player.status === SeatStatus.Waiting && (
                <span className="hand__tag">out of chips</span>
              )}
              {/* Both are reasons a seat is not in the next deal, and the
                  difference matters to everyone waiting: one of them is coming
                  back on their own. */}
              {!player.connected && (
                <span className="hand__tag">reconnecting</span>
              )}
              {player.connected && player.sittingOut && (
                <span className="hand__tag">sitting out</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
