/**
 * Fisher-Yates, hand-rolled and kept to ten lines so it stays auditable.
 *
 * The entropy source is injected rather than imported, which is what keeps
 * this directory free of any runtime dependency: production passes
 * `secureRandomInt` (a `node:crypto` binding, see `server/src/rng.ts`), tests
 * pass a deterministic counter.
 *
 * What this is deliberately not:
 *   - `Math.random()`, which is not a CSPRNG and is predictable from a few
 *     observed outputs. A predictable shuffle is a cheating vector even with
 *     fake chips.
 *   - `sort(() => Math.random() - 0.5)`, which is not a shuffle at all: the
 *     comparator is inconsistent, so the result is biased and the bias depends
 *     on the engine's sort implementation.
 */

/** Returns a uniformly distributed integer in [0, maxExclusive). */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Returns a shuffled copy. The input is not mutated, so a caller cannot
 * accidentally shuffle a deck another hand is still holding.
 */
export function shuffled<T>(items: readonly T[], randomInt: RandomInt): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    if (j < 0 || j > i) {
      throw new RangeError(`randomInt(${i + 1}) returned ${j}, out of range`);
    }
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
