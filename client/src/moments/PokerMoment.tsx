import { useEffect, useState } from "react";
import { avatarLook } from "../avatars/archetypes.js";
import { Kbd } from "../ui/Kbd.js";
import { useKeybinds } from "../ui/useKeybinds.js";
import type { Treatment } from "./moment.js";
import type { ReelFace } from "./reel.js";
import type { LiveMoment } from "./useMoments.js";

/**
 * The photograph, played big, and held.
 *
 * This component decides nothing. Which hand this is, who is in it, what tier
 * of loud it deserves and every word on it were settled by `moment.ts` and
 * `captions.ts` before a pixel was drawn; all that is left here is a layout
 * and a few keyframes. If a caption reads wrong the bug is in the pure module,
 * and it has a unit test waiting for it.
 *
 * **It stays up until somebody asks for the next hand.** It used to dismiss
 * itself on a tier-scaled timer, which was the wrong instinct dressed up as
 * politeness: the entire value of the thing is six people looking at each
 * other's faces and shouting about it, and that conversation does not fit in
 * four seconds - it ends when the table decides it has ended. That is the same
 * argument `ShowdownOverlay` already makes about the payout it sits on, and
 * the server is already built for it: the next deal waits for every seat to
 * press Next round, so nothing is being held up by a card staying on screen.
 *
 * So this screen owns Next round while it is up, rather than covering the
 * button underneath it and making people dismiss a celebration to get on with
 * the game. Looking at the cards again is still one click away.
 *
 * Three constraints shape the markup more than the brief does:
 *
 *  - **It sits over a live WebGL canvas.** So there is no `backdrop-filter`
 *    anywhere in this file. Blurring the backdrop of a full-screen element on
 *    top of a 3D scene forces the compositor to re-read the framebuffer every
 *    frame, and on the MacBook Air this product targets that is the difference
 *    between 60 and 40 for as long as the moment is up. A gradient does the
 *    same job for free.
 *  - **It must never trap anybody.** Escape and the scrim both dismiss it, and
 *    `Table` clears it the instant the table leaves the payout - so the
 *    server's own 60-second backstop is also this card's backstop, and there
 *    is no state in which it can be left over a live hand.
 *  - **A missing photograph is an ordinary outcome.** Camera off, permission
 *    denied, capture failed: every face here falls back to the player's
 *    avatar colours and keeps its caption, because the joke is about the
 *    poker and works without the picture.
 */

export interface PokerMomentProps {
  moment: LiveMoment;
  /** "I have seen it." The server deals when the last seat says so. */
  onNextHand(): void;
  /** This player has already asked. The button says so and stops taking taps. */
  asked: boolean;
  /** Who the table is still waiting for. Display only; the server decides. */
  waiting: string[];
  /** Put the card away and look at the cards underneath. */
  onDismiss(): void;
}

/**
 * How long the freeze-frame treatment withholds the winner.
 *
 * "THE MOMENT IT ALL WENT WRONG" over everybody's faces, and only then the
 * reveal. Short on purpose: the joke is a beat, and a beat held for two
 * seconds is a loading screen. This is the only timer left in the file, and it
 * withholds part of the card rather than taking the whole thing away.
 */
const FREEZE_MS = 1100;

const HEADLINES: Record<Treatment, string> = {
  "trading-card": "",
  champion: "THE TABLE HAS A NEW KING",
  newspaper: "THE CASINO TIMES",
  wanted: "WANTED",
  "hall-of-fame": "TONIGHT'S LEGENDS",
  "freeze-frame": "THE MOMENT IT ALL WENT WRONG",
};

