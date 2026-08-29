import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TablePhase } from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { Kbd } from "./Kbd.js";
import { FlipCard } from "./PlayingCard.js";
import { useKeybinds } from "./useKeybinds.js";
import {
  LEAD_IN_MS,
  beatDelayMs,
  boardUp,
  handUp,
  resultUp,
  showdownPlan,
  waitingOn,
} from "./showdown.js";

/**
 * The end of a hand, played out big in the middle of the screen.
 *
 * The problem this solves is stated in `showdown.ts`: a hand ends in one
 * server patch, so the run-out, both hands and the winner all land in the same
 * frame, and the honest rendering of that is a sentence at the bottom of the
 * screen. Two people get all in on the river - the moment the entire evening
 * exists for - and it reads like a status bar.
 *
 * So this takes the screen. The remaining community cards turn over one at a
 * time, then each hand that had to show turns over, then the winner is named,
 * and **it stays there until somebody presses Next round**. That last part is
 * not a client trick: the server holds the next deal until every seat still in
 * the game has asked for it (see `ClientMessage.NextHand`), so nobody is dealt
 * into a hand while they are still looking at the last one.
 *
 * It is a scrim rather than a wall. The room stays visible behind it, because
 * the faces reacting to the river are half of what just happened and covering
 * them up to show a card would be the wrong trade in this product.
 *
 * Every card here came from a `Reveal` the server published. There is no path
 * from this component to a card that was not made public: it renders
 * `snapshot.reveals` and `snapshot.board`, and nothing else.
 */

export interface ShowdownOverlayProps {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  /** "I have seen it." The server deals when the last seat says so. */
  onNextHand(): void;
}

export function ShowdownOverlay({
  snapshot,
  me,
  onNextHand,
}: ShowdownOverlayProps) {
  const decided = snapshot.phase === TablePhase.Payout;

  // How much of the board this client had already watched land. Written from
  // an effect rather than during render, so the frame that *becomes* a payout
  // still reads the pre-payout value - which is exactly the number that says
  // how many cards were run out at once.
  const boardShown = useRef(0);
  useEffect(() => {
    if (!decided) boardShown.current = snapshot.board.length;
  }, [decided, snapshot.board.length]);

  const plan = useMemo(
    // Rebuilt per hand, not per patch: the reveals do not change once a hand
    // is decided, and a plan rebuilt mid-ceremony would restart the flips.
    () => showdownPlan(snapshot, boardShown.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot.handNumber, decided],
  );

  // How many beats have played. The one piece of state here, stepped by a
  // timer rather than by a frame loop: this is DOM, and a card that turns over
  // is a CSS transition, so nothing needs to run per frame.
  const [played, setPlayed] = useState(0);

  useEffect(() => {
    setPlayed(0);
  }, [snapshot.handNumber, decided]);

  useEffect(() => {
    if (!decided) return;
    const beat = plan.beats[played];
    if (!beat) return;
    const delay = beatDelayMs(beat) + (played === 0 ? LEAD_IN_MS : 0);
    const timer = window.setTimeout(() => setPlayed((n) => n + 1), delay);
    return () => window.clearTimeout(timer);
  }, [decided, plan, played]);

  // Impatience is a legitimate way to watch a showdown you already understand,
  // and the alternative to honouring it is a player mashing a button that is
  // not there yet.
  const skip = useCallback(() => {
    setPlayed(plan.beats.length);
  }, [plan.beats.length]);

  const asked = me?.readyNext ?? false;
  const waiting = waitingOn(snapshot);
  const done = resultUp(plan, played);

  // Enter is the whole keyboard here, and it means the two things this screen
  // can mean, in the order a player wants them: get on with it, then deal the
  // next one. Nothing else at the table is live during a payout - there is no
  // seat on the clock to fold or raise for - so it cannot collide.
  useKeybinds(
    {
      nextHand: () => {
        if (!done) skip();
        else if (!asked) onNextHand();
      },
    },
    decided,
  );

  if (!decided) return null;

  // The five that won, so everything else can step back out of the way. The
  // server chose them; this only reads the list.
  const winningCards = new Set(
    plan.hands.filter((hand) => hand.won > 0).flatMap((hand) => hand.best),
  );
  const spent = (card: string) => done && winningCards.size > 0 && !winningCards.has(card);

  return (
    <div className="showdown" role="dialog" aria-label="Showdown">
      {/* The click target is the panel rather than the whole scrim, because
          the scrim does not take the cursor at all - see `styles.css`. A
          payout can sit there for a minute, and the mute button behind it has
          to stay reachable for every second of that. */}
      <div
        className="showdown__panel"
        onClick={done ? undefined : skip}
      >
        <p className="showdown__eyebrow">
          {plan.showdown ? "Showdown" : "Hand over"}
        </p>

        {plan.board.length > 0 && (
          <div className="showdown__board">
            {plan.board.map((card, i) => (
              <FlipCard
                key={`${snapshot.handNumber}:${i}`}
                card={card}
                revealed={boardUp(plan, played, i)}
                dimmed={spent(card)}
              />
            ))}
          </div>
        )}

        {plan.hands.length > 0 && (
          <div className="showdown__hands">
            {plan.hands.map((hand) => {
              const up = handUp(plan, played, hand.seat);
              const won = done && hand.won > 0;
              return (
                <div
                  key={hand.seat}
                  className={`showhand${won ? " showhand--won" : ""}`}
                >
                  <span className="showhand__who">{hand.displayName}</span>
                  <span className="showhand__cards">
                    {hand.cards.map((card, i) => (
                      <FlipCard
                        key={`${hand.seat}:${i}`}
                        card={card}
                        revealed={up}
                        dimmed={spent(card)}
                      />
                    ))}
                  </span>
                  {/* The name of the hand lands with the cards, not before
                      them: reading "Flush" over two face-down cards gives the
                      answer away and wastes the turn. */}
                  <span className="showhand__rank">
                    {up ? hand.description : " "}
                  </span>
                  <span className="showhand__won">
                    {won ? `+${hand.won}` : " "}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="showdown__result" aria-live="polite">
          {done ? (
            <p className="showdown__summary">
              {plan.summary || "Hand over"}
            </p>
          ) : (
            <p className="showdown__hint">Click or press Enter to skip ahead</p>
          )}
        </div>

        <div className="showdown__foot">
          <button
            className="btn btn--primary showdown__next"
            onClick={(event) => {
              event.stopPropagation();
              if (!done) skip();
              else onNextHand();
            }}
            disabled={done && asked}
          >
            {!done ? "Skip" : asked ? "Waiting…" : "Next round"}
            <Kbd bind="nextHand" />
          </button>
          {/* Who has not pressed it yet. The alternative to naming them is a
              table of six all wondering whether it is them. */}
          {asked && waiting.length > 0 && (
            <span className="showdown__waiting">
              Waiting for {waiting.join(", ")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
