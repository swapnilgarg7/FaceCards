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
 * read in the same glance as the face. The same number in a panel in the
 * corner of the screen is read instead of a face. The standings panel keeps
 * the list, because spec section 8 wants the flat controls as a fallback - but
 * it is no longer where you find out how much someone has.
 *
 * Names stay on the body and numbers go on the table, which is a clean split:
 * who you are travels with you, what you have sits where you are sitting.
 *
 * **One canvas per seat, redrawn in place.** The obvious shape for this file
 * was a cache keyed on the number, like `namePlateTexture` is keyed on a name
 * - and it is wrong here, because a name changes once a session and a stack
 * changes on every action. A cache would grow a 320x96 RGBA texture per
 * distinct chip count for the length of an evening, and an LRU over it would
 * be worse: the six plaques actually on screen are not re-read between
 * changes, so eviction could dispose one that is still being drawn. Six
 * canvases that live as long as their seat and are repainted have no cache to
 * get wrong.
 */

const PLATE_WIDTH = 320;
const PLATE_HEIGHT = 96;

/** Width / height of the plate, so the quad never squashes the text. */
export const PLAQUE_ASPECT = PLATE_WIDTH / PLATE_HEIGHT;

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

interface Drawn {
  stack: number;
  caption: string;
  tone: PlaqueTone;
}

/**
 * One seat's plate: a canvas, the texture over it, and whatever is currently
 * painted on it.
 *
 * `attach` and `detach` rather than a constructor and a `dispose`, because
 * StrictMode mounts a component, unmounts it and mounts it again with the same
 * memoised object. A one-way dispose in that cleanup would free the texture of
 * a plate that is about to be shown, and drop it out of `live` so the webfont
 * repaint would never reach it. Attaching re-registers and re-uploads, so the
 * pair survives being run twice.
 */
export class SeatPlaque {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private drawn: Drawn | null = null;

  readonly texture: THREE.CanvasTexture;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = PLATE_WIDTH;
    this.canvas.height = PLATE_HEIGHT;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    // Read at a steep angle from across the table, which is exactly the case
    // mipmaps exist for; without them the digits crawl.
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;
  }

  /** Mounted: register for the font repaint and make sure the GPU has it. */
  attach(): void {
    live.add(this);
    this.texture.needsUpdate = true;
  }

  /** Unmounted: a seat that left the table must not keep a texture alive. */
  detach(): void {
    live.delete(this);
    this.texture.dispose();
  }

  /**
   * Paint the plate, if it is not already showing this.
   *
   * The early return matters: the effect that calls this re-runs whenever
   * anything about the table changes, and re-uploading a texture because
   * somebody on the far side of the room unmuted would be six texture uploads
   * per patch.
   */
  draw(stack: number, caption: string, tone: PlaqueTone): void {
    if (
      this.drawn &&
      this.drawn.stack === stack &&
      this.drawn.caption === caption &&
      this.drawn.tone === tone
    ) {
      return;
    }
    this.drawn = { stack, caption, tone };
    this.repaint();
  }

  /** Redraw whatever is currently showing. Used when the webfonts land. */
  refresh(): void {
    if (this.drawn) this.repaint();
  }

  private repaint(): void {
    const { stack, caption, tone } = this.drawn!;
    const ctx = this.ctx;
    const { ink, rule, ground } = TONES[tone];

    ctx.clearRect(0, 0, PLATE_WIDTH, PLATE_HEIGHT);

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

    this.texture.needsUpdate = true;
  }
}

const live = new Set<SeatPlaque>();

/**
 * Chip counts, at plaque size.
 *
 * Thousands are abbreviated because six figures do not fit on a plate this
 * wide without shrinking the type past legibility, and a stack is a thing you
 * read at a glance rather than audit. The exact number is always in the
 * standings panel, which is the fallback the spec asks for.
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
  buttonCanvas = ctx;
  paintButton(ctx, size);

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  button = texture;
  return button;
}

let buttonCanvas: CanvasRenderingContext2D | null = null;

function paintButton(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.clearRect(0, 0, size, size);

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
}

/**
 * Repaint everything that was drawn before the webfonts arrived.
 *
 * Canvas does not wait for a font: it substitutes silently and draws. So the
 * first plaques of a session can be painted in the fallback face while
 * `Bebas Neue` is still in flight, and nothing would repaint them until their
 * number happened to change. Repainting once, when `document.fonts` settles,
 * costs six 320x96 fills and is the whole fix. Called from `main.tsx`.
 */
export function repaintPlaques(): void {
  for (const plaque of live) plaque.refresh();
  if (buttonCanvas && button) {
    paintButton(buttonCanvas, buttonCanvas.canvas.width);
    button.needsUpdate = true;
  }
}
