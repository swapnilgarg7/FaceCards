import * as THREE from "three";
import {
  CARD_HEIGHT,
  CARD_THICKNESS,
  CARD_WIDTH,
  DECK_SIZE,
  RANKS,
  SUITS,
  cardName,
} from "./cards.js";

/**
 * Every card face, both backs and the paper edge, on one canvas.
 *
 * Two project rules meet here. `CLAUDE.md`: *cards are textured planes from
 * one atlas, not individual meshes with individual textures*. And the same
 * argument `textures.ts` already makes for the face mask and the name plates:
 * a thing this simple is cheaper to draw than to download, needs no licence
 * row, and cannot arrive late or 404.
 *
 * Phase 5 replaces the drawing below with an atlas baked from RevK's CC0 SVG
 * deck (see `docs/ASSET-SOURCES.md`). What must survive that swap is the *cell
 * geometry*: `atlasCell` is the contract, and as long as the baked atlas uses
 * the same grid in the same order, nothing else in the scene changes.
 *
 * Everything is built once and lives for the tab. Fifty-three geometries and
 * one texture is a fixed set that never churns, unlike the per-peer video
 * textures, which are disposed in `useFaceTexture`.
 */

/** Grid. 52 faces + a back + a blank edge = 54, so 8 x 7 with room spare. */
const COLUMNS = 8;
const ROWS = 7;
/** Cell pixels. Cards are ~40 screen pixels tall, so this is ample. */
const CELL_WIDTH = 128;
const CELL_HEIGHT = 180;

/** Atlas slots after the 52 faces. */
export const BACK_SLOT = DECK_SIZE;
export const EDGE_SLOT = DECK_SIZE + 1;

const SUIT_GLYPHS: Record<string, string> = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
};

const RED_SUITS = new Set(["d", "h"]);

const INK_BLACK = "#16181d";
const INK_RED = "#b8232c";
const PAPER = "#f6f3ec";

/** Where a slot sits in the atlas, in UV space. */
export interface AtlasCell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export function atlasCell(slot: number): AtlasCell {
  const column = slot % COLUMNS;
  const row = Math.floor(slot / COLUMNS);
  // Canvas rows run top-down and UV rows run bottom-up.
  const v1 = 1 - row / ROWS;
  return {
    u0: column / COLUMNS,
    v0: v1 - 1 / ROWS,
    u1: (column + 1) / COLUMNS,
    v1,
  };
}

let atlas: THREE.CanvasTexture | null = null;

/** The one card texture. Built on first use, kept for the life of the tab. */
export function cardAtlasTexture(): THREE.CanvasTexture {
  if (atlas) return atlas;

  const el = document.createElement("canvas");
  el.width = COLUMNS * CELL_WIDTH;
  el.height = ROWS * CELL_HEIGHT;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  // The gaps between cells are never sampled - every UV rect is a whole cell -
  // but a mipmap blends across them, so the ground has to be paper rather than
  // transparent black or every card would gain a dark halo when minified.
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, el.width, el.height);

  for (let slot = 0; slot < DECK_SIZE; slot++) {
    drawFace(ctx, slot);
  }
  drawBack(ctx, BACK_SLOT);
  drawEdge(ctx, EDGE_SLOT);

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Cards are read at a steep angle from across the table, which is exactly
  // the case mipmaps exist for: without them the pips shimmer.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  atlas = texture;
  return atlas;
}

function cellOrigin(slot: number): [number, number] {
  return [(slot % COLUMNS) * CELL_WIDTH, Math.floor(slot / COLUMNS) * CELL_HEIGHT];
}

function roundedCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const inset = 4;
  ctx.beginPath();
  ctx.roundRect(
    x + inset,
    y + inset,
    CELL_WIDTH - inset * 2,
    CELL_HEIGHT - inset * 2,
    12,
  );
}

/**
 * Where the pips go, per rank, as fractions of the card's inner panel.
 *
 * Standard English pattern, which matters more than it sounds: this is the
 * arrangement everybody has been reading since childhood, so a five is
 * recognised as a five without counting. An evenly spaced grid of five is not
 * - it is a thing you have to count, and counting is exactly what a card at
 * the far side of a table must not require.
 *
 * `x` is measured from the centre, `y` from the top of the panel down. A
 * negative `y` means the pip is drawn upside down, as it is on the lower half
 * of a real card, which is the detail that stops a ten looking like a printing
 * error.
 */
