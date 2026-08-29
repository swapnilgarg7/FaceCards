import { useEffect, useState } from "react";
import {
  DEFAULT_BUY_IN,
  MAX_STACK,
  maxBuyIn,
  minBuyIn,
} from "@facecards/shared";
import type { RoomSnapshot, SeatSnapshot } from "../net/useRoom.js";
import { Kbd } from "./Kbd.js";
import {
  buyInProblemText,
  clampChips,
  parseChipAmount,
} from "./chipAmount.js";
import {
  contestedChips,
  isInHand,
  leaderboard,
  type LeaderboardRow,
  type SeatNote,
} from "./standings.js";

/**
 * Who is up, who is down, and what it cost them.
 *
 * The HUD is otherwise kept deliberately thin - everything it could say about
 * a player is already on their face - so this earns its place by being the one
 * thing the table genuinely cannot show. A pile of chips says how deep someone
 * is *now*. It cannot say that the pile is their third, and the difference
 * between "winning" and "has rebought twice" is most of what people actually
 * want to know at a poker night.
 *
 * Hence three columns rather than one: what they have put in, what they have
 * in front of them, and the only number that is really the score. See
 * `standings.ts` for why profit is measured off the stack and nothing else.
 *
 * The buy-in control lives at the bottom of the same panel, because reaching
 * for more chips is the action the numbers above it provoke.
 *
 * It can be put away, and remembers that it was. The panel answers a question
 * people ask between hands, and during one it is a slab of text over the seat
 * to your left; the product is the faces, so anything this size has to be
 * something a player can dismiss. Collapsed it leaves a single chip behind
 * rather than disappearing, because a panel with no way back is a panel nobody
 * risks closing.
 */

const OPEN_KEY = "facecards.standings.open";

export function loadStandingsOpen(): boolean {
  try {
    // Absent means open: the first evening should show the thing, and the
    // preference only exists once somebody has expressed one.
    return window.localStorage.getItem(OPEN_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveStandingsOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, String(open));
  } catch {
    // Not worth surfacing: the choice still holds for this session.
  }
}

const NOTE_LABELS: Record<SeatNote, string> = {
  away: "reconnecting",
  "all-in": "all in",
  folded: "folded",
  "buying-in": "chips coming",
  busted: "out of chips",
  "not-ready": "not ready yet",
  "sitting-out": "sitting out",
  "waiting-for-blind": "waiting for the blind",
  playing: "",
};

function chips(value: number): string {
  return value.toLocaleString();
}

function signed(value: number): string {
  return value > 0 ? `+${chips(value)}` : chips(value);
}

export function Leaderboard({
  snapshot,
  sessionId,
  me,
  open,
  onOpenChange,
  onBuyIn,
}: {
  snapshot: RoomSnapshot;
  sessionId: string | null;
  me: SeatSnapshot | undefined;
  /** Whether the panel is showing. Owned by `Table`, which also holds the key. */
  open: boolean;
  onOpenChange(open: boolean): void;
  onBuyIn(amount: number): void;
}) {
  const rows = leaderboard(snapshot, sessionId);
  const felt = contestedChips(snapshot);

  if (!open) {
    return (
      <button
        className="board__peg"
        onClick={() => onOpenChange(true)}
        aria-expanded={false}
      >
        Standings <Kbd bind="standings" />
      </button>
    );
  }

  return (
    <aside className="board" aria-label="Standings">
      <header className="board__head">
        <h2>Standings</h2>
        {snapshot.handNumber > 0 && (
          <span className="board__hand">Hand {snapshot.handNumber}</span>
        )}
        <button
          className="board__hide"
          onClick={() => onOpenChange(false)}
          aria-expanded
          aria-label="Hide the standings"
          title="Hide the standings"
        >
          Hide <Kbd bind="standings" />
        </button>
      </header>

      <div className="board__cols" aria-hidden="true">
        <span className="board__who">Player</span>
        <span className="board__num">Bought</span>
        <span className="board__num">Chips</span>
        <span className="board__num">+/-</span>
      </div>

      <ol className="board__rows">
        {rows.map((row) => (
          <Row key={row.sessionId} row={row} />
        ))}
      </ol>

      {felt > 0 && (
        <p className="board__felt">
          {/* Everything the columns above deliberately do not count. Without
              it the chips column reads short mid-hand for no visible reason. */}
          <span>In the pot</span>
          <b>{chips(felt)}</b>
        </p>
      )}

      <BuyIn snapshot={snapshot} me={me} onBuyIn={onBuyIn} />
    </aside>
  );
}

