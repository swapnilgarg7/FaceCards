import { randomInt } from "node:crypto";
import type { RandomInt } from "./poker/shuffle.js";

/**
 * The one binding between the pure poker engine and a real entropy source.
 *
 * It lives outside `poker/` on purpose: that directory imports nothing from
 * the platform, which is what lets the whole engine be exercised in unit tests
 * with a deterministic generator and no server.
 *
 * `crypto.randomInt` is rejection-sampled by Node, so it is uniform over the
 * range rather than the modulo-biased `random() % n` that a hand-rolled
 * version usually reaches for.
 */
export const secureRandomInt: RandomInt = (maxExclusive) =>
  randomInt(maxExclusive);
