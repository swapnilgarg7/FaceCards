import * as THREE from "three";
import {
  CARD_HEIGHT,
  CARD_THICKNESS,
  CARD_WIDTH,
  DECK_SIZE,
  RANKS,
  SUITS,
  cardName,
  rankLabel,
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
/** The ground the whole atlas sits on, so a mipmap never blends in the dark. */
const PAPER = "#f6f3ec";
/** The two stops the showdown card's CSS uses, so both decks are one deck. */
const PAPER_LIGHT = "#fbf8f0";
const PAPER_DARK = "#ece7d9";

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
let atlasCanvas: HTMLCanvasElement | null = null;

function paintAtlas(ctx: CanvasRenderingContext2D, el: HTMLCanvasElement): void {
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
}

/** The one card texture. Built on first use, kept for the life of the tab. */
export function cardAtlasTexture(): THREE.CanvasTexture {
  if (atlas) return atlas;

  const el = document.createElement("canvas");
  el.width = COLUMNS * CELL_WIDTH;
  el.height = ROWS * CELL_HEIGHT;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  paintAtlas(ctx, el);
  atlasCanvas = el;

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
 * The one device every face carries: rank over suit, centred, plus the index.
 *
 * Not a pip grid. A real seven prints seven hearts, and at the size a card is
 * actually read here - roughly forty screen pixels tall, at an angle, from
 * across the table - seven of anything is a smudge, and the columns wide
 * enough to hold them run straight through the corner index.
 *
 * So the middle is left clean and carries exactly what the showdown card
 * carries: one large rank with its suit set under it, and nothing else. The
 * two decks a player meets in a hand - the cards lying on the felt and the
 * card that turns over at the end - then read as the same deck, which is the
 * point of drawing both rather than sourcing one.
 *
 * The corner index is what a real card adds on top of that, and it is why a
 * card can be read at all when it is half covered by the one in front of it:
 * rank over suit, small, top-left and repeated inverted at bottom-right, so a
 * hand fanned either way is still legible from a corner alone.
 *
 * Courts and the ace take the same device. On a real deck they differ because
 * an engraving exists to be looked at; here every face has to survive the same
 * forty pixels, so they are drawn the same way and told apart by their letter.
 */
/** Centre device, sized against the showdown card's 2.5rem / 1.5rem pair. */
const CENTRE_RANK_SIZE = 78;
const CENTRE_SUIT_SIZE = 40;
/** Offsets from the middle of the cell, so the pair sits optically centred. */
const CENTRE_RANK_OFFSET = -18;
const CENTRE_SUIT_OFFSET = 32;
/** Corner index: kept small enough that it never meets the central device. */
const CORNER_X = 17;
const CORNER_RANK_SIZE = 30;
const CORNER_RANK_BASELINE = 37;
const CORNER_SUIT_SIZE = 21;
const CORNER_SUIT_BASELINE = 60;

/**
 * The rank face, set narrower for the ten.
 *
 * `Bebas Neue` is what `--font-numeric` resolves to, so a rank on the felt is
 * the same letterform as the rank on the showdown card, the rail plaques and
 * every chip count in the room - one numeric voice rather than the browser's
 * default sans turning up on the cards alone.
 *
 * "10" is two glyphs where every other index is one, so at the same size it is
 * nearly twice as wide: in the corner it would cross the border, and in the
 * middle it would outgrow the suit beneath it. Dropping the size for the
 * two-character label lands it in the same footprint as an ace, which is what
 * a real deck does with its ten as well.
 */
function rankFont(rank: string, size: number): string {
  const px = rank.length > 1 ? Math.round(size * 0.78) : size;
  return `400 ${px}px "Bebas Neue", "Oswald", "Arial Narrow", ui-sans-serif, sans-serif`;
}

/**
 * The suit face.
 *
 * The shipped `Bebas Neue` is a latin subset and has no suit glyphs, so they
 * are asked for in the UI face directly rather than left to fall out of a
 * per-glyph fallback.
 */
function suitFont(size: number): string {
  return `${size}px ui-sans-serif, system-ui, sans-serif`;
}

/**
 * The paper, as a gradient rather than a flat fill, into the current path.
 *
 * The same two stops at the same angle the showdown card's CSS uses. Flat
 * white under the table's warm spots reads as a sticker; the faint fall across
 * the face is what makes it read as stock.
 */
function paintPaper(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const paper = ctx.createLinearGradient(x, y, x + CELL_WIDTH, y + CELL_HEIGHT);
  paper.addColorStop(0, PAPER_LIGHT);
  paper.addColorStop(1, PAPER_DARK);
  ctx.fillStyle = paper;
  ctx.fill();
}

function drawFace(ctx: CanvasRenderingContext2D, slot: number): void {
  const [x, y] = cellOrigin(slot);
  const name = cardName(slot);
  const rank = rankLabel(name[0]!);
  const suit = name[1]!;
  const ink = RED_SUITS.has(suit) ? INK_RED : INK_BLACK;
  const glyph = SUIT_GLYPHS[suit] ?? "?";

  ctx.save();
  roundedCard(ctx, x, y);
  paintPaper(ctx, x, y);
  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const centreX = x + CELL_WIDTH / 2;
  const centreY = y + CELL_HEIGHT / 2;

  ctx.font = rankFont(rank, CENTRE_RANK_SIZE);
  ctx.fillText(rank, centreX, centreY + CENTRE_RANK_OFFSET);
  ctx.font = suitFont(CENTRE_SUIT_SIZE);
  ctx.fillText(glyph, centreX, centreY + CENTRE_SUIT_OFFSET);

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
    ctx.font = rankFont(rank, CORNER_RANK_SIZE);
    ctx.fillText(rank, CORNER_X, CORNER_RANK_BASELINE);
    ctx.font = suitFont(CORNER_SUIT_SIZE);
    ctx.fillText(glyph, CORNER_X, CORNER_SUIT_BASELINE);
    ctx.restore();
  };
  corner(false);
  corner(true);

  ctx.restore();
}

/**
 * Repaint every face once the webfonts have settled.
 *
 * The same problem `plaques.ts` has, and the same fix: canvas does not wait
 * for a font, it substitutes silently and draws. The atlas is built once and
 * never again, so one painted while `Bebas Neue` was still in flight would
 * carry fallback ranks for the whole session. A no-op before the atlas exists,
 * which is the case where it will be painted with the font already resolved.
 */
export function repaintCardAtlas(): void {
  if (!atlas || !atlasCanvas) return;
  const ctx = atlasCanvas.getContext("2d");
  if (!ctx) return;
  paintAtlas(ctx, atlasCanvas);
  atlas.needsUpdate = true;
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
