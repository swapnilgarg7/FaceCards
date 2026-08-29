/**
 * Which drawn chip is which, across a change of state.
 *
 * The scene draws every chip in the room from one `InstancedMesh`, and the
 * table's chips are recomputed from scratch whenever server state changes: a
 * stack, a bet and a pot are numbers, and `chips.ts` turns a number into a
 * list of positions. That is the easy half. The half that decides whether any
 * of it *reads* is this one, and it is a matching problem, not a drawing one.
 *
 * A chip that is at a seat before a bet and in the middle after it has to be
 * the **same instance** both times, or it teleports instead of sliding, and
 * "pushing chips in" becomes "chips blinking out of existence at one end of
 * the table and into existence at the other". Nothing about the target
 * positions carries that information: it has to be recovered by matching the
 * new arrangement against the old one.
 *
 * The rule is: a chip may only ever become a chip of the *same denomination*,
 * and among those it becomes the nearest one. Same denomination because a red
 * five turning into a black hundred mid-slide is worse than a teleport;
 * nearest because a chip that moves the shortest distance to its new job is,
 * by construction, the one that was already doing something like it.
 *
 * Pure and free of three.js so the matching can be tested directly. It is
 * greedy rather than a full assignment: a Hungarian-style optimum would move
 * one or two chips a few centimetres less across a whole table, at a cost
 * nobody can see and a complexity everybody would have to read.
 */

export interface ChipSlot {
  /** Which pile this chip belongs to. Used only to keep matching stable. */
  pile: string;
  denomination: number;
  x: number;
  y: number;
  z: number;
  spin: number;
}

/** One live instance: where it is drawn now, and what it is drawn as. */
export interface ChipInstance {
  denomination: number;
  x: number;
  y: number;
  z: number;
}

export interface ChipAssignment {
  /** Index into the instance pool, or -1 for a chip with no home yet. */
  instance: number;
  slot: ChipSlot;
}

export interface AssignResult {
  assignments: ChipAssignment[];
  /** Instances no longer standing for anything. They fade out and are reused. */
  retired: number[];
}

/**
 * Match `slots` against the live instances, keeping identity where it can.
 *
 * `live` is indexed by instance; an entry of `null` is a free slot in the
 * pool. The result assigns every wanted chip an instance, allocating unused
 * ones for growth, and lists the instances that no longer stand for anything.
 *
 * Determinism matters as much as quality here: two clients drawing the same
 * table must produce the same assignment, or a chip slides left on one screen
 * and right on another. Every tie is therefore broken by index, never by map
 * iteration order.
 */
export function assignChips(
  live: readonly (ChipInstance | null)[],
  slots: readonly ChipSlot[],
  capacity: number,
): AssignResult {
  // Buckets of available instances by denomination, in index order.
  const available = new Map<number, number[]>();
  for (let i = 0; i < live.length && i < capacity; i++) {
    const chip = live[i];
    if (!chip) continue;
    const bucket = available.get(chip.denomination);
    if (bucket) bucket.push(i);
    else available.set(chip.denomination, [i]);
  }

  const taken = new Set<number>();
  const assignments: ChipAssignment[] = [];

  // Pass one: everything that can keep an instance of its own denomination
  // does, taking the nearest free one.
  for (const slot of slots.slice(0, capacity)) {
    const bucket = available.get(slot.denomination);
    let best = -1;
    let bestDistance = Infinity;

    if (bucket) {
      for (const index of bucket) {
        if (taken.has(index)) continue;
        const chip = live[index]!;
        const distance =
          (chip.x - slot.x) ** 2 + (chip.y - slot.y) ** 2 + (chip.z - slot.z) ** 2;
        // Strictly less, so an exact tie keeps the lower index and the
        // assignment is the same on every machine.
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
    }

    if (best >= 0) taken.add(best);
    assignments.push({ instance: best, slot });
  }

  // Pass two: whatever is left over gets a free instance, so a table whose
  // chip count grew draws the new ones instead of dropping them.
  const free: number[] = [];
  for (let i = 0; i < capacity; i++) {
    if (!taken.has(i) && (i >= live.length || !live[i])) free.push(i);
  }
  // Then instances whose chip was retired this round, reused rather than
  // leaving a hole in the pool.
  for (let i = 0; i < capacity; i++) {
    if (!taken.has(i) && i < live.length && live[i]) free.push(i);
  }

  let next = 0;
  for (const assignment of assignments) {
    if (assignment.instance >= 0) continue;
    const index = free[next++];
    if (index === undefined) continue;
    assignment.instance = index;
    taken.add(index);
  }

  const retired: number[] = [];
  for (let i = 0; i < live.length && i < capacity; i++) {
    if (live[i] && !taken.has(i)) retired.push(i);
  }

  return {
    assignments: assignments.filter((a) => a.instance >= 0),
    retired,
  };
}
