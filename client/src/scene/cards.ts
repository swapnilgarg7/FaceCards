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

/** Face down and face up, as a rotation about the card's own long axis. */
export const FACE_DOWN_PITCH = Math.PI / 2;
export const FACE_UP_PITCH = -Math.PI / 2;

/**
 * Where a peeked hand is held, and how it is turned.
 *
 * The numbers are geometry rather than taste, and they come off the seat. The
 * eye is at `EYE_HEIGHT` and sits `SEAT_OUTSET` back from a table of
 * `TABLE.radius`, so a hand resting on the felt is about 40cm below the eye and
 * 43cm in front of it - roughly 43 degrees down, which is outside a 55 degree
 * lens pointed level. That is the whole of what was wrong with the first
 * version of this gesture: it lifted the pair four centimetres and pulled it
 * four centimetres *towards* the player, which takes a hand that is already
 * below the frame and moves it further under the chin. The cards went in your
 * pocket.
 *
 * So the peek is the gesture it is named after. The hand comes **up**, to
 * about 15cm under the eye and a third of a metre in front of it, where it is
 * in frame without anybody having to look down, and it turns to face exactly
 * one pair of eyes. `PEEK_PITCH` is the angle whose normal points from there
 * back at the eye, so the rise, the draw and the pitch move together or not at
 * all - `cards.test.ts` holds them to it.
 */
const PEEK_PITCH = -0.43;
const PEEK_RISE = 0.26;
const PEEK_DRAW = 0.1;

/**
 * How the pair opens: a fan.
 *
 * Both cards hinge about one point below the hand, so their tops splay apart
 * while their bottoms stay together. That is what a fan is, it is what two
 * cards held in one hand actually do, and it is the only version of this that
 * solves the real problem. At rest the pair *overlaps*, deliberately, because
 * that is what a hand lying on felt looks like - but two overlapping cards
 * lifted to the same angle are two nearly-coplanar quads with the near one
 * covering a fifth of the far one. The covered fifth is the corner index,
 * which is the one part of a card anybody picks a hand up to read.
 *
 * `PEEK_HINGE_DROP` is how far below the cards' own bottom edge the hinge
 * sits: further down is a wider, flatter fan.
 */
const PEEK_FAN_ANGLE = 0.28;
const PEEK_HINGE_DROP = 0.026;
/**
 * How far apart the two leaves sit along their own normal.
 *
 * A fan of two is still two surfaces that cross near the hinge, and coplanar
 * surfaces z-fight. One card is in front of the other, as it is in a real
 * hand; a fraction of a millimetre is enough for the depth buffer and
 * invisible to a person. Same fix as `HOLE_STACK_LIFT`, in the other pose.
 */
const PEEK_LEAF_GAP = 0.0018;

/** Where a card is and how it is turned, part-way through being picked up. */
export interface CardPose {
  x: number;
  y: number;
  z: number;
  /** Rotation about the card's own long axis. */
  pitch: number;
  /** Rotation in the plane of the card. Zero for anything not being fanned. */
  roll: number;
}

/**
 * A card's pose `peek` of the way into being lifted and fanned.
 *
 * `peek` runs 0 (lying where it belongs) to 1 (held up in front of the eye);
 * `fan` is -1 for the left leaf of the pair and +1 for the right, 0 for a card
 * that is not part of a hand. `restPitch` is what the card is doing when it is
 * not being held - face up or face down - so the two poses blend rather than
 * this file needing to know which.
 *
 * Pure trigonometry, no three.js: `TableCard.tsx` damps towards whatever this
 * returns and owns nothing about the shape of the gesture.
 */
export function peekPose(
  spot: CardSpot,
  restPitch: number,
  peek: number,
  fan: number,
): CardPose {
  const pitch = restPitch + (PEEK_PITCH - restPitch) * peek;
  // A positive roll is a turn about the card's own normal, which points back
  // at the player - so it swings the card's top towards that player's *left*.
  // The right-hand leaf therefore takes the negative one, or the pair would
  // fan across itself instead of opening outwards.
  const roll = -peek * fan * PEEK_FAN_ANGLE;

  // The seat's outward direction: `spot.yaw` points the card's local +Z at the
  // player, which is what everything below is measured against.
  const outX = Math.sin(spot.yaw);
  const outZ = Math.cos(spot.yaw);

  // The fan, worked out in the card's own plane. The hinge sits below the
  // pair, so swinging a card about it moves the card's centre by this much -
  // which is what splays the tops without letting the bottoms come apart.
  const arm = CARD_HEIGHT / 2 + PEEK_HINGE_DROP;
  const alongX = -arm * Math.sin(roll);
  const alongY = arm * (Math.cos(roll) - 1);

  // The card's three axes at that pitch, in world terms.
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  // Local X: the seat's right, level with the felt whatever the pitch.
  const rightX = Math.cos(spot.yaw);
  const rightZ = -Math.sin(spot.yaw);
  // Local Y: up the face of the card.
  const upX = sinP * outX;
  const upY = cosP;
  const upZ = sinP * outZ;
  // Local Z: out of the face. One leaf rides a fraction of a millimetre in
  // front of the other along it.
  const gap = peek * fan * PEEK_LEAF_GAP;
  const faceX = cosP * outX;
  const faceY = -sinP;
  const faceZ = cosP * outZ;

  // The bottoms come together as the tops go apart, which is the other half
  // of a fan. At rest the pair is laid out `HOLE_PITCH` apart on the felt; a
  // hand picked up gathers into one grip, so that offset is walked back to
  // nothing over the lift and the two leaves end up hinging from the same
  // place. Without this the cards splay from where they were lying and open
  // into two separate cards on a table rather than one hand held in a hand.
  const gather = -peek * fan * (HOLE_PITCH / 2);
  const sideways = alongX + gather;

  const draw = peek * PEEK_DRAW;
  return {
    x: spot.x + outX * draw + sideways * rightX + alongY * upX + gap * faceX,
    y: spot.y + peek * PEEK_RISE + alongY * upY + gap * faceY,
    z: spot.z + outZ * draw + sideways * rightZ + alongY * upZ + gap * faceZ,
    pitch,
    roll,
  };
}
