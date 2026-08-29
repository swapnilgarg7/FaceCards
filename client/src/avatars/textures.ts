import * as THREE from "three";

/**
 * Small textures drawn on a canvas rather than downloaded.
 *
 * Nothing here needs an asset, a licence row or a network round trip, and the
 * shape masks are shared by every avatar in the room: one 256px oval serves
 * six face planes. Generating them per-avatar instead would mean six of each
 * in VRAM and six more every time somebody rejoins.
 *
 * Module-level caches deliberately outlive every component. They are a fixed,
 * tiny set that exists for the lifetime of the tab, so they are never
 * disposed; the per-peer video textures, which genuinely do churn, are
 * disposed in `useFaceTexture`.
 */

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement("canvas");
  el.width = size;
  el.height = size;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return [el, ctx];
}

function mask(el: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(el);
  // An alpha map is read as raw coverage, not as colour. Tagging it sRGB
  // would put a gamma curve through the feathered edge.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

let faceMask: THREE.CanvasTexture | null = null;

/**
 * Soft-edged circle. The face plane is a square carrying a square crop of a
 * webcam frame; this is what makes it read as a head rather than a television.
 *
 * Radius 118 of a possible 128, so the blur has somewhere to land: a feather
 * that runs off the edge of the canvas comes back as a hard line down the side
 * of every face, because the mask is clamped rather than repeated. The ten
 * pixels left over are about a centimetre of skull showing round the face,
 * which is what stops the disc reading as a badge pinned to a head.
 */
export function faceMaskTexture(): THREE.CanvasTexture {
  if (faceMask) return faceMask;

  const [el, ctx] = canvas(256);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 256, 256);
  // Feathered so the edge dissolves into the head instead of cutting it.
  ctx.filter = "blur(8px)";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();

  faceMask = mask(el);
  return faceMask;
}

let ringMask: THREE.CanvasTexture | null = null;

/**
 * Halo behind the face, lit while that player is talking.
 *
 * A ring now rather than an ellipse, and sized to straddle the edge of the
 * skull rather than to bound the old oval: on a plane `HALO_SCALE` larger than
 * the face, 112 of 128 lands just outside a head of `HEAD_RADIUS`. It reads as
 * a glow coming off the head instead of a second, larger outline floating
 * around it.
 */
export function speakingRingTexture(): THREE.CanvasTexture {
  if (ringMask) return ringMask;

  const [el, ctx] = canvas(256);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 256, 256);
  ctx.filter = "blur(7px)";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();

  ringMask = mask(el);
  return ringMask;
}

let muteGlyph: THREE.CanvasTexture | null = null;

/** Mic with a slash. Sits on the avatar's chest (spec section 7). */
export function muteGlyphTexture(): THREE.CanvasTexture {
  if (muteGlyph) return muteGlyph;

  const [el, ctx] = canvas(128);
  ctx.clearRect(0, 0, 128, 128);

  ctx.fillStyle = "#12151b";
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#ff8080";
  ctx.fillStyle = "#ff8080";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";

  // Capsule body.
  ctx.beginPath();
  ctx.roundRect(53, 30, 22, 40, 11);
  ctx.fill();
  // Cradle and stand.
  ctx.beginPath();
  ctx.arc(64, 62, 20, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(64, 82);
  ctx.lineTo(64, 96);
  ctx.stroke();
  // Slash.
  ctx.beginPath();
  ctx.moveTo(34, 30);
  ctx.lineTo(94, 98);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  muteGlyph = texture;
  return muteGlyph;
}

export interface NamePlate {
  texture: THREE.CanvasTexture;
  /** Width / height of the drawn plate, so the quad never squashes the text. */
  aspect: number;
}

const NAME_PLATE_HEIGHT = 64;
const NAME_PLATE_PADDING = 22;

const namePlates = new Map<string, NamePlate>();

/**
 * A name label, drawn once per distinct name and shared by every avatar
 * showing it. Names change on the order of once a session, so the cache never
 * grows meaningfully; a `Text` component would pull in a font loader and a
 * network fetch to do less.
 */
export function namePlateTexture(name: string): NamePlate {
  const cached = namePlates.get(name);
  if (cached) return cached;

  const font = "600 34px ui-sans-serif, system-ui, -apple-system, sans-serif";
  const [, measureCtx] = canvas(8);
  measureCtx.font = font;
  const textWidth = Math.ceil(measureCtx.measureText(name).width);

  const width = Math.max(96, textWidth + NAME_PLATE_PADDING * 2);
  const el = document.createElement("canvas");
  el.width = width;
  el.height = NAME_PLATE_HEIGHT;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  ctx.fillStyle = "rgba(16, 19, 25, 0.82)";
  ctx.beginPath();
  ctx.roundRect(0, 0, width, NAME_PLATE_HEIGHT, 14);
  ctx.fill();

  ctx.font = font;
  ctx.fillStyle = "#e7e9ee";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, width / 2, NAME_PLATE_HEIGHT / 2 + 1);

  const texture = new THREE.CanvasTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const plate: NamePlate = { texture, aspect: width / NAME_PLATE_HEIGHT };
  namePlates.set(name, plate);
  return plate;
}
