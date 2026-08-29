import { TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { CardRow } from "./PlayingCard.js";

/**
 * The pot, and your own two cards, as a flat readout.
 *
 * This has been narrowing for four phases and that is the point. Phase 2 built
 * it as the whole game because there was nowhere else to put it. Phase 4 moved
 * the physical half onto the table - the board is on the felt, every other
 * seat's cards are face down in front of them, and every stack is a pile of
 * chips. The standings panel took the roster.
 *
 * What is left is spec section 8's fallback: a flat version of the two things
 * the table says physically that a player must never have to hunt for. **The
 * pot**, because it is the number checked before every decision and it belongs
 * to nobody, so it has no row to live on. And **your own cards**, because a
 * player should never have to perform a gesture to answer "what am I
 * holding".
 *
 * It sits at the bottom of the screen rather than in the left column, and that
 * move is the whole of what it is now for. The primary versions of both are
 * over the middle of the table - the pot and board are projected upright there
 * (`scene/holo.ts`), your own two cards are on the felt in front of you - and
 * a fallback belongs under the thing it backs up, not in the opposite corner
 * of the screen from it. In the corner it competed with the faces and quietly
 * became the thing people read instead of the table.
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
