/**
 * Cards as objects on a table: how big they are, where they lie, and how a
 * card is named.
 *
 * Pure numbers and pure functions, no three.js import, in the same spirit as
 * `layout.ts` and `body.ts`. `TableCards.tsx` renders what this describes.
 *
 * The rule this file exists to keep is the phase-4 trap, restated: **a card
 * mesh never holds a value the server did not send.** A face-down card here is
 * not "a card whose face is hidden by a flag", it is `undefined` - there is
 * literally no rank or suit anywhere in the object. `cardIndex` refuses
 * anything it does not recognise, so a malformed string cannot resolve to a
 * face by accident either.
 */

import { TABLE, type Seat } from "./layout.js";

/** Metres. Poker size, 63 x 88 mm, with a thickness you can actually see. */
export const CARD_WIDTH = 0.063;
export const CARD_HEIGHT = 0.088;
export const CARD_THICKNESS = 0.0016;

/** Clear of the felt, so a card lying flat never z-fights the table top. */
export const CARD_REST_Y = TABLE.topY + CARD_THICKNESS;

/** Ranks and suits exactly as the server writes them: "As", "Td", "2c". */
export const RANKS = "23456789TJQKA" as const;
export const SUITS = "cdhs" as const;

export const DECK_SIZE = RANKS.length * SUITS.length;

/**
 * A card string to its slot in the atlas, or -1 for anything else.
 *
 * Rank is taken as the server writes it ("T", not "t") but accepted in either
 * case, as is the suit, because neither is ambiguous. Anything else - a blank,
 * a truncated string, a value from a client - is not a card and gets no face.
 */
export function cardIndex(card: string | undefined): number {
  if (!card || card.length !== 2) return -1;
  const rank = RANKS.indexOf(card[0]!.toUpperCase());
  const suit = SUITS.indexOf(card[1]!.toLowerCase());
  if (rank < 0 || suit < 0) return -1;
  return suit * RANKS.length + rank;
}

/** Round trip of `cardIndex`, for building the atlas. */
export function cardName(index: number): string {
  const rank = RANKS[index % RANKS.length]!;
  const suit = SUITS[Math.floor(index / RANKS.length)]!;
  return rank + suit;
}

export interface CardSpot {
  x: number;
  y: number;
  z: number;
  /** Y rotation of the card's long axis. */
  yaw: number;
}

/** Community cards run in a row through the middle, along the world Z axis. */
const BOARD_PITCH = CARD_WIDTH * 1.24;
export const BOARD_SIZE = 5;

/**
 * The `index`-th community card.
 *
 * Laid along Z rather than X for one reason: the pot rings the middle on the
 * diagonals (see `potAnchor`), so an axis-aligned row is the one line through
 * the centre that no pile ever sits on.
 *
 * A row through the middle is read at an angle from every seat, which is what
 * a real board is, and unlike anything oriented to a seat it treats all six
 * the same.
 */
export function boardSpot(index: number): CardSpot {
  const offset = (index - (BOARD_SIZE - 1) / 2) * BOARD_PITCH;
  return { x: 0, y: CARD_REST_Y, z: offset, yaw: Math.PI / 2 };
}

/** How far in from the rail a player's own two cards sit. */
const HOLE_INSET = 0.17;
/** Centre-to-centre, so the pair overlaps slightly like a real hand. */
const HOLE_PITCH = CARD_WIDTH * 0.82;
/**
 * How much higher the second card of a pair lies than the first.
 *
 * Not decoration - it is the fix for a real artefact. The pair deliberately
 * overlaps by a fifth of a card, and two cards at *identical* height overlap
 * as two coplanar surfaces competing for the same pixels: the depth buffer
 * cannot separate them, so the overlap strobes between the two faces as the
 * camera moves. A real deck has no such problem because one card is physically
 * on top of the other, and this is that. A card and a half of paper, so it is
 * visible to the depth buffer and invisible to a person.
 */
const HOLE_STACK_LIFT = CARD_THICKNESS * 1.5;

/**
 * One of a seat's two hole cards, lying on the felt just inside the rail.
 *
 * Close enough to the rail to be *that player's* cards rather than cards on a
 * shared table, and squared to the seat, so the pair reads as a hand in front
 * of a person from every other seat.
 */
export function holeSpot(seat: Seat, index: number): CardSpot {
  const forward = TABLE.radius - HOLE_INSET;
  const side = (index - 0.5) * HOLE_PITCH;

  const outX = Math.sin(seat.yaw);
  const outZ = Math.cos(seat.yaw);
  const rightX = Math.cos(seat.yaw);
  const rightZ = -Math.sin(seat.yaw);

  return {
    x: outX * forward + rightX * side,
    y: CARD_REST_Y + index * HOLE_STACK_LIFT,
    z: outZ * forward + rightZ * side,
    yaw: seat.yaw,
  };
}

/**
 * Where cards come from: the deck, in front of whoever holds the button.
 *
 * Cards flying out of the dealer's position rather than out of the middle of
 * the table is most of what makes a deal read as a deal, and it is also the
 * only thing on the felt that shows the button moving.
 */
export function deckSpot(button: Seat | undefined): CardSpot {
  if (!button) return { x: 0, y: CARD_REST_Y, z: 0, yaw: 0 };

  const forward = TABLE.radius - 0.2;
  const side = -0.26;
  const outX = Math.sin(button.yaw);
  const outZ = Math.cos(button.yaw);
  const rightX = Math.cos(button.yaw);
  const rightZ = -Math.sin(button.yaw);

  return {
    x: outX * forward + rightX * side,
    y: CARD_REST_Y,
    z: outZ * forward + rightZ * side,
    yaw: button.yaw,
  };
}

/**
 * Where a seat's cards go when it folds: pushed a little towards the middle,
 * face down, out of the player's own space.
 *
 * They do not travel all the way to a muck pile. A card that leaves the table
 * has to be drawn arriving somewhere, and the thing worth showing is the
 * gesture of letting go of the hand, which is over in the first few
 * centimetres.
 */
export function muckSpot(seat: Seat, index: number): CardSpot {
  const spot = holeSpot(seat, index);
  const toCentre = Math.hypot(spot.x, spot.z);
  const scale = toCentre === 0 ? 0 : (toCentre - 0.11) / toCentre;
  return { ...spot, x: spot.x * scale, z: spot.z * scale };
}
