/**
 * The mouth of the Poker Moment.
 *
 * Everything here is copy and the rules for choosing it. No React, no DOM, no
 * clock, no `Math.random` - the generator is injected - so "does this ever
 * repeat itself" and "does it ever say the wrong thing about a hand" are unit
 * tests rather than an evening of playing poker to find out.
 *
 * Three properties the selection has to have, in order of how badly their
 * absence is felt:
 *
 *  - **It must not repeat.** A joke is funny once and grating the third time,
 *    and a table plays forty hands in an evening. Every line remembers the
 *    hand it was last used on and is out of the running for
 *    `COOLDOWN_HANDS` after it, which is what makes a library of two hundred
 *    lines feel like a library of two hundred lines rather than like the six
 *    the shuffler happens to favour.
 *  - **It must be about the right thing.** "THE RIVER IS A CRIMINAL" over a
 *    hand that ended preflop is not a joke, it is a bug wearing one.
 *    `pools` is an ordered list of what actually applies, most specific
 *    first, and the weighting below strongly prefers the front of it.
 *  - **It must not be mean.** Every line in this file is about a poker
 *    decision, a pot, or a card. Nothing here is about a person's face,
 *    their voice, their money, or anything they did not do at this table.
 *    That is the whole review criterion for adding one: if the joke would
 *    still land with the player replaced by a stranger, it is about the
 *    poker; if it would not, it is about them, and it does not go in.
 */

/** Which drawer of the library to open. */
export type CaptionCategory =
  /** Lost as the aggressor holding nothing, after the flop. */
  | "bluff"
  /** Was in front at the turn and lost on the river. */
  | "rivered"
  /** Lost while holding a genuinely good hand. */
  | "strong-hand"
  /** Lost after putting a lot of chips in to call. */
  | "big-call"
  /** Lost with every chip in the middle. */
  | "all-in"
  /** Lost the last chip they had. */
  | "eliminated"
  /** Lost, and none of the above is interesting about it. */
  | "loss"
  /** Internet-register commentary. Always applicable, never the whole story. */
  | "bro"
  /** Over the winner's face. */
  | "winner"
  /** The pot was enormous. */
  | "escalation"
  /** Under a face that is only watching. */
  | "reaction";

/**
 * The library.
 *
 * An exhaustive `Record`, not a `Partial`: a category with no lines is a blank
 * caption over somebody's face at the loudest moment of the evening, and this
 * way it is a compile error instead.
 */
