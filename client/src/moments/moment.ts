import { HandStrength } from "@facecards/shared";
import type { HandNoteSnapshot, RoomSnapshot } from "../net/useRoom.js";
import type { CaptionCategory } from "./captions.js";

/**
 * Which hands are worth stopping the table for, and who is in the picture.
 *
 * The product argument, stated once so the thresholds below can be read
 * against it: a Poker Moment is only funny because it is *rare*. Fire one
 * after every hand and within an orbit it is a loading screen between deals -
 * people stop looking at the faces, start pressing the button, and the thing
 * that was supposed to be the best part of the evening becomes the part they
 * are waiting out. So this file says no far more often than it says yes, and
 * every threshold in it is set where it is because saying yes there would
 * cheapen the times it matters.
 *
 * Pure: a snapshot and an injected generator in, a plan out. No DOM, no
 * webcam, no React, no `Math.random`. The capture and the animation are
 * `capture.ts` and `PokerMoment.tsx`, and neither of them decides anything.
 *
 * Nothing here is a poker rule. Whether a hand was a bluff, a suckout or a
 * cooler was decided by the server in `server/src/poker/story.ts` and arrives
 * in `snapshot.handNotes`; this only decides whether it is worth a photograph.
 */

/** How big a deal this was. Drives the copy, the sound and the animation. */
export type DramaTier = "notable" | "big" | "huge" | "legendary";

/** Why this hand qualified. Several can be true; the loudest wins. */
export type MomentTrigger =
  | "bluff-caught"
  | "elimination"
  | "all-in"
  | "rivered"
  | "monster"
  | "big-pot"
  | "showdown"
  | "final-hand";

/** The visual treatment. Section 3 of the brief, as a closed set. */
export type Treatment =
  | "trading-card"
  | "champion"
  | "newspaper"
  | "wanted"
  | "hall-of-fame"
  | "freeze-frame";

export type MomentRole = "hero" | "fallen" | "witness";

export interface MomentPerson {
  seat: number;
  sessionId: string;
  displayName: string;
  /** Archetype id, so a camera that is off still has a face to draw. */
  avatar: string;
  role: MomentRole;
  /** Chips this seat took. Zero for everyone but a winner. */
  won: number;
  /** "Two Pair, Kings and Fives", or empty for a seat that did not show. */
  hand: string;
  /**
   * Caption drawers that apply to this person, most specific first. The words
   * themselves come from `captions.ts`, which owns the copy and the
   * anti-repetition; this only says what the picture is *of*.
   */
  pools: CaptionCategory[];
}

export interface MomentPlan {
  handNumber: number;
  tier: DramaTier;
  /** Everything true about this hand, loudest first. */
  triggers: MomentTrigger[];
  treatment: Treatment;
  /** Chips in the middle. */
  pot: number;
  /** The winner. There is always exactly one hero, or there is no moment. */
  hero: MomentPerson;
  /** Everyone who lost something worth photographing, worst loss first. */
  fallen: MomentPerson[];
  /** Everyone else still at the table, for the reaction strip. */
  witnesses: MomentPerson[];
}

// ------------------------------------------------------------- thresholds

/**
 * Pot sizes that make a hand interesting, in big blinds.
 *
 * Big blinds rather than chips, because a "big pot" at 5/10 with 1000 behind
 * is a different number from a big pot two rebuys later, and a constant in
 * chips would slowly stop firing as the evening got richer.
 *
 * 25 is about two and a half standard-sized pots: enough that somebody bet
 * twice and got called twice, which is the smallest hand anybody tells a story
 * about afterwards. Below it, a moment would be interrupting a hand that the
 * table itself did not stop to discuss.
 */
const BIG_POT_BB = 25;
const HUGE_POT_BB = 60;
const LEGENDARY_POT_BB = 150;

/**
 * How much of a pot somebody has to have called to be teased about the call.
 *
 * A fraction of the pot rather than a flat number, for the same reason as
 * above. A third means they were getting three-to-one or worse and did it
 * anyway, which is the call people actually argue about in the car home.
 */
const BIG_CALL_SHARE = 0.3;

/** Losing with this or better is a cooler, not a mistake. */
const STRONG_HAND: number = HandStrength.TwoPair;

/** Winning with this or better is worth a photograph on its own. */
const MONSTER_HAND: number = HandStrength.FullHouse;

/** Beyond this, the hand is talked about for the rest of the evening. */
const LEGENDARY_HAND: number = HandStrength.FourOfAKind;

/**
 * How many faces fit around the hero before the strip stops reading as faces.
 *
 * Seven witnesses at 8-max is a row of thumbnails nobody can pick a reaction
 * out of, which is the exact opposite of the point. Four is the most that
 * stays legible at the size the strip renders.
 *
 * The four kept are simply the lowest seat indices, which is arbitrary and is
 * knowingly left that way: every witness by definition folded early and was
 * not in the hand, so there is no ordering among them that is more true than
 * seat order, and inventing one would be a ranking the table would read as
 * meaning something.
 */
