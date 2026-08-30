import { avatarLook } from "../avatars/archetypes.js";
import { nightInReview, type ReelEntry, type ReelFace } from "./reel.js";

/**
 * How the evening gets remembered.
 *
 * Deliberately not a statistics screen. `reel.ts` already picked the six
 * superlatives and attached a face and a line to each, so all that is left
 * here is to lay them out large enough that the photographs are the thing you
 * see first - which is the entire argument for the feature.
 *
 * It renders whatever the evening actually produced. A quiet night with two
 * moments in it gets two cards, not six cards with four apologies; see
 * `nightInReview`.
 */
export function NightInReview({
  reel,
  onClose,
}: {
  reel: readonly ReelEntry[];
  onClose(): void;
}) {
  const awards = nightInReview(reel);

  return (
    <div className="review" role="dialog" aria-label="Tonight at the table">
      <div className="review__panel">
        <header className="review__head">
          <h2 className="review__title">Tonight at the table</h2>
          <button className="btn" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        {awards.length === 0 ? (
          <p className="review__empty">
            Nothing worth photographing yet. Poker Moments are saved for the
            hands people actually shout at: a big pot, an all-in, a bluff that
            got called, somebody busting out.
          </p>
        ) : (
          <div className="review__grid">
            {awards.map((award) => (
              <figure key={award.key} className="award">
                <span className="award__label">
                  {award.emoji} {award.label}
                </span>
                <Face face={award.face} />
                <figcaption>
                  <span className="award__name">{award.face.displayName}</span>
                  <span className="award__detail">{award.detail}</span>
                  <span className="award__hand">Hand {award.handNumber}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <p className="review__note">
          {/* Not a disclaimer bolted on: it is the honest description of what
              this screen is, and the reason it can exist at all. Nothing here
              was uploaded, nothing was written to disk, and closing the tab is
              the whole of the delete button. */}
          These frames live in this tab only. Nothing was recorded, uploaded or
          saved, and they all go when you leave.
        </p>
      </div>
    </div>
  );
}

function Face({ face }: { face: ReelFace }) {
  if (face.shot) {
    return (
      <img
        className="portrait portrait--award"
        src={face.shot.url}
        width={face.shot.width}
        height={face.shot.height}
        alt={face.displayName}
      />
    );
  }
  const look = avatarLook(face.avatar);
  return (
    <div
      className="portrait portrait--award portrait--avatar"
      style={{
        background: `radial-gradient(circle at 50% 38%, ${look.headColour} 0 42%, ${look.body} 42% 100%)`,
        borderColor: look.accent,
      }}
      role="img"
      aria-label={`${face.displayName}, camera off`}
    >
      <span className="portrait__initial">
        {face.displayName.slice(0, 1).toUpperCase()}
      </span>
    </div>
  );
}
