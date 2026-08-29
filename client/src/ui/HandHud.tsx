import { SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { CardRow } from "./PlayingCard.js";

/**
 * The pot, the stacks, and your own two cards.
 *
 * Phase 2 built this as the whole game because there was nowhere else to put
 * it. Phase 4 moved the physical half onto the table - the board is on the
 * felt, every other seat's cards are face down in front of them, and every
 * stack is a pile of chips - so what is left here is deliberately only what a
 * pile of chips cannot say for itself: exact counts, who is on the clock, and
 * how the last hand ended.
 *
 * Two things stay that could have gone. **Your own cards**, because spec
 * section 8 wants a flat fallback for everything the table does physically,
 * and because a player should never have to perform a gesture to answer "what
 * am I holding". And **the numbers**, because a stack you can read to the chip
 * is a thing chips are bad at and text is good at. Everything else went.
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
        {/* The board itself is on the felt. What is left is the number a
            player checks before deciding, which is the pot. */}
        {dealing && (
          <span className="hand__pot">
            Pot <b>{snapshot.pot}</b>
          </span>
        )}
        {me && me.cardCount > 0 && (
          <span className="hand__mine">
            <CardRow cards={me.holeCards} count={me.cardCount} />
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

              {/* A showdown is on the table too, face up in front of the seat
                  that had to show. What the table cannot draw is what the hand
                  was called, so that is what stays here. */}
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