const COLUMN = 0.26;
const PIPS: Record<string, [number, number][]> = {
  "2": [[0, 0.5], [0, -0.5]],
  "3": [[0, 0.5], [0, 0], [0, -0.5]],
  "4": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  "5": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [0, 0],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  "6": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [-COLUMN, 0],
    [COLUMN, 0],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  "7": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [0, 0.25],
    [-COLUMN, 0],
    [COLUMN, 0],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  "8": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [0, 0.25],
    [-COLUMN, 0],
    [COLUMN, 0],
    [0, -0.25],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  "9": [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [-COLUMN, 0.167],
    [COLUMN, 0.167],
    [0, 0],
    [-COLUMN, -0.167],
    [COLUMN, -0.167],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
  T: [
    [-COLUMN, 0.5],
    [COLUMN, 0.5],
    [0, 0.333],
    [-COLUMN, 0.167],
    [COLUMN, 0.167],
    [-COLUMN, -0.167],
    [COLUMN, -0.167],
    [0, -0.333],
    [-COLUMN, -0.5],
    [COLUMN, -0.5],
  ],
};

/** The inner panel a pip layout is measured against. */
const PANEL_TOP = 30;
const PANEL_BOTTOM = CELL_HEIGHT - 30;
const PIP_SIZE = 30;

function drawFace(ctx: CanvasRenderingContext2D, slot: number): void {
  const [x, y] = cellOrigin(slot);
  const name = cardName(slot);
  const rank = name[0]!;
  const suit = name[1]!;
  const ink = RED_SUITS.has(suit) ? INK_RED : INK_BLACK;
  const glyph = SUIT_GLYPHS[suit] ?? "?";

  ctx.save();
  roundedCard(ctx, x, y);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const centreX = x + CELL_WIDTH / 2;
  const middleY = y + (PANEL_TOP + PANEL_BOTTOM) / 2;
  const halfPanel = (PANEL_BOTTOM - PANEL_TOP) / 2;

  const pips = PIPS[rank];
  if (pips) {
    // A numbered card: the real pattern, at full strength.
    ctx.font = `${PIP_SIZE}px ui-sans-serif, system-ui, sans-serif`;
    for (const [px, py] of pips) {
      const cx = centreX + px * CELL_WIDTH;
      const cy = middleY - py * halfPanel;
      ctx.save();
      ctx.translate(cx, cy);
      // Pips below the middle are printed inverted on a real card, which is
      // what makes a hand read the same picked up either way up.
      if (py < 0) ctx.rotate(Math.PI);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    }
  } else {
    // Ace, or a court card. Both get one big central device rather than a
    // grid, which is also how they are told apart at a glance across a table.
    drawCourt(ctx, x, y, rank, glyph, ink);
  }

  // Corner index, top-left and bottom-right rotated, as on a real card, so a
  // card is readable whichever way up it is picked up.
  const corner = (flipped: boolean) => {
    ctx.save();
    if (flipped) {
      ctx.translate(x + CELL_WIDTH, y + CELL_HEIGHT);
      ctx.rotate(Math.PI);
    } else {
      ctx.translate(x, y);
    }
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 44px ui-sans-serif, system-ui, sans-serif";
    // "10" would not fit the corner, which is why the deck uses T.
    ctx.fillText(rank, 27, 51);
    ctx.font = "34px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(glyph, 27, 88);
    ctx.restore();
  };
  corner(false);
  corner(true);

  ctx.restore();
}

/**
 * The five cards a pip grid cannot draw: A, J, Q, K.
 *
 * Not figures. A real court card is an engraving with a face, a costume and a
 * mirrored half, and any attempt at one inside a 128x180 cell drawn with
 * canvas primitives lands somewhere between crude and unreadable - while the
 * job it has to do is only ever "this is a king, from two metres away, at an
 * angle". So each gets a device instead: a large suit glyph inside a framed
 * panel, with the rank letter over it for the courts. That reads instantly,
 * scales down cleanly, and is honest about being a stylised deck rather than
 * a bad imitation of a real one.
 *
 * The ace is the exception a real deck also makes: one enormous pip, no letter.
 */
function drawCourt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rank: string,
  glyph: string,
  ink: string,
): void {
  const centreX = x + CELL_WIDTH / 2;
  const centreY = y + CELL_HEIGHT / 2;

  if (rank === "A") {
    ctx.font = "82px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(glyph, centreX, centreY + 4);
    return;
  }

  // The frame: a double rule in the suit's own ink, which is what makes a
  // court card read as a court card before any letter is resolved.
  const panelWidth = 74;
  const panelHeight = 104;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  ctx.strokeRect(
    centreX - panelWidth / 2,
    centreY - panelHeight / 2,
    panelWidth,
    panelHeight,
  );
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    centreX - panelWidth / 2 + 6,
    centreY - panelHeight / 2 + 6,
    panelWidth - 12,
    panelHeight - 12,
  );
  ctx.restore();

  // Suit behind, letter in front. The glyph is knocked back so the letter
  // stays the thing the eye lands on.
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.font = "78px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(glyph, centreX, centreY + 4);
  ctx.restore();

  ctx.font = "bold 56px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(rank, centreX, centreY + 3);

  // A pip in two opposite corners of the panel, mirrored, standing in for the
  // rotational symmetry a real engraving has.
  ctx.save();
  ctx.font = "20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(glyph, centreX - panelWidth / 2 + 15, centreY - panelHeight / 2 + 16);
  ctx.translate(centreX + panelWidth / 2 - 15, centreY + panelHeight / 2 - 16);
  ctx.rotate(Math.PI);
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
}

