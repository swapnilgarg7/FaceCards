import { Kbd } from "./Kbd.js";

/**
 * "Hold Space to look at your cards", printed where the cards are.
 *
 * The peek used to be advertised in the top-left strip with the room-level
 * shortcuts, which is the one place on screen a player is not looking when
 * they want to know what they were dealt. It belongs here instead: bottom
 * centre, directly over the two cards on the felt in front of the seat, so
 * the instruction and the thing it acts on are the same object.
 *
 * It says what the key does *now*, not what it is bound to. While the cards
 * are up it says how to put them down, which is the other half of a hold that
 * nobody has to be told twice.
 */
export function PeekHint({
  /** False when there is nothing in front of this seat to look at. */
  hasCards,
  peeking,
}: {
  hasCards: boolean;
  peeking: boolean;
}) {
  if (!hasCards) return null;

  return (
    <div
      className={`peekhint${peeking ? " peekhint--on" : ""}`}
      role="status"
      aria-live="polite"
    >
      <Kbd bind="peek" />
      <span>
        {peeking ? "Let go to put them face down" : "Hold to see your cards"}
      </span>
    </div>
  );
}