function Row({ row }: { row: LeaderboardRow }) {
  const note = NOTE_LABELS[row.note];
  const classes = [
    "board__row",
    row.isMe ? "board__row--me" : "",
    row.acting ? "board__row--acting" : "",
    row.note === "away" ? "board__row--away" : "",
    row.note === "busted" ? "board__row--busted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={classes}>
      <span className="board__who">
        <span className="board__rank">{row.rank}</span>
        <span className="board__name">
          {row.displayName}
          {row.isMe && <span className="board__you">you</span>}
          {row.onButton && (
            <span className="hand__button" title="dealer button">
              D
            </span>
          )}
          {row.blind && (
            <span
              className="board__blind"
              title={row.blind === "SB" ? "small blind" : "big blind"}
            >
              {row.blind}
            </span>
          )}
        </span>
        {/* One line, and a showdown outranks everything else that could go on
            it: what someone just turned over is the thing being talked about. */}
        {row.reveal ? (
          <span className="board__note board__note--reveal">
            {row.reveal.description}
            {row.reveal.won > 0 && <b> +{chips(row.reveal.won)}</b>}
          </span>
        ) : (
          (note || row.handsPlayed > 0) && (
            <span className="board__note">
              {note}
              {note && row.handsPlayed > 0 && " · "}
              {row.handsPlayed > 0 &&
                `won ${row.handsWon} of ${row.handsPlayed}`}
            </span>
          )
        )}
      </span>

      <span className="board__num">{chips(row.buyIn)}</span>

      <span className="board__num">
        {chips(row.chips)}
        {/* Both are chips that are theirs but not in the stack, and both would
            otherwise make the column look wrong. */}
        {row.committed > 0 && (
          <small className="board__aside">+{chips(row.committed)} out</small>
        )}
        {row.pending > 0 && (
          <small className="board__aside">+{chips(row.pending)} coming</small>
        )}
      </span>

      <span
        className={`board__num board__profit${
          row.profit > 0 ? " board__profit--up" : ""
        }${row.profit < 0 ? " board__profit--down" : ""}`}
      >
        {signed(row.profit)}
      </span>
    </li>
  );
}

/**
 * Putting more chips behind your seat.
 *
 * Every amount this can send is one the server would accept, because the
 * bounds come from `shared/src/buyIn.ts` - the same module the server checks
 * against. That is a courtesy, not a control: the server re-derives all of it
 * and a refusal comes back through the same rejection path as an illegal bet.
 *
 * The wording is the only place the client guesses at anything. A seat in a
 * live hand is told its chips arrive after it, because table stakes says they
 * do; if the guess is ever wrong the chips simply arrive sooner.
 *
 * The amount is typed as well as dragged, for the same reason the raise is:
 * "make it 2,500" is a thought a slider cannot express, and a rebuy is a
 * round number far more often than it is whatever pixel the thumb landed on.
 */
function BuyIn({
  snapshot,
  me,
  onBuyIn,
}: {
  snapshot: RoomSnapshot;
  me: SeatSnapshot | undefined;
  onBuyIn(amount: number): void;
}) {
  const [open, setOpen] = useState(false);

  const context = { stack: me?.stack ?? 0, pending: me?.pendingBuyIn ?? 0 };
  const min = minBuyIn(context);
  const max = maxBuyIn(context);
  const busted = !!me && me.stack === 0 && me.pendingBuyIn === 0;
  const waits = isInHand(snapshot, me);

  const suggested = Math.min(max, Math.max(min, DEFAULT_BUY_IN));
  // Text rather than a number, so the field can be emptied and retyped. See
  // `chipAmount.ts` for why the same module decides this and the raise.
  const [draft, setDraft] = useState(() => String(suggested));

  // Follow the bounds as chips are won, lost and delivered, so the control
  // never sits on a number that has since become illegal. A legal amount is
  // left exactly as typed - this drags it back into range, it does not tidy
  // it up.
  useEffect(() => {
    setDraft((text) => {
      const bounds = { min, max };
      const current = parseChipAmount(text, bounds);
      if (current.problem === null) return text;
      return String(clampChips(current.value ?? suggested, bounds));
    });
  }, [min, max, suggested]);

  const bounds = { min, max };
  const parsed = parseChipAmount(draft, bounds);
  const amount = parsed.value ?? suggested;
  const ready = parsed.problem === null;

  if (!me) return null;

  if (max === 0) {
    return (
      <p className="board__buyin board__buyin--note">
        You are at the table maximum of {chips(MAX_STACK)}.
      </p>
    );
  }

  if (!open) {
    return (
      <div className={`board__buyin${busted ? " board__buyin--urgent" : ""}`}>
        {busted && (
          <p className="board__buyin-lede">
            You are out of chips. Your seat is still yours.
          </p>
        )}
        {me.pendingBuyIn > 0 && (
          <p className="board__buyin-lede">
            {chips(me.pendingBuyIn)} arriving at the next deal.
          </p>
        )}
        <button
          className={`btn${busted ? " btn--primary" : ""}`}
          onClick={() => setOpen(true)}
        >
          {busted ? "Buy back in" : "Add chips"}
        </button>
      </div>
    );
  }

  return (
    <div className="board__buyin board__buyin--open">
      <label className="board__buyin-slider">
        <span>Buy in for</span>
        <input
          className={`board__buyin-amount${ready ? "" : " board__buyin-amount--bad"}`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          aria-label="buy-in amount"
          aria-invalid={!ready}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ready) {
              event.preventDefault();
              onBuyIn(amount);
              setOpen(false);
            }
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={clampChips(amount, bounds)}
          aria-label="buy-in slider"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>

      <div className="board__buyin-row">
        <button className="btn btn--ghost" onClick={() => setDraft(String(min))}>
          Min {chips(min)}
        </button>
        <button className="btn btn--ghost" onClick={() => setDraft(String(max))}>
          Max {chips(max)}
        </button>
      </div>

      {!ready && (
        <p className="note note--error">
          {buyInProblemText(parsed.problem!, bounds)}
        </p>
      )}

      <div className="board__buyin-row board__buyin-row--commit">
        <button
          className="btn btn--primary"
          disabled={!ready}
          onClick={() => {
            onBuyIn(amount);
            setOpen(false);
          }}
        >
          Buy in {chips(amount)}
        </button>
        <button className="btn btn--ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <p className="note">
        {waits
          ? "You are in this hand, so the chips join your stack when it ends. You play it out with what you started it with."
          : "The chips are behind your seat straight away."}
      </p>
    </div>
  );
}
