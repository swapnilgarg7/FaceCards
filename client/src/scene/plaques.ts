import * as THREE from "three";
import { PALETTE } from "./surfaces.js";

/**
 * The diegetic readouts: what a seat is worth, engraved on the rail in front
 * of it, and the dealer button lying on the felt.
 *
 * `plan.md` phase 5: "Diegetic where it helps: stack counts on the table read
 * better than a floating HUD number." This is that, and the reason it helps is
 * specific to this product rather than general good taste. Every other seat's
 * face is across the table; a stack printed on the rail *under that face* is
 * read in the same glance as the face. The same number in a list in the corner
 * of the screen is read instead of a face. `HandHud` keeps the list, because
 * spec section 8 wants the flat controls as a fallback - but it is no longer
 * where you find out how much someone has.
 *
 * Names stay on the body and numbers go on the table, which is a clean split:
 * who you are travels with you, what you have sits where you are sitting.
 *
 * Drawn on a canvas, like every other label in this project. The cache is
 * keyed on what is actually drawn, so a table of six re-draws only when a
 * number changes, which is once per action.
 */

const PLATE_WIDTH = 320;
const PLATE_HEIGHT = 96;

/**
 * The condensed face the whole UI uses for numbers, with a real fallback
 * chain: this is drawn into a canvas, and canvas silently substitutes rather
 * than waiting, so the fallbacks are what a first paint may actually get.
 */
const NUMERALS = '600 62px "Bebas Neue", "Oswald", "Arial Narrow", sans-serif';
const CAPTION =
  '600 22px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** How a plaque is lit, which is the whole of what it says beyond the number. */
export type PlaqueTone = "idle" | "acting" | "folded" | "away" | "allin";

const TONES: Record<PlaqueTone, { ink: string; rule: string; ground: string }> =
  {
    idle: { ink: "#e9dcc0", rule: "#6b5a2e", ground: "rgba(12,9,7,0.82)" },
    // Whose turn it is has to be readable from across the table without
    // anybody hunting for a highlight in a list.
    acting: { ink: "#ffe9a8", rule: PALETTE.brass, ground: "rgba(46,33,8,0.9)" },
    folded: { ink: "#6d6459", rule: "#332c22", ground: "rgba(10,8,7,0.7)" },
    away: { ink: "#7d6a6a", rule: "#4a2a2a", ground: "rgba(14,8,8,0.72)" },
    allin: { ink: "#ffd0cf", rule: "#a33", ground: "rgba(48,10,12,0.9)" },
  };

export interface Plaque {
  texture: THREE.CanvasTexture;
  /** Width / height of the drawn plate, so the quad never squashes the text. */
  aspect: number;
}

const plaques = new Map<string, Plaque>();

/**
 * A rail plaque: a chip count, and a word for what the seat is doing.
 *
 * `caption` is deliberately short - "ALL IN", "FOLDED", "SB", "AWAY" - because
 * at this size on a slope two metres away, anything longer is a grey smudge
 * that costs the number its contrast.
 */
export function stackPlaque(
  stack: number,
  caption: string,
  tone: PlaqueTone,
): Plaque {
  const key = `${stack}|${caption}|${tone}`;
  const cached = plaques.get(key);
  if (cached) return cached;

  const el = document.createElement("canvas");
  el.width = PLATE_WIDTH;
  el.height = PLATE_HEIGHT;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const { ink, rule, ground } = TONES[tone];

  // A brass plate let into the leather: dark ground, bright hairline, and
  // nothing else. Anything more decorative competes with the face above it.
  ctx.fillStyle = ground;
  ctx.beginPath();
  ctx.roundRect(2, 2, PLATE_WIDTH - 4, PLATE_HEIGHT - 4, 10);
  ctx.fill();
  ctx.strokeStyle = rule;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const hasCaption = caption.length > 0;
  ctx.font = NUMERALS;
  ctx.fillStyle = ink;
  ctx.fillText(
    formatChips(stack),
    PLATE_WIDTH / 2,
    hasCaption ? PLATE_HEIGHT / 2 - 9 : PLATE_HEIGHT / 2 + 2,
  );

  if (hasCaption) {
    ctx.font = CAPTION;
    ctx.fillStyle = rule;
    ctx.fillText(caption.toUpperCase(), PLATE_WIDTH / 2, PLATE_HEIGHT - 22);
  }

  const plaque: Plaque = {
    texture: label(el),
    aspect: PLATE_WIDTH / PLATE_HEIGHT,
  };
  plaques.set(key, plaque);
  return plaque;
}

/**
 * Chip counts, at plaque size.
 *
 * Thousands are abbreviated because six figures do not fit on a plate this
 * wide without shrinking the type past legibility, and a stack is a thing you
 * read at a glance rather than audit. The exact number is always in `HandHud`,
 * which is the fallback the spec asks for.
 */
export function formatChips(amount: number): string {
  if (amount >= 10_000) return `${Math.round(amount / 1000)}K`;
  if (amount >= 1_000) {
    const thousands = amount / 1000;
    // 1.2K rather than 1K: at this range the first decimal is the difference
    // between "they can call" and "they cannot".
    return `${thousands.toFixed(thousands < 10 ? 1 : 0).replace(/\.0$/, "")}K`;
  }
  return String(Math.max(0, Math.round(amount)));
}

let button: THREE.CanvasTexture | null = null;

/** The dealer button: the one thing on the felt that shows the button moving. */
export function dealerButtonTexture(): THREE.CanvasTexture {
  if (button) return button;

  const size = 128;
  const el = document.createElement("canvas");
  el.width = size;
  el.height = size;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = "#f2ece0";
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#1b1712";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#1b1712";
  ctx.font = '700 74px "Cinzel Decorative", Georgia, serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("D", size / 2, size / 2 + 4);

  button = label(el);
  return button;
}

function label(el: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Read at a steep angle from across the table, which is exactly the case
  // mipmaps exist for; without them the digits crawl.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/**
 * Throw away everything drawn before the webfonts arrived.
 *
 * Canvas does not wait for a font: it substitutes silently and draws. So the
 * first few plaques of a session can be drawn in the fallback face while
 * `Bebas Neue` is still in flight, and - because they are cached forever -
 * they would stay that way for the rest of the evening. Clearing the cache
 * once, when `document.fonts` settles, costs six re-draws of a 320x96 canvas
 * and is the whole fix. Called from `main.tsx`.
 */
export function dropPlaqueCache(): void {
  for (const plaque of plaques.values()) plaque.texture.dispose();
  plaques.clear();
  button?.dispose();
  button = null;
}
