/**
 * A card as flat DOM.
 *
 * Deliberately not 3D. Phase 4 owns cards as physical objects you pick up and
 * peek at, and phase 5 owns the atlas they are textured from. Until then the
 * HUD's job is only to make the game legible enough to prove the rules, so
 * this stays a div and does not pretend otherwise.
 */

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

  const rank = card[0] ?? "?";
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
