import type { DramaTier, MomentTrigger, Treatment } from "./moment.js";
import type { Shot } from "./capture.js";

/**
 * The evening, as the handful of things anybody will remember about it.
 *
 * "Night in Review" is not a statistics screen. Nobody at a poker night wants
 * a table of VPIP; what they want is the six photographs that made everyone
 * shout, with the reason underneath. So this file picks *superlatives* - the
 * biggest, the worst, the most expensive - and each one comes with a face and
 * a caption already attached, because a recap that made you read a number and
 * then imagine the reaction has thrown away the only asset it had.
 *
 * Pure, and holds no memory of its own: the reel is passed in and a new one
 * comes back. That is what lets `useMoments` own the object URLs and revoke
 * them exactly once, which is the difference between a feature and a leak.
 */

/** One person, as they appeared in one moment. */
export interface ReelFace {
  sessionId: string;
  displayName: string;
  /** Archetype id. What gets drawn when there is no photograph. */
  avatar: string;
  /** Their webcam frame, or null: camera off, or the capture failed. */
  shot: Shot | null;
  /** What was written under them at the time. */
  caption: string;
}

/** One captured moment, kept for the recap. */
export interface ReelEntry {
  handNumber: number;
  tier: DramaTier;
  triggers: MomentTrigger[];
  treatment: Treatment;
  pot: number;
  hero: ReelFace;
  /** Chips the hero took. */
  won: number;
  /** Everyone who lost something worth photographing. */
  fallen: ReelFace[];
  witnesses: ReelFace[];
}

/**
 * How many moments an evening keeps.
 *
 * Every entry holds up to eight decoded JPEGs alive in this tab for as long as
 * the session lasts, and a long night is fifty hands. Twelve is comfortably
 * more than the recap can show and comfortably under the point where holding
 * them costs anything noticeable - and being explicit about the ceiling is
 * what stops "keep the moments" quietly becoming "keep every frame of the
 * evening" three months from now.
 */
export const REEL_CAP = 12;

/**
 * Add a moment, and say what fell off the end.
 *
 * The eviction is returned rather than performed, because what has to happen
 * to an evicted entry is `URL.revokeObjectURL` on every shot in it, and this
 * file is not allowed to touch a browser API. The caller does it.
 *
 * When the reel is full it is the *least dramatic* entry that goes, not the
 * oldest. An evening's first hand can be its best one, and a queue would
 * throw away the quads at midnight to make room for a medium pot at one.
 */
export function addToReel(
  reel: readonly ReelEntry[],
  entry: ReelEntry,
  cap: number = REEL_CAP,
): { reel: ReelEntry[]; evicted: ReelEntry | null } {
  const next = [...reel, entry];
  if (next.length <= cap) return { reel: next, evicted: null };

  let weakest = 0;
  for (let i = 1; i < next.length; i++) {
    if (isLessMemorable(next[i]!, next[weakest]!)) weakest = i;
  }
  const [evicted] = next.splice(weakest, 1);
  return { reel: next, evicted: evicted ?? null };
}

const TIER_RANK: Record<DramaTier, number> = {
  notable: 0,
  big: 1,
  huge: 2,
  legendary: 3,
};

/** Ties on tier break on pot, then on age: the older of two equals goes. */
function isLessMemorable(a: ReelEntry, b: ReelEntry): boolean {
  if (TIER_RANK[a.tier] !== TIER_RANK[b.tier]) {
    return TIER_RANK[a.tier] < TIER_RANK[b.tier];
  }
  if (a.pot !== b.pot) return a.pot < b.pot;
  return a.handNumber < b.handNumber;
}

/** Every shot an entry is holding, for the caller to revoke. */
export function shotsOf(entry: ReelEntry): Shot[] {
  return [entry.hero, ...entry.fallen, ...entry.witnesses]
    .map((face) => face.shot)
    .filter((shot): shot is Shot => shot !== null);
}

// ------------------------------------------------------------- the recap

/** The closed set of things the evening can be summed up by. */
export type AwardKey =
  | "biggest-winner"
  | "biggest-pot"
  | "biggest-bluff"
  | "biggest-fumble"
  | "most-devastating"
  | "best-reaction";

export interface Award {
  key: AwardKey;
  emoji: string;
  label: string;
  face: ReelFace;
  /** The one line under the face. Chips, a hand, or the original caption. */
  detail: string;
  handNumber: number;
}

