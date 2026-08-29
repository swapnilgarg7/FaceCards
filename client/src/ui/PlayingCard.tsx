/**
 * A card as flat DOM.
 *
 * Deliberately not 3D. Phase 4 owns cards as physical objects you pick up and
 * peek at, and phase 5 owns the atlas they are textured from. Until then the
 * HUD's job is only to make the game legible enough to prove the rules, so
 * this stays a div and does not pretend otherwise.
 */

import { rankLabel } from "../scene/cards.js";

const SUITS: Record<string, { glyph: string; red: boolean }> = {
  c: { glyph: "♣", red: false },
  d: { glyph: "♦", red: true },
  h: { glyph: "♥", red: true },
  s: { glyph: "♠", red: false },
};

export function PlayingCard({
  card,
  dimmed = false,
}: {
  /** "As", "Td", or undefined for a card that is face down. */
  card?: string;
  dimmed?: boolean;
}) {
  if (!card) {
    return <span className="card card--back" aria-label="face-down card" />;
  }

  const rank = rankLabel(card[0] ?? "?");
  const suit = SUITS[(card[1] ?? "").toLowerCase()];
  const classes = [
    "card",
    suit?.red ? "card--red" : "card--black",
    dimmed ? "card--dim" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={card}>
      <b>{rank}</b>
      {suit?.glyph ?? "?"}
    </span>
  );
}

/** A row of cards, with `count` face-down backs when no faces are known. */
export function CardRow({
  cards,
  count = 0,
  dimmed = false,
}: {
  cards?: string[];
  count?: number;
  dimmed?: boolean;
}) {
  const faces = cards ?? [];
  const backs = Math.max(0, count - faces.length);
  return (
    <span className="cardrow">
      {faces.map((card, i) => (
        <PlayingCard key={`${card}-${i}`} card={card} dimmed={dimmed} />
      ))}
      {Array.from({ length: backs }, (_, i) => (
        <PlayingCard key={`back-${i}`} />
      ))}
    </span>
  );
}

/**
 * A big card that turns over.
 *
 * The showdown's card, and the only one in the DOM that is allowed to be
 * large. Everything else in the HUD is a readout kept deliberately small so it
 * does not compete with the faces; this is the one moment where the cards
 * *are* the thing everybody is looking at, so it is drawn at the size of the
 * moment and it takes the time to turn.
 *
 * A real flip rather than a fade: two faces back to back with the near one
 * rotated away, so what a player sees is the back of a card being turned by
 * somebody, which is what actually happens at a table. `revealed` going true
 * is the whole animation; the CSS owns its duration.
 *
 * `card` is only read once `revealed` is true, but the value still has to be
 * in the DOM for the transform to reveal something - so this component is only
 * ever handed cards the server published in a `Reveal`, never a card that is
 * merely known to this client.
 */
export function FlipCard({
  card,
  revealed,
  dimmed = false,
}: {
  /** "As", "Td". Face down until `revealed`, whatever it says. */
  card?: string;
  revealed: boolean;
  /** Not part of the five that won. Still on the table, no longer the story. */
  dimmed?: boolean;
}) {
  const rank = rankLabel(card?.[0] ?? "?");
  const suit = SUITS[(card?.[1] ?? "").toLowerCase()];
  const classes = [
    "flip",
    revealed ? "flip--up" : "",
    dimmed && revealed ? "flip--dim" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={revealed && card ? card : "face-down card"}>
      <span className="flip__inner">
        <span className="flip__face flip__back" />
        <span
          className={`flip__face flip__front${suit?.red ? " flip__front--red" : ""}`}
        >
          <b>{rank}</b>
          <i>{suit?.glyph ?? "?"}</i>
        </span>
      </span>
    </span>
  );
}
