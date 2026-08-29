import { SeatStatus, TablePhase } from "@facecards/shared";
import type { RoomSnapshot } from "../net/useRoom.js";
import { DEAL_STEP_MS, FLOP_STEP_MS } from "../scene/tween.js";
import type { SoundId } from "./sounds.js";

/**
 * What the table just did, as sounds.
 *
 * A pure function of two snapshots, which is the whole design: the table has
 * no event stream to listen to - it has server state, and state that changed.
 * Deriving the sounds from the difference means a sound cannot be fired twice
 * for one event, cannot be missed because a message was coalesced, and can be
 * tested exhaustively without a socket, a scene or an `AudioContext`.
 *
 * The delays line up with the animation on purpose, off the same two constants
 * in `tween.ts`. A deal click that arrives 90ms after its own card is worse
 * than no click at all: the ear notices a mismatch the eye would forgive.
 */

export interface Cue {
  sound: SoundId;
  /** Milliseconds from now. */
  delayMs: number;
  /** Multiplies the sound's own level. */
  gain?: number;
}

/** How long after the riffle the first card leaves the deck. */
const DEAL_LEAD_MS = 260;
/** After the last card of a street lands, before the pot is pushed. */
const PAYOUT_DELAY_MS = 340;

export function tableCues(
  previous: RoomSnapshot | null,
  next: RoomSnapshot,
): Cue[] {
  // Arriving at a table already in progress is not an event. Playing the deal
  // of a hand that started before you sat down would be a lie about what just
  // happened, and it is the first thing a new player would hear.
  if (!previous) return [];

  const cues: Cue[] = [];

  // A new hand. Everything else this frame - the board clearing, blinds
  // appearing, statuses resetting - is part of the deal, not separate events,
  // so a deal is the only thing that speaks.
  if (next.handNumber > previous.handNumber) {
    cues.push({ sound: "shuffle", delayMs: 0 });
    const cards = next.players.reduce(
      (total, player) => total + player.cardCount,
      0,
    );
    for (let i = 0; i < cards; i++) {
      cues.push({ sound: "deal", delayMs: DEAL_LEAD_MS + i * DEAL_STEP_MS });
    }
    // The blinds are posted as part of the deal; one push covers them.
    if (next.pot > 0) {
      cues.push({
        sound: "chipPush",
        delayMs: DEAL_LEAD_MS + cards * DEAL_STEP_MS,
        gain: 0.7,
      });
    }
    return cues;
  }

  // Community cards landing.
  const newCards = next.board.length - previous.board.length;
  if (newCards > 0) {
    for (let i = 0; i < newCards; i++) {
      cues.push({ sound: "flip", delayMs: i * FLOP_STEP_MS });
    }
  }

  const before = new Map(previous.players.map((p) => [p.seat, p]));

  let pushed = false;
  let folded = false;
  for (const player of next.players) {
    const was = before.get(player.seat);
    if (!was) continue;
    // Chips going out in front of a seat. One sound per seat, not per chip:
    // the sample already contains several chips landing.
    if (player.bet > was.bet) pushed = true;
    if (was.status !== SeatStatus.Folded && player.status === SeatStatus.Folded) {
      folded = true;
    }
  }
  if (pushed) cues.push({ sound: "chipPush", delayMs: 0 });
  if (folded) cues.push({ sound: "fold", delayMs: 0 });

  // The end of a betting round: everything in front of the seats goes into the
  // middle. Detected as bets emptying while the pot did not shrink, which is
  // the only way that happens - a hand ending pays the pot out instead.
  const wasCommitted = previous.players.reduce((sum, p) => sum + p.bet, 0);
  const nowCommitted = next.players.reduce((sum, p) => sum + p.bet, 0);
  if (wasCommitted > 0 && nowCommitted === 0 && next.pot >= previous.pot) {
    cues.push({ sound: "chipCollect", delayMs: newCards > 0 ? 90 : 0 });
  }

  // The pot going to whoever won it.
  if (previous.phase !== TablePhase.Payout && next.phase === TablePhase.Payout) {
    cues.push({ sound: "potPush", delayMs: PAYOUT_DELAY_MS });
  }

  return cues;
}