export const MAX_WITNESSES = 4;

export interface PlanOptions {
  snapshot: RoomSnapshot;
  /** Injected. Tests pass a fixed sequence. */
  random(): number;
  /**
   * What the last moment looked like, so this one does not look identical.
   * Null on the first of the evening.
   */
  lastTreatment: Treatment | null;
  /**
   * The table is breaking up: this is the last hand anybody will play.
   *
   * Not derivable from a snapshot - a table with one player left might be
   * waiting for a friend to reconnect - so it is passed in by the caller that
   * knows, and defaults to false.
   */
  finalHand?: boolean;
}

/**
 * Turn a decided hand into a moment, or decide it was not one.
 *
 * Returns null far more often than not, and that is the feature.
 */
export function planMoment(options: PlanOptions): MomentPlan | null {
  const { snapshot } = options;
  const notes = snapshot.handNotes;
  if (notes.length === 0) return null;

  const bb = Math.max(1, snapshot.bigBlind);
  const potBB = snapshot.pot / bb;
  const winners = notes.filter((note) => note.won > 0);
  // A chopped pot has no hero, and "two people won a bit each" is not a
  // photograph. It is also the one case where the whole layout below - one
  // big face, everyone else underneath - has no honest answer.
  if (winners.length !== 1) return null;
  const winner = winners[0]!;

  const showdown = notes.some((note) => note.showed);
  const busted = notes.some((note) => note.busted);
  const allIn = notes.some((note) => note.allIn);
  const rivered = notes.some((note) => note.rivered);
  const bluff = snapshot.bluffCaughtSeat >= 0;
  const monster = winner.showed && winner.category >= MONSTER_HAND;

  const triggers: MomentTrigger[] = [];
  // Ordered loudest first: the first entry is what the copy is about, so a
  // hand that was both a caught bluff and a big pot is a story about the
  // bluff, which is the funnier of the two by a distance.
  if (bluff) triggers.push("bluff-caught");
  if (busted) triggers.push("elimination");
  if (rivered) triggers.push("rivered");
  if (monster) triggers.push("monster");
  if (allIn) triggers.push("all-in");
  if (potBB >= BIG_POT_BB) triggers.push("big-pot");
  if (options.finalHand) triggers.push("final-hand");
  // A showdown on its own is the weakest qualification there is, so it needs
  // a pot behind it: two people checking down a small one is not a moment
  // however many cards got turned over.
  if (showdown && potBB >= BIG_POT_BB) triggers.push("showdown");

  if (triggers.length === 0) return null;

  const tier = dramaTier({ potBB, busted, allIn, winner, triggers });
  const cast = castOf(snapshot, notes, winner, tier);
  if (!cast) return null;

  return {
    handNumber: snapshot.handNumber,
    tier,
    triggers,
    treatment: pickTreatment(
      tier,
      triggers,
      cast.witnesses.length,
      options.lastTreatment,
      options.random,
    ),
    pot: snapshot.pot,
    ...cast,
  };
}

function dramaTier(input: {
  potBB: number;
  busted: boolean;
  allIn: boolean;
  winner: HandNoteSnapshot;
  triggers: readonly MomentTrigger[];
}): DramaTier {
  const { potBB, busted, allIn, winner, triggers } = input;
  const royal = winner.showed && winner.category >= LEGENDARY_HAND;

  if (royal) return "legendary";
  if (potBB >= LEGENDARY_POT_BB) return "legendary";
  // Somebody's whole stack went in and somebody left the table with nothing.
  // That is the loudest thing that happens at a friendly game.
  if (busted && allIn && potBB >= HUGE_POT_BB) return "legendary";
  if (busted) return "huge";
  if (potBB >= HUGE_POT_BB) return "huge";
  if (allIn || triggers.includes("bluff-caught")) return "big";
  if (potBB >= BIG_POT_BB) return "big";
  return "notable";
}

/**
 * Who is in the picture, and what each of them is a picture of.
 *
 * Losers are ordered by what the hand cost them, because the person who lost
 * the most is the person everyone is already looking at. Witnesses keep seat
 * order, because the strip reads as a table rather than as a ranking.
 */
