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

let turnMarker: THREE.CanvasTexture | null = null;

/**
 * The "this player is on the clock" marker, floating over their head.
 *
 * An alpha mask rather than a coloured glyph, so the material can carry the
 * brass and the marker belongs to the same palette as the rail plaque and the
 * standings row that say the same thing. All three are brass on purpose: it is
 * one piece of information, and giving it three colours would make it three.
 *
 * The shape is what separates it from the speaking halo, which is the other
 * thing that lights up on a head. That is a soft ring *behind the face*; this
 * is a hard caret *above the skull*, pointing down at whose turn it is. Two
 * signals that can both be true at once have to differ in form, not in hue,
 * because from four metres away a player reads shape long before they read a
 * shade of gold.
 *
 * Drawn pointing down the +Y of the texture, which is down the screen: the
 * quad it lands on is billboarded upright, so the caret points at the head
 * underneath it from wherever you happen to be sitting.
 */
export function turnMarkerTexture(): THREE.CanvasTexture {
  if (turnMarker) return turnMarker;

  const [el, ctx] = canvas(128);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 128, 128);

  // A soft pool behind the glyph, so the caret reads against a dark jacket
  // and a lit felt alike rather than only against one of them.
  const pool = ctx.createRadialGradient(64, 58, 4, 64, 58, 62);
  pool.addColorStop(0, "rgba(255,255,255,0.5)");
  pool.addColorStop(0.55, "rgba(255,255,255,0.16)");
  pool.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, 128, 128);

  // The caret. Feathered by a couple of pixels for the same reason the face
  // mask is: a hard edge on a quad this small aliases into a sparkle as the
  // head moves under it.
  ctx.filter = "blur(2px)";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(30, 34);
  ctx.lineTo(98, 34);
  ctx.lineTo(64, 100);
  ctx.closePath();
  ctx.fill();
  // Hollowed out, so it reads as a chevron rather than as a blob at distance.
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(48, 46);
  ctx.lineTo(80, 46);
  ctx.lineTo(64, 78);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  turnMarker = mask(el);
  return turnMarker;
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
