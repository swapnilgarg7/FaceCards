/**
 * Chips: what a number of chips looks like, and where those chips sit.
 *
 * Pure numbers and pure functions, no three.js import, so the part that
 * decides whether a stack *reads* right is unit-testable without a renderer.
 * `ChipField.tsx` turns what this returns into one `InstancedMesh`.
 *
 * The one thing to understand here: a chip is a picture of a number the server
 * owns, never a store of one. Nothing in this file adds, moves or awards a
 * chip. It is handed a stack size and asked what that looks like, and if the
 * two ever disagree the number is right and the picture is wrong.
 */

import { TABLE } from "./layout.js";
import type { Seat } from "./layout.js";
import { jitter, jitterSigned } from "./tween.js";

/** Metres. A real chip is 39mm across and 3.3mm thick. */
export const CHIP_RADIUS = 0.0195;
export const CHIP_THICKNESS = 0.0038;

/**
 * Denominations, descending. Chosen against the table's actual stakes -
 * `SMALL_BLIND` 5 and `BIG_BLIND` 10 - so every legal amount is a whole
 * number of chips with no 1s needed, and a starting stack of 1000 reads as ten
 * hundreds rather than as two opaque plaques.
 */
export const DENOMINATIONS = [500, 100, 25, 5] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** Classic card-room colours, which is the one place tradition is legible. */
export const CHIP_COLOURS: Record<Denomination, string> = {
  500: "#7b3fb8",
  100: "#1b1e26",
  25: "#1f7a4a",
  5: "#b8352f",
};

/**
 * How many chips a pile may show. Above this the pile is drawn in a bigger
 * denomination rather than growing without limit: a stack is a thing you read
 * at a glance across a table, and thirty chips already reads as "a lot".
 */
export const MAX_CHIPS_PER_PILE = 24;

/**
 * A number of chips as a list of denominations, largest first.
 *
 * Not a plain greedy breakdown. Greedy from the top turns a 1000 stack into
 * two 500s, which is technically correct and visually useless. Instead the
 * smallest base denomination that keeps the pile under `maxChips` wins, so a
 * stack is drawn in the largest number of chips it can be without becoming a
 * tower: 1000 is ten hundreds, 3000 is six five-hundreds, and 985 is nine
 * hundreds, three quarters and two fives.
 *
 * The total always equals `amount` exactly when `amount` is a multiple of the
 * smallest denomination, which every legal amount at these stakes is. An
 * amount that is not lands its remainder on the floor rather than inventing a
 * chip, and `chipValue` will therefore read low - the number on screen, which
 * comes straight from the server, is the one that counts.
 */
export function chipBreakdown(
  amount: number,
  maxChips = MAX_CHIPS_PER_PILE,
): Denomination[] {
  if (!Number.isFinite(amount) || amount <= 0) return [];

  // Try the smallest base first: it gives the most chips, which is the most
  // legible pile, and the first one that fits inside the cap wins.
  for (let base = DENOMINATIONS.length - 1; base >= 0; base--) {
    const chips = greedyFrom(amount, base);
    if (chips.length <= maxChips) return chips;
  }
  // Every base overflows: the amount is enormous. Take the top denomination
  // and truncate, because a legible "a great many chips" beats a tower that
  // leaves the frame.
  return greedyFrom(amount, 0).slice(0, maxChips);
}

function greedyFrom(amount: number, base: number): Denomination[] {
  const chips: Denomination[] = [];
  let left = amount;
  for (let i = base; i < DENOMINATIONS.length; i++) {
    const denom = DENOMINATIONS[i]!;
    const n = Math.floor(left / denom);
    for (let k = 0; k < n; k++) chips.push(denom);
    left -= n * denom;
  }
  return chips;
}

/** What a drawn pile is worth. Only ever used to check the drawing. */
export function chipValue(chips: readonly Denomination[]): number {
  return chips.reduce((sum, chip) => sum + chip, 0);
}

export interface ChipPlacement {
  denomination: Denomination;
  x: number;
  y: number;
  z: number;
  /** Y rotation, so no two chips in a stack are squared to each other. */
  spin: number;
}

/** Tallest a single column gets before the pile starts a new one beside it. */
const COLUMN_HEIGHT = 8;
/** Centre-to-centre gap between columns. Chips in a row nearly touch. */
const COLUMN_PITCH = CHIP_RADIUS * 2.25;

/**
 * Lay a breakdown out as columns on the felt at `origin`, spreading along the
 * seat's right and stacking upward.
 *
 * Columns run left to right in front of the seat rather than towards the
 * middle of the table, because a row pointing at the pot is indistinguishable
 * from chips already on their way into it.
 *
 * `seed` makes the small imperfections stable: the same pile drawn on two
 * clients has the same chips at the same angles, so nobody's table is subtly
 * tidier than anybody else's.
 */
