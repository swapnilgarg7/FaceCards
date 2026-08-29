import { TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { CardRow } from "./PlayingCard.js";

/**
 * The pot, and your own two cards.
 *
 * This has been narrowing for three phases and that is the point. Phase 2
 * built it as the whole game because there was nowhere else to put it. Phase 4
 * moved the physical half onto the table - the board is on the felt, every
 * other seat's cards are face down in front of them, and every stack is a pile
 * of chips. The standings panel above it then took the roster: names, chip
 * counts, who is on the clock, who is sitting out, and what anybody showed
 * down are all one line each up there, next to the buy-in and profit columns
 * that give them meaning.
 *
 * What is left is the two things neither the table nor the standings can say.
 * **The pot**, because it is the number a player checks before deciding and it
 * belongs to nobody, so it has no row to live on. And **your own cards**,
 * because spec section 8 wants a flat fallback for everything the table does
 * physically, and because a player should never have to perform a gesture to
 * answer "what am I holding".
 */
export function HandHud({
  snapshot,
  me,
}: {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
}) {
  const dealing = snapshot.phase !== TablePhase.Waiting;
  if (!dealing && !(me && me.cardCount > 0)) return null;

  return (
    <div className="hand">
      <div className="hand__board">
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
    </div>
  );
}
