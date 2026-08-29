/**
 * Side pots.
 *
 * The pot model follows the pattern the tech-decisions doc points at: a pot is
 * an amount plus the set of seats eligible to win it. Everything else about
 * side pots falls out of that, including the case that kills most engines,
 * three players all-in for three different amounts.
 *
 * The construction is level-based. Sort the distinct per-hand contributions,
 * and for each step upward take that slice from everyone who reached it. The
 * seats who reached a level but folded still pay into it; they are simply not
 * in its eligible set.
 *
 * Invariant, asserted here rather than trusted: the pots sum to the
 * contributions. `buildPots` throws if they ever do not, because a chip
 * appearing or vanishing is worse than a crash.
 */

export interface Contribution {
  seat: number;
  /** Chips this seat put in across the whole hand, after any refund. */
  total: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /**
   * Seat indices that can win this pot, ascending.
   *
   * Empty only in the one case this function cannot resolve on its own: every
   * seat that staked a chip has folded, and there is no pot below to fold the
   * dead money into. It knows who paid, not who is left, so `finish()` in the
   * engine resolves those against the live seats before anything is published.
   */
  eligible: number[];
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function buildPots(contributions: readonly Contribution[]): Pot[] {
  for (const c of contributions) {
    if (!Number.isInteger(c.total) || c.total < 0) {
      throw new RangeError(`seat ${c.seat} contributed ${c.total}`);
    }
  }

  const staked = contributions.filter((c) => c.total > 0);
  const levels = [...new Set(staked.map((c) => c.total))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    const reached = staked.filter((c) => c.total >= level);
    const amount = (level - previous) * reached.length;
    previous = level;
    if (amount === 0) continue;

    const eligible = reached
      .filter((c) => !c.folded)
      .map((c) => c.seat)
      .sort((a, b) => a - b);

    const last = pots[pots.length - 1];

    if (eligible.length === 0) {
      // Dead money: every seat that reached this level folded. It cannot be
      // won on its own, so it rides along with the pot below it. Reachable
      // only when a folded seat out-contributed everyone still live, which
      // the end-of-round refund already makes rare.
      if (last) last.amount += amount;
      else pots.push({ amount, eligible: [] });
      continue;
    }

    // Consecutive levels with an identical eligible set are one pot. Without
    // this, five limpers produce five identical pots and the showdown reads
    // as five separate wins.
    if (last && sameSet(last.eligible, eligible)) last.amount += amount;
    else pots.push({ amount, eligible });
  }

  const staffed = staked.reduce((sum, c) => sum + c.total, 0);
  const potted = pots.reduce((sum, p) => sum + p.amount, 0);
  if (staffed !== potted) {
    throw new Error(
      `pot accounting broken: contributions ${staffed}, pots ${potted}`,
    );
  }

  return pots;
}

/**
 * Split `amount` between `winners`, giving the odd chips out one at a time
 * starting from the first seat clockwise of the button.
 *
 * Chips are integers, so a three-way split of 100 has to put the extra chip
 * somewhere. Silently dropping it breaks the sum-of-pots invariant; giving it
 * all to the lowest seat index is a standing bias in favour of one chair.
 */
export function splitPot(
  amount: number,
  winners: readonly number[],
  button: number,
  occupiedSeats: readonly number[],
): Map<number, number> {
  if (winners.length === 0) throw new RangeError("splitPot needs a winner");

  const share = Math.floor(amount / winners.length);
  let remainder = amount - share * winners.length;

  const payouts = new Map<number, number>();
  for (const seat of winners) payouts.set(seat, share);

  // Clockwise from the button, so the odd chip lands on the first winner to
  // the button's left. Any seat order works as long as it is deterministic
  // and the same on every hand; this is the one poker rooms actually use.
  const ring = [...occupiedSeats].sort((a, b) => a - b);
  const start = ring.findIndex((s) => s > button);
  const rotated = start < 0 ? ring : [...ring.slice(start), ...ring.slice(0, start)];

  for (const seat of rotated) {
    if (remainder === 0) break;
    if (!payouts.has(seat)) continue;
    payouts.set(seat, payouts.get(seat)! + 1);
    remainder--;
  }

  return payouts;
}