const AWARD_LABELS: Record<AwardKey, { emoji: string; label: string }> = {
  "biggest-winner": { emoji: "🏆", label: "Biggest winner" },
  "biggest-pot": { emoji: "🔥", label: "Biggest pot" },
  "biggest-bluff": { emoji: "🎭", label: "Biggest bluff" },
  "biggest-fumble": { emoji: "💀", label: "Biggest fumble" },
  "most-devastating": { emoji: "🪦", label: "Most devastating loss" },
  "best-reaction": { emoji: "😂", label: "Best reaction" },
};

/**
 * Six awards, or as many of them as the evening actually earned.
 *
 * An award with nothing to give it is *omitted*, never given to the least bad
 * candidate. "Biggest bluff: nobody bluffed" is a worse recap than five
 * awards, and inventing a winner for an empty category is how a funny screen
 * turns into a participation certificate.
 *
 * A person can win more than one, and that is correct: the player who took the
 * biggest pot of the night by snapping off the biggest bluff of the night
 * should appear twice, because that is the thing that happened.
 */
export function nightInReview(reel: readonly ReelEntry[]): Award[] {
  if (reel.length === 0) return [];
  const awards: Award[] = [];

  const give = (
    key: AwardKey,
    face: ReelFace,
    detail: string,
    handNumber: number,
  ) => {
    awards.push({ key, ...AWARD_LABELS[key], face, detail, handNumber });
  };

  // Biggest winner is a sum across the evening, not one pot: the person who
  // took the most chips home is a different question from who won the
  // largest single hand, and both are worth a card.
  const bySession = new Map<string, { face: ReelFace; won: number; hand: number }>();
  for (const entry of reel) {
    const running = bySession.get(entry.hero.sessionId);
    // The face kept is the one from their biggest pot, which is the one they
    // were most animated in.
    if (!running) {
      bySession.set(entry.hero.sessionId, {
        face: entry.hero,
        won: entry.won,
        hand: entry.handNumber,
      });
    } else {
      running.won += entry.won;
      if (entry.won > 0 && entry.pot >= reelPotOf(reel, running.hand)) {
        running.face = entry.hero;
        running.hand = entry.handNumber;
      }
    }
  }
  const richest = [...bySession.values()].sort((a, b) => b.won - a.won)[0];
  if (richest && richest.won > 0) {
    give("biggest-winner", richest.face, `+${richest.won}`, richest.hand);
  }

  const biggestPot = best(reel, (e) => e.pot);
  if (biggestPot) {
    give("biggest-pot", biggestPot.hero, `${biggestPot.pot} chips`, biggestPot.handNumber);
  }

  // The bluffer is the person the caption was written *about*, so it is the
  // fallen face that goes on the card, not the hero who caught them.
  const bluff = best(
    reel.filter((e) => e.triggers.includes("bluff-caught")),
    (e) => e.pot,
  );
  const bluffer = bluff?.fallen[0];
  if (bluff && bluffer) {
    give("biggest-bluff", bluffer, bluffer.caption, bluff.handNumber);
  }

  const fumble = best(
    reel.filter((e) => e.fallen.length > 0 && !e.triggers.includes("rivered")),
    (e) => e.pot,
  );
  const fumbled = fumble?.fallen[0];
  if (fumble && fumbled) {
    give("biggest-fumble", fumbled, fumbled.caption, fumble.handNumber);
  }

  // Devastating is not the same as big. Being run down on the river, or busted
  // out of the game, is the loss people still bring up an hour later.
  const devastating = best(
    reel.filter(
      (e) =>
        e.fallen.length > 0 &&
        (e.triggers.includes("rivered") || e.triggers.includes("elimination")),
    ),
    (e) => e.pot,
  );
  const devastated = devastating?.fallen[0];
  if (devastating && devastated) {
    give(
      "most-devastating",
      devastated,
      devastated.caption,
      devastating.handNumber,
    );
  }

  // The reaction award goes to somebody who was not in the hand at all, which
  // is the whole joke: the funniest face at the table belongs to the person it
  // did not happen to.
  const reaction = best(
    reel.filter((e) => e.witnesses.some((w) => w.shot !== null)),
    (e) => TIER_RANK[e.tier] * 1_000_000 + e.pot,
  );
  const watcher = reaction?.witnesses.find((w) => w.shot !== null);
  if (reaction && watcher) {
    give("best-reaction", watcher, watcher.caption, reaction.handNumber);
  }

  return awards;
}

function best<T>(items: readonly T[], score: (item: T) => number): T | null {
  let winner: T | null = null;
  let bestScore = -Infinity;
  for (const item of items) {
    const value = score(item);
    if (value > bestScore) {
      bestScore = value;
      winner = item;
    }
  }
  return winner;
}

function reelPotOf(reel: readonly ReelEntry[], handNumber: number): number {
  return reel.find((e) => e.handNumber === handNumber)?.pot ?? 0;
}