export function PokerMoment({
  moment,
  onNextHand,
  asked,
  waiting,
  onDismiss,
}: PokerMomentProps) {
  const { plan, hero, fallen, witnesses } = moment;

  // Freeze-frame is the one treatment with two states. Everything else is
  // revealed from the first frame, so it starts already past the beat.
  const [revealed, setRevealed] = useState(plan.treatment !== "freeze-frame");

  useEffect(() => {
    if (revealed) return;
    const timer = window.setTimeout(() => setRevealed(true), FREEZE_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  // Enter means the same thing here it means on the payout screen underneath,
  // which is why this screen has to own it while it is up: two live handlers
  // for one key would send the intent *and* leave the card sitting there.
  // `ShowdownOverlay` stands its binding down whenever a moment is showing.
  useKeybinds({
    nextHand: () => {
      if (!revealed) setRevealed(true);
      else if (!asked) onNextHand();
    },
  });

  // Escape puts it away without voting - somebody who wants another look at
  // the board before they agree to move on.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const headline = HEADLINES[plan.treatment];
  const others = [...fallen, ...witnesses];

  return (
    <div
      className={`moment moment--${plan.treatment} moment--${plan.tier}`}
      role="dialog"
      aria-label="Poker moment"
      onClick={onDismiss}
    >
      <div
        className="moment__card"
        // The card is not a dismiss target: it has buttons on it now, and a
        // celebration that vanished because somebody clicked the winner's face
        // would be the most annoying possible way to lose it.
        onClick={(event) => event.stopPropagation()}
      >
        {headline && <p className="moment__headline">{headline}</p>}

        {plan.treatment === "newspaper" && (
          <p className="moment__kicker">
            LOCAL PLAYER STEALS {plan.pot.toLocaleString()} CHIPS
          </p>
        )}
        {plan.treatment === "wanted" && (
          <p className="moment__kicker">
            Last seen taking {plan.pot.toLocaleString()} chips from friends
          </p>
        )}

        <div className={`moment__hero${revealed ? " moment__hero--in" : ""}`}>
          {revealed ? (
            <>
              <Portrait face={hero} size="hero" />
              <p className="moment__name">{hero.displayName}</p>
              <p className="moment__pot">
                +{plan.hero.won.toLocaleString()}
                <span className="moment__pot-note">
                  {" "}
                  of {plan.pot.toLocaleString()}
                </span>
              </p>
              {plan.hero.hand && (
                <p className="moment__hand">{plan.hero.hand.toUpperCase()}</p>
              )}
              <p className="moment__caption">{hero.caption}</p>
            </>
          ) : (
            // The withheld beat. Everyone's face, nobody named, no result.
            <div className="moment__freeze">
              {others.map((face) => (
                <Portrait key={face.sessionId} face={face} size="strip" />
              ))}
            </div>
          )}
        </div>

        {revealed && others.length > 0 && (
          <div className="moment__strip">
            {others.map((face, index) => (
              <figure
                key={face.sessionId}
                className="reaction"
                // Staggered so the row lands as a wave rather than all at
                // once, which is what makes it read as people reacting.
                style={{ animationDelay: `${120 + index * 90}ms` }}
              >
                <Portrait face={face} size="strip" />
                <figcaption className="reaction__caption">
                  {face.caption}
                </figcaption>
                <span className="reaction__name">{face.displayName}</span>
              </figure>
            ))}
          </div>
        )}

        <div className="moment__foot">
          <button
            className="btn btn--primary"
            onClick={onNextHand}
            disabled={asked}
          >
            {asked ? "Waiting…" : "Next round"}
            <Kbd bind="nextHand" />
          </button>
          {/* The way back to the felt. Named for what it does rather than
              "Close", because the thing a player wants at this point is
              another look at the hand, not the absence of a dialog. */}
          <button className="btn btn--ghost" onClick={onDismiss}>
            Back to the cards
          </button>
        </div>
        {/* Who has not pressed it yet. The alternative to naming them is a
            table of six all wondering whether it is them. */}
        {asked && waiting.length > 0 && (
          <span className="moment__waiting">
            Waiting for {waiting.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One face: the photograph if there is one, the player's avatar colours if
 * there is not.
 *
 * The fallback is not a placeholder. It is the same body and head colour their
 * avatar is wearing across the table, so a player with their camera off is
 * still recognisably themselves in the picture rather than a grey box with a
 * name on it.
 */
function Portrait({ face, size }: { face: ReelFace; size: "hero" | "strip" }) {
  const className = `portrait portrait--${size}`;
  if (face.shot) {
    return (
      <img
        className={className}
        src={face.shot.url}
        width={face.shot.width}
        height={face.shot.height}
        alt={`${face.displayName} at the moment the hand was decided`}
      />
    );
  }

  const look = avatarLook(face.avatar);
  return (
    <div
      className={`${className} portrait--avatar`}
      style={{
        background: `radial-gradient(circle at 50% 38%, ${look.headColour} 0 42%, ${look.body} 42% 100%)`,
        borderColor: look.accent,
      }}
      aria-label={`${face.displayName}, camera off`}
      role="img"
    >
      <span className="portrait__initial">
        {face.displayName.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}