export const CAPTIONS: Record<CaptionCategory, readonly string[]> = {
  bluff: [
    "THEY CALLED THE BLUFF.",
    "THE BLUFF HAS BEEN EXPOSED.",
    "HE THOUGHT HE COULD GET AWAY WITH IT.",
    "THE AUDACITY.",
    "NOT THE BLUFF 😭",
    "HE REALLY TRIED IT.",
    "THE TABLE SAW THROUGH HIM.",
    "THE STORY DID NOT ADD UP.",
    "HE WAS REPRESENTING SOMETHING.",
    "WHAT WAS THE STORY HERE?",
    "CAUGHT. IN. THE. ACT.",
    "HE HAD IT ALL PLANNED OUT.",
    "THE PLAN HAD ONE FLAW.",
    "SOMEBODY DIDN'T BELIEVE HIM.",
  ],
  rivered: [
    "THE RIVER IS A CRIMINAL.",
    "RIVERED.",
    "HE WAS WINNING UNTIL HE WASN'T.",
    "THE RIVER CHOSE VIOLENCE.",
    "THAT RIVER CHANGED EVERYTHING.",
    "HE CAN'T BELIEVE THAT CARD.",
    "DELETE THE RIVER.",
    "ONE CARD. ONE.",
    "AHEAD FOR FOUR STREETS.",
    "THE LAST CARD DID THAT.",
    "SOMEONE ARREST THE DEALER.",
    "IT WAS HIS POT FOR A WHOLE MINUTE.",
  ],
  "strong-hand": [
    "HE THOUGHT THAT WAS SAFE.",
    "IMAGINE LOSING WITH THAT.",
    "THAT HAND DID NOT SAVE HIM.",
    "THE HAND BETRAYED HIM.",
    "HE WAS FEELING VERY CONFIDENT.",
    "THE CONFIDENCE WAS NOT JUSTIFIED.",
    "YOU CANNOT FOLD THAT.",
    "NOBODY IS FOLDING THAT.",
    "THAT IS NOT A FOLD. THAT IS A COOLER.",
    "HE PLAYED IT PERFECTLY. HE LOST.",
    "THAT ONE WAS NOT HIS FAULT.",
    "A GOOD HAND AT THE WORST TIME.",
  ],
  "big-call": [
    "THAT CALL.",
    "WE NEED TO DISCUSS THAT CALL.",
    "HE REALLY CALLED THAT.",
    "THE CALL OF THE CENTURY.",
    "HE SAID 'I KNOW YOU'",
    "HE DID NOT KNOW.",
    "THAT CALL NEEDS INVESTIGATION.",
    "SOMEONE EXPLAIN THAT CALL.",
    "HE HAD A READ. IT WAS WRONG.",
    "CURIOSITY IS EXPENSIVE.",
    "HE PAID TO SEE IT.",
    "AN EXPENSIVE LOOK.",
  ],
  "all-in": [
    "ALL IN. ALL GONE.",
    "HE PUT IT ALL ON THE LINE.",
    "AND IT'S GONE.",
    "THAT ESCALATED QUICKLY.",
    "THE WHOLE STACK 💀",
    "HE BET THE FARM.",
    "FARM STATUS: GONE.",
    "EVERYTHING. ON THAT.",
    "NO CHIPS WERE SPARED.",
    "HE COMMITTED. FULLY.",
  ],
  eliminated: [
    "AND HE'S OUT.",
    "PACK IT UP.",
    "THANKS FOR PLAYING.",
    "THE WALK OF SHAME.",
    "SEE YOU NEXT HAND.",
    "ONE LESS PROBLEM.",
    "THE DREAM IS OVER.",
    "ELIMINATED.",
    "THE STACK HAS LEFT THE BUILDING.",
    "ZERO. THAT IS THE NUMBER.",
    "HE'S GOING TO THE LOBBY.",
  ],
  loss: [
    "OOF.",
    "THAT'S TUFF.",
    "IT'S OVER.",
    "NOT LIKE THIS.",
    "YOU HATE TO SEE IT.",
    "GOOD NIGHT.",
    "HE HAD A PLAN.",
    "THE PLAN DID NOT WORK.",
    "HE BELIEVED.",
    "HE BELIEVED TOO MUCH.",
    "THAT'S ROUGH.",
    "WE'VE ALL BEEN THERE.",
    "NOT HIS FINEST WORK.",
    "THE TABLE WILL REMEMBER THIS.",
  ],
  bro: [
    "bro really thought",
    "bro thought he was cooking",
    "bro was cooking",
    "bro was NOT cooking",
    "sonnn...",
    "nahhh",
    "ain't no way",
    "no shot",
    "he's finished",
    "it's wraps",
    "pack it up bro",
    "we gotta talk",
    "someone explain this",
    "what was the plan here",
    "he saw something we didn't",
    "he actually believed",
    "the confidence 😭",
    "the audacity",
    "you can't be serious",
    "bro is fighting demons",
    "this is devastating",
    "this is cinema",
    "absolute cinema",
    "generational misplay",
    "generational fumble",
    "straight to the highlight reel",
    "straight to the blooper reel",
    "someone clip that",
    "we're saving this one",
  ],
  winner: [
    "THE TABLE HAS A NEW KING",
    "SHIP IT.",
    "HE SAW IT COMING.",
    "HE KNEW.",
    "TEXTBOOK.",
    "NO NOTES.",
    "THAT IS HOW IT'S DONE.",
    "THE HOUSE ALWAYS WINS. HE IS THE HOUSE.",
    "COLD BLOODED.",
    "HE NEVER DOUBTED IT.",
    "SOMEBODY STOP HIM.",
    "PURE BUSINESS.",
  ],
  escalation: [
    "THIS WILL BE SPOKEN ABOUT FOR YEARS.",
    "CALL HIS BANK.",
    "HE JUST LOST THE HOUSE.",
    "THE TABLE HAS BEEN ROBBED.",
    "SOMEONE CHECK THE CAMERAS.",
    "THAT IS GENERATIONAL WEALTH.",
    "HISTORY WAS MADE AT THIS TABLE.",
    "PUT IT IN THE MUSEUM.",
  ],
  reaction: [
    "HE KNEW.",
    "NO WAY.",
    "he's actually speechless",
    "someone check on him",
    "bro is sick",
    "he's never recovering from this",
    "that was personal",
    "he's pretending he's okay",
    "he saw it coming",
    "not even surprised",
    "purely observing",
    "taking notes",
    "glad it wasn't him",
    "he's doing the maths",
    "the maths is not mathing",
    "no comment",
  ],
};