export function pileLayout(
  chips: readonly Denomination[],
  origin: { x: number; y: number; z: number },
  yaw: number,
  seed: number,
): ChipPlacement[] {
  const columns = Math.ceil(chips.length / COLUMN_HEIGHT) || 1;
  // Centre the row of columns on the origin.
  const first = -((columns - 1) * COLUMN_PITCH) / 2;

  // The seat's right in world XZ. A seat looks down -Z in its own frame, so
  // its right is +X turned by the seat's yaw.
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  return chips.map((denomination, i) => {
    const column = Math.floor(i / COLUMN_HEIGHT);
    const height = i % COLUMN_HEIGHT;
    const offset = first + column * COLUMN_PITCH;

    // Chips in a real stack are never perfectly concentric.
    const wobble = CHIP_RADIUS * 0.055;
    const dx = jitterSigned(seed + i * 31, wobble);
    const dz = jitterSigned(seed + i * 31 + 7, wobble);

    return {
      denomination,
      x: origin.x + rightX * offset + dx,
      y: origin.y + CHIP_THICKNESS * (height + 0.5),
      z: origin.z + rightZ * offset + dz,
      spin: jitter(seed + i * 31 + 13) * Math.PI * 2,
    };
  });
}

/** How far in front of a seat that player's own chips sit, in metres. */
const STACK_INSET = 0.3;
/** Sideways, so a stack never sits on top of that seat's cards. */
const STACK_SIDE = 0.15;
/** How far in front of a seat its current bet sits, on its way to the pot. */
const BET_INSET = 0.5;

/** Where a seat's own chips live: on the felt, to the right of its cards. */
export function stackAnchor(seat: Seat): { x: number; y: number; z: number } {
  return anchorFor(seat, TABLE.radius - STACK_INSET, STACK_SIDE);
}

/** Where a seat's live bet sits: pushed forward, not yet in the middle. */
export function betAnchor(seat: Seat): { x: number; y: number; z: number } {
  return anchorFor(seat, TABLE.radius - BET_INSET, 0);
}

/**
 * How many piles the collected pot is split across.
 *
 * A ring rather than one heap, and on the diagonals so it straddles the board
 * row without ever sitting on it. Two reasons, and the second is the real one:
 * a pot pushed in from six directions gathers as several piles at a real
 * table, and - unlike any single off-centre heap - a ring is the same shape
 * from every seat, so no arrangement of it makes one player's view better than
 * another's. Every other position on the felt is derived from a seat; this is
 * the one thing in the middle, and it must not quietly pick a favourite.
 */
export const POT_PILES = 4;

/** Bearing of the world +X axis to the first pot pile: the diagonals. */
const POT_RADIUS = 0.27;

/** Where the `index`-th pile of the collected pot sits. */
export function potAnchor(index = 0): {
  x: number;
  y: number;
  z: number;
  yaw: number;
} {
  const bearing = Math.PI / 4 + (index % POT_PILES) * (Math.PI / 2);
  return {
    x: Math.cos(bearing) * POT_RADIUS,
    y: TABLE.topY,
    z: Math.sin(bearing) * POT_RADIUS,
    // Face the pile back at the middle, so its columns spread tangentially
    // around the ring rather than pointing in at the board.
    yaw: Math.atan2(Math.cos(bearing), Math.sin(bearing)),
  };
}

/**
 * Split a breakdown across the pot's piles, largest chips first and round
 * robin, so the piles stay the same height as each other as the pot grows.
 */
export function splitAcrossPiles<T>(
  chips: readonly T[],
  piles = POT_PILES,
): T[][] {
  const out: T[][] = Array.from({ length: piles }, () => []);
  chips.forEach((chip, i) => out[i % piles]!.push(chip));
  return out;
}

/**
 * A point on the felt `forward` metres from the table centre along the seat's
 * bearing, offset `side` metres along that seat's right.
 */
function anchorFor(
  seat: Seat,
  forward: number,
  side: number,
): { x: number; y: number; z: number } {
  // The seat's bearing from the centre. `seat.yaw` points the seat at the
  // origin, so the seat is at bearing yaw + pi looking back out.
  const outX = Math.sin(seat.yaw);
  const outZ = Math.cos(seat.yaw);
  const rightX = Math.cos(seat.yaw);
  const rightZ = -Math.sin(seat.yaw);

  return {
    x: outX * forward + rightX * side,
    y: TABLE.topY,
    z: outZ * forward + rightZ * side,
  };
}