function castOf(
  snapshot: RoomSnapshot,
  notes: readonly HandNoteSnapshot[],
  winner: HandNoteSnapshot,
  tier: DramaTier,
): Pick<MomentPlan, "hero" | "fallen" | "witnesses"> | null {
  const person = (
    note: HandNoteSnapshot,
    role: MomentRole,
  ): MomentPerson | null => {
    const seat = snapshot.players.find((p) => p.seat === note.seat);
    // A seat whose player left mid-hand can still win a pot, and there is no
    // camera to photograph. It stays in the summary line, which is the
    // server's, and out of the picture, which is ours.
    if (!seat) return null;
    const reveal = snapshot.reveals.find((r) => r.seat === note.seat);
    return {
      seat: note.seat,
      sessionId: seat.sessionId,
      displayName: seat.displayName,
      avatar: seat.avatar,
      role,
      won: note.won,
      hand: reveal?.description ?? "",
      pools:
        role === "hero"
          ? heroPools(tier, note)
          : role === "fallen"
            ? fallenPools(note, snapshot)
            : ["reaction", "bro"],
    };
  };

  const hero = person(winner, "hero");
  if (!hero) return null;

  const fallen = notes
    .filter((note) => note.seat !== winner.seat && worthPhotographing(note))
    .sort((a, b) => b.committed - a.committed)
    .map((note) => person(note, "fallen"))
    .filter((p): p is MomentPerson => p !== null);

  const inPicture = new Set([hero.seat, ...fallen.map((p) => p.seat)]);
  const witnesses = snapshot.players
    .filter((seat) => !inPicture.has(seat.seat) && seat.connected)
    .slice(0, MAX_WITNESSES)
    .map((seat) => ({
      seat: seat.seat,
      sessionId: seat.sessionId,
      displayName: seat.displayName,
      avatar: seat.avatar,
      role: "witness" as const,
      won: 0,
      hand: "",
      pools: ["reaction", "bro"] as CaptionCategory[],
    }));

  return { hero, fallen, witnesses };
}

/**
 * Is this loss worth a caption of its own?
 *
 * Somebody who folded the small blind on the first street lost five chips and
 * was not in the hand in any sense that matters. Putting "BRO REALLY THOUGHT"
 * under their face is the failure mode the brief is most explicit about: the
 * joke has to be about the poker situation, and there was no situation.
 */
function worthPhotographing(note: HandNoteSnapshot): boolean {
  return note.showed || note.allIn || note.busted;
}

function heroPools(tier: DramaTier, note: HandNoteSnapshot): CaptionCategory[] {
  const pools: CaptionCategory[] = [];
  if (tier === "legendary" || tier === "huge") pools.push("escalation");
  pools.push("winner");
  if (note.aggressor) pools.push("bro");
  return pools;
}

/**
 * What this loss was *about*, most specific first.
 *
 * Every entry is a fact the server published. Nothing here inspects a card.
 */
function fallenPools(
  note: HandNoteSnapshot,
  snapshot: RoomSnapshot,
): CaptionCategory[] {
  const pools: CaptionCategory[] = [];

  if (snapshot.bluffCaughtSeat === note.seat) pools.push("bluff");
  if (note.rivered) pools.push("rivered");
  if (note.showed && note.category >= STRONG_HAND) pools.push("strong-hand");
  if (note.biggestCall >= snapshot.pot * BIG_CALL_SHARE && note.biggestCall > 0) {
    pools.push("big-call");
  }
  if (note.allIn) pools.push("all-in");
  // Last of the specific drawers rather than first, even though it is the
  // biggest thing that happened to them. Being out is *how much it cost*; the
  // categories above are *why it happened*, and a caption that says why is a
  // better joke than one that says how much. The escalation is carried by the
  // tier, which is already making the whole card louder.
  if (note.busted) pools.push("eliminated");

  pools.push("loss", "bro");
  return pools;
}

/**
 * Which of the six looks this moment wears.
 *
 * Random, minus the one we just used, because "the presentation should NOT
 * always be identical" is only half satisfied by having six of them: a
 * uniform draw shows the same treatment twice in a row about one time in six,
 * which is exactly often enough for somebody to conclude it is broken.
 *
 * Two are gated rather than free. Hall of Fame is a claim about the evening
 * and reads as noise over an ordinary won pot, so it waits for a hand that
 * earned it. Freeze Frame is a strip of everyone's faces and has nothing to
 * show at a heads-up table.
 */
function pickTreatment(
  tier: DramaTier,
  triggers: readonly MomentTrigger[],
  witnesses: number,
  last: Treatment | null,
  random: () => number,
): Treatment {
  const pool: Treatment[] = ["trading-card", "champion", "newspaper"];
  // "Last seen taking $8,450 from his friends" wants a hand that was taken
  // rather than won quietly.
  if (triggers.includes("bluff-caught") || tier !== "notable") {
    pool.push("wanted");
  }
  if (tier === "huge" || tier === "legendary") pool.push("hall-of-fame");
  if (witnesses > 0 || tier === "legendary") pool.push("freeze-frame");

  const fresh = pool.filter((t) => t !== last);
  const choices = fresh.length > 0 ? fresh : pool;
  const index = Math.min(
    choices.length - 1,
    Math.floor(Math.min(Math.max(random(), 0), 0.999999) * choices.length),
  );
  return choices[index]!;
}
