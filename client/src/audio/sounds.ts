/**
 * Every sound the table can make, and the files behind it.
 *
 * The phase-4 brief is blunt about why this matters: *sound does more work
 * here than the visuals; a good chip clink sells physicality better than a
 * better chip mesh.* Everything in here is Kenney's Casino Audio, CC0, with
 * its row in `docs/ASSET-CREDITS.md` and its licence shipped beside it at
 * `client/public/audio/LICENSE.txt`.
 *
 * One thing is *not* a file: the room murmur. No CC0 crowd bed was found (see
 * `docs/ASSET-SOURCES.md`), and a five-second loop of chatter is recognisable
 * as a loop within a minute. `murmur.ts` synthesises it instead, which is the
 * same argument this project already makes for the card atlas and the face
 * masks: cheaper to make than to find, and no licence row.
 *
 * Variants exist because a repeated identical transient is the fastest way to
 * make a real sound read as a sample. Six cards dealt from one file is a
 * machine; six cards dealt from four files is a dealer.
 */

export const SOUND_DIR = "/audio";

export type SoundId =
  | "shuffle"
  | "deal"
  | "flip"
  | "fold"
  | "chipPush"
  | "chipCollect"
  | "potPush"
  | "clink";

export interface SoundSpec {
  /** File names in `client/public/audio`, picked between at random. */
  files: readonly string[];
  /** Level relative to the master, before the listener's own volume. */
  gain: number;
  /** Random playback-rate spread, so repeats are never bit-identical. */
  detune?: number;
}

export const SOUNDS: Record<SoundId, SoundSpec> = {
  /** The riffle that opens a hand. */
  shuffle: { files: ["card-shuffle.ogg"], gain: 0.55 },
  /** One card leaving the deck. Played once per card of the deal. */
  deal: {
    files: ["card-slide-1.ogg", "card-slide-2.ogg", "card-slide-3.ogg", "card-slide-4.ogg"],
    gain: 0.7,
    detune: 0.06,
  },
  /** A community card landing face up. */
  flip: {
    files: ["card-place-1.ogg", "card-place-2.ogg", "card-place-3.ogg", "card-place-4.ogg"],
    gain: 0.8,
    detune: 0.05,
  },
  /** A hand pushed away. */
  fold: {
    files: ["card-shove-1.ogg", "card-shove-2.ogg", "card-shove-3.ogg"],
    gain: 0.6,
    detune: 0.06,
  },
  /** Chips going out in front of a seat: the bet. */
  chipPush: {
    files: ["chip-lay-1.ogg", "chip-lay-2.ogg", "chip-lay-3.ogg"],
    gain: 0.85,
    detune: 0.07,
  },
  /** The dealer sweeping the round's bets into the middle. */
  chipCollect: {
    files: ["chips-handle-1.ogg", "chips-handle-2.ogg", "chips-handle-3.ogg"],
    gain: 0.75,
    detune: 0.05,
  },
  /** The pot going to whoever won it. */
  potPush: {
    files: ["chips-stack-1.ogg", "chips-stack-2.ogg", "chips-stack-3.ogg"],
    gain: 0.9,
    detune: 0.04,
  },
  /** A single chip against another. Used sparsely inside the murmur bed. */
  clink: {
    files: ["chips-collide-1.ogg", "chips-collide-2.ogg", "chips-collide-3.ogg"],
    gain: 0.5,
    detune: 0.12,
  },
};

/** Every file the table can ask for. The verify script checks each one ships. */
export function soundFiles(): string[] {
  const files = new Set<string>();
  for (const spec of Object.values(SOUNDS)) {
    for (const file of spec.files) files.add(file);
  }
  return [...files].sort();
}