function drawBack(ctx: CanvasRenderingContext2D, slot: number): void {
  const [x, y] = cellOrigin(slot);

  ctx.save();
  roundedCard(ctx, x, y);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.clip();

  // Inset panel, then a lattice inside it: the white border is what makes a
  // face-down card read as a card rather than as a coloured tile.
  const pad = 12;
  ctx.fillStyle = "#8c1f2a";
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, CELL_WIDTH - pad * 2, CELL_HEIGHT - pad * 2, 8);
  ctx.fill();
  ctx.save();
  ctx.clip();

  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 2;
  for (let d = -CELL_HEIGHT; d < CELL_WIDTH + CELL_HEIGHT; d += 13) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + CELL_HEIGHT, y + CELL_HEIGHT);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + d, y + CELL_HEIGHT);
    ctx.lineTo(x + d + CELL_HEIGHT, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x + pad, y + pad, CELL_WIDTH - pad * 2, CELL_HEIGHT - pad * 2, 8);
  ctx.stroke();
  ctx.restore();
}

function drawEdge(ctx: CanvasRenderingContext2D, slot: number): void {
  const [x, y] = cellOrigin(slot);
  ctx.fillStyle = "#e6e1d6";
  ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
}

let material: THREE.MeshStandardMaterial | null = null;

/** The one card material. Every card in the room shares it. */
export function cardMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({
    map: cardAtlasTexture(),
    roughness: 0.72,
    metalness: 0,
  });
  return material;
}

const geometries = new Map<string, THREE.BufferGeometry>();

/**
 * A card box whose front face samples `faceSlot` and whose back samples the
 * card back.
 *
 * The atlas is what lets every card share one material: instead of swapping a
 * texture per card, each card gets its own four-vertex UV rect written into a
 * cloned box. A box is 12 triangles; 53 of them is a rounding error next to a
 * single avatar, and they are cached because a hand deals the same faces over
 * and over.
 *
 * `faceSlot` of `BACK_SLOT` is a genuinely face-down card: both sides are the
 * back, and the geometry carries no rank or suit at all.
 */
export function cardGeometry(faceSlot: number): THREE.BufferGeometry {
  const key = String(faceSlot);
  const cached = geometries.get(key);
  if (cached) return cached;

  const geometry = new THREE.BoxGeometry(
    CARD_WIDTH,
    CARD_HEIGHT,
    CARD_THICKNESS,
  );
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;

  // BoxGeometry lays its faces out +X, -X, +Y, -Y, +Z, -Z, four vertices each.
  // Face is +Z, back is -Z, and the four thin sides are the paper edge.
  const slots = [EDGE_SLOT, EDGE_SLOT, EDGE_SLOT, EDGE_SLOT, faceSlot, BACK_SLOT];

  for (let face = 0; face < 6; face++) {
    const cell = atlasCell(slots[face]!);
    // Vertex order within a box face is top-left, top-right, bottom-left,
    // bottom-right in the face's own frame.
    const corners: [number, number][] = [
      [cell.u0, cell.v1],
      [cell.u1, cell.v1],
      [cell.u0, cell.v0],
      [cell.u1, cell.v0],
    ];
    for (let i = 0; i < 4; i++) {
      const [u, v] = corners[i]!;
      uv.setXY(face * 4 + i, u, v);
    }
  }
  uv.needsUpdate = true;

  geometries.set(key, geometry);
  return geometry;
}

const planes = new Map<string, THREE.BufferGeometry>();

/**
 * A single-sided plane carrying one atlas cell, at real card size.
 *
 * The box above is a card as an object on a table: it has an edge, a back, and
 * a thickness you can see when it is tipped up. This is a card as an *image* -
 * what the projection over the table shows - and a projection has no back to
 * turn over and no paper edge to catch the light. One quad instead of twelve
 * triangles, cached by slot exactly as the boxes are.
 *
 * Same guarantee as `cardGeometry`: `BACK_SLOT` here is a card with no value
 * anywhere in it, not a value with a flag over it.
 */
export function cardPlaneGeometry(faceSlot: number): THREE.BufferGeometry {
  const key = String(faceSlot);
  const cached = planes.get(key);
  if (cached) return cached;

  const geometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const cell = atlasCell(faceSlot);
  // A plane's four vertices run top-left, top-right, bottom-left,
  // bottom-right, the same order a box face uses.
  const corners: [number, number][] = [
    [cell.u0, cell.v1],
    [cell.u1, cell.v1],
    [cell.u0, cell.v0],
    [cell.u1, cell.v0],
  ];
  for (let i = 0; i < 4; i++) {
    const [u, v] = corners[i]!;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;

  planes.set(key, geometry);
  return geometry;
}

/** Everything the atlas can draw, for tests and for the verify script. */
export const ATLAS_SLOTS = {
  faces: DECK_SIZE,
  back: BACK_SLOT,
  edge: EDGE_SLOT,
  columns: COLUMNS,
  rows: ROWS,
  ranks: RANKS,
  suits: SUITS,
} as const;