/**
 * How many hands a line sits out after being used.
 *
 * Eight is roughly a full orbit at a six-handed table, which is the horizon
 * over which people actually notice a repeat: hear "bro really thought" twice
 * in one orbit and the system has a vocabulary of one, hear it twice in an
 * evening and it is a running joke. It is deliberately not "never repeat" -
 * the good lines are good, and a library that burns through itself and then
 * goes quiet is worse than one that comes back round.
 */
export const COOLDOWN_HANDS = 8;

/**
 * How much less likely each successive pool is than the one in front of it.
 *
 * Not zero, and that is the interesting part. The most specific category is
 * almost always the funniest thing to say, but *always* saying it turns the
 * system into a lookup table: every caught bluff for the rest of your life
 * comes with a bluff caption. A fifth of the time it reaches one drawer
 * further down and says "sonnn..." instead, which is the difference between a
 * feature that generates copy and one that feels like a person watching.
 */
const POOL_FALLOFF = 0.28;

/** What has been said lately. Opaque; carry it, do not read it. */
export interface CaptionMemory {
  /** Caption text -> the hand number it was last shown on. */
  readonly used: ReadonlyMap<string, number>;
}

export const NO_CAPTIONS: CaptionMemory = { used: new Map() };

export interface CaptionRequest {
  /**
   * Applicable categories, most specific first. Never empty in practice; an
   * empty list falls back to `loss` rather than producing a blank card,
   * because a Poker Moment with no words on it is a bug with a photograph.
   */
  pools: readonly CaptionCategory[];
  memory: CaptionMemory;
  /** Which hand this is, for the cooldown. Monotonic; never a clock. */
  handNumber: number;
  /** Injected. `Math.random` in the app, a fixed sequence in the tests. */
  random(): number;
}

export interface CaptionChoice {
  text: string;
  /** Carry this forward: it is what stops the next hand repeating this one. */
  memory: CaptionMemory;
}

/**
 * Pick a line, and remember having picked it.
 *
 * Returns a *new* memory rather than mutating: several captions are chosen for
 * one moment (the winner, each loser, each witness) and they have to see each
 * other's choices, which is easy when the memory is threaded through and
 * error-prone when it is a mutable singleton.
 */
export function pickCaption(request: CaptionRequest): CaptionChoice {
  const { memory, handNumber, random } = request;
  const pools = request.pools.length > 0 ? request.pools : (["loss"] as const);

  const candidates: { text: string; weight: number }[] = [];
  let fallback: { text: string; age: number } | null = null;

  pools.forEach((category, depth) => {
    const weight = POOL_FALLOFF ** depth;
    for (const text of CAPTIONS[category]) {
      const lastUsed = memory.used.get(text);
      const age = lastUsed === undefined ? Infinity : handNumber - lastUsed;
      if (age >= COOLDOWN_HANDS) {
        candidates.push({ text, weight });
      } else if (!fallback || age > fallback.age) {
        // Everything is on cooldown - a long evening, or a category with few
        // lines in it. Then the least-recently-said thing is the least bad
        // thing to say, which is still a better answer than silence.
        fallback = { text, age };
      }
    }
  });

  if (candidates.length === 0) {
    const text = (fallback as { text: string } | null)?.text ?? "OOF.";
    return { text, memory: remember(memory, text, handNumber) };
  }

  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  // Clamped, because a generator that hands back exactly 1 (or something
  // outside 0..1 entirely) would walk off the end of the list and pick
  // nothing. The pick has to succeed for every input a caller can produce.
  let target = Math.min(Math.max(random(), 0), 0.999999) * total;
  for (const candidate of candidates) {
    target -= candidate.weight;
    if (target < 0) {
      return {
        text: candidate.text,
        memory: remember(memory, candidate.text, handNumber),
      };
    }
  }

  const last = candidates[candidates.length - 1]!;
  return { text: last.text, memory: remember(memory, last.text, handNumber) };
}

/**
 * Note that a line was used.
 *
 * Bounded, because this outlives every hand of an evening and a map that only
 * grows is a leak with a very long fuse. Entries older than the cooldown can
 * never change a decision again, so they are dropped rather than kept for a
 * history nobody reads.
 */
function remember(
  memory: CaptionMemory,
  text: string,
  handNumber: number,
): CaptionMemory {
  const used = new Map(memory.used);
  used.set(text, handNumber);
  for (const [line, when] of used) {
    if (handNumber - when >= COOLDOWN_HANDS) used.delete(line);
  }
  return { used };
}
