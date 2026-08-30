/**
 * The same joke, on six screens, with no message sent.
 *
 * A Poker Moment is a *shared* artifact or it is nothing. The whole point is
 * one person shouting "it called you a criminal" and five people looking at
 * the same words - and the first build broke that for the silliest possible
 * reason: `Math.random`. Every client planned the same hand, cast the same
 * hero and then independently rolled its own treatment and its own captions,
 * so the winner saw a newspaper and everyone else saw a wanted poster. Nobody
 * was looking at the same thing, which is a strange way to build a feature
 * whose entire job is to give a table something to look at together.
 *
 * The fix is to stop rolling dice and start deriving. Every client already
 * holds the two things needed to agree - the room code and the hand number -
 * so the "random" choices are a pure function of state everybody has. That
 * means:
 *
 *  - **no new message**, so nothing is added to a protocol whose smallness is
 *    load-bearing (see `media/MediaProvider.ts` on the datagram union);
 *  - **nothing to trust**, because no client is telling any other client what
 *    to display - each one computes the answer itself and gets the same one;
 *  - **no round trip**, so the card appears on the same frame it would have.
 *
 * The photographs stay local and stay different. They genuinely are different
 * pictures: your camera at full resolution on your machine, and whatever the
 * SFU delivered on everyone else's. That difference is honest and there is no
 * way to remove it that does not involve uploading people's faces.
 */

/**
 * A number every client at this table derives the same way.
 *
 * FNV-1a over the room code, mixed with the hand number. Not a hash anybody
 * should rely on for anything else: it is fast, it is stable across engines,
 * and it spreads two inputs that differ by one character into completely
 * different seeds - which is all that is being asked of it.
 *
 * The room code is in the mix so two tables playing hand 7 at the same moment
 * do not get the same treatment and the same captions, which would be a
 * strange coincidence for anybody who noticed it.
 */
export function momentSeed(roomCode: string, handNumber: number): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < roomCode.length; i++) {
    hash ^= roomCode.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Mixed in rather than concatenated, so hand 1 and hand 11 of the same room
  // are unrelated rather than adjacent.
  hash ^= handNumber + 0x9e3779b9;
  hash = Math.imul(hash, 16777619) >>> 0;
  return hash >>> 0;
}

/**
 * A generator with the shape `Math.random` has and none of its unpredictability.
 *
 * mulberry32: thirty-two bits of state, four operations, and a period long
 * enough that a poker night could not reach the end of it if it ran until the
 * heat death of the sun. It is not cryptographic and must never be used where
 * that matters - the deck is shuffled server-side with a CSPRNG, and this is
 * for deciding whether somebody gets a newspaper or a wanted poster.
 *
 * Returns values in [0, 1), like the thing it replaces, so every caller that
 * already takes an injected `random()` needs no change at all.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
