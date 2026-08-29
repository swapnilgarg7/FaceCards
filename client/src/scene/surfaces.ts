import * as THREE from "three";
import {
  FELT_RADIUS,
  INLAY_INNER,
  INLAY_OUTER,
  RAIL_INNER,
} from "./tableProfile.js";

/**
 * Every surface in the room, drawn on a canvas rather than downloaded.
 *
 * This is the same argument `avatars/textures.ts` and `scene/cardAtlas.ts`
 * already make, applied to the one place the plan expected to lose it. Phase 5
 * budgeted for ambientCG PBR sets: felt, walnut, oxblood leather, carpet,
 * velvet. Five materials is five four-map sets, which is twenty 2K JPEGs, tens
 * of megabytes of download and a KTX2 pipeline to stop them eating VRAM - and
 * the payoff would be photographic detail on surfaces that are deliberately
 * dark, deliberately out of focus behind the faces, and never seen closer than
 * about a metre.
 *
 * Drawn, they cost no licence rows, no fetch that can 404, and - the part that
 * actually matters - they are *parameterised by the same numbers as the
 * geometry*. The betting line on the felt is drawn at a world radius the
 * layout can be asked for, so it cannot drift out of step with where bets
 * actually sit. A downloaded felt texture could not know where the bets are.
 *
 * What they do cost is time: about 280ms of measured per-pixel work, all of it
 * on the main thread. Left lazy, every millisecond of that lands the instant
 * the 3D room mounts, which is the single worst moment available. `warmSurfaces`
 * at the bottom of this file moves it into the lobby instead.
 *
 * What was genuinely lost: real measured normal and roughness maps. What
 * replaces them is fine-grained value noise baked into the albedo plus honest
 * roughness constants, which under this room's pooled key light is most of
 * the read at this distance.
 *
 * Everything here is module-cached and lives for the tab, exactly like the
 * card atlas: a fixed, small set that never churns.
 */

/* ------------------------------------------------------------------ palette
 *
 * The art direction as constants, so "rich wood, velvet, gold, neon" is a
 * thing the code says once rather than a hex literal scattered through six
 * components. `styles.css` carries the same values for the DOM side, and the
 * two are meant to be read together.
 */
export const PALETTE = {
  felt: "#0d4531",
  feltDark: "#07281c",
  feltLine: "#c9a227",
  leather: "#4a1620",
  leatherHigh: "#6b2430",
  walnut: "#3a241a",
  walnutGrain: "#25150e",
  brass: "#c9a227",
  brassDark: "#7d631a",
  carpet: "#2a1119",
  carpetFigure: "#3d1a24",
  velvet: "#2b1522",
  velvetNap: "#3a1d2d",
  neonPink: "#ff4d8d",
  neonBlue: "#3aa0ff",
  lampWarm: "#ffdca8",
} as const;

/* -------------------------------------------------------------------- noise
 *
 * Deterministic value noise. No `Math.random`: two clients drawing the same
 * felt should get the same felt, for the same reason every chip's wobble is
 * seeded rather than random. Nobody can see the difference in a single
 * screenshot, and it means a texture is a pure function of the code that
 * draws it, which is the only reason any of this is reviewable.
 */
function hash(x: number, y: number): number {
  // Integer bit-mixing rather than the `fract(sin(dot(...)))` every shader
  // tutorial uses. That form costs a `Math.sin` per lattice corner, which is
  // sixteen transcendentals per pixel at four octaves - measured at 557ms to
  // draw this file's textures, against 396ms for the same noise mixed with
  // shifts and multiplies. Same distribution, same look, no trig.
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  // Smoothstep on both axes: linear interpolation between lattice values
  // leaves visible diamonds at this contrast.
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Several octaves of `smoothNoise`, normalised to roughly 0..1. */
function fbm(x: number, y: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let total = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / total;
}

/**
 * Edge of every tiled swatch.
 *
 * 256 rather than 512, which is a quarter of the pixels and therefore a
 * quarter of the noise. These are *tiled* - the leather repeats eighteen times
 * around the rail, the carpet eight times across the floor - so what the size
 * sets is texel density per tile, and at 256 that is already finer than the
 * felt, which is the surface closest to anybody's eye.
 */
const TILE = 256;

function context(width: number, height: number): CanvasRenderingContext2D {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return ctx;
}

/**
 * Per-pixel grain laid over whatever is already on the canvas.
 *
 * Done as a screen-space pass over `ImageData` rather than as thousands of
 * tiny `fillRect` calls, which is the difference between four milliseconds and
 * four hundred.
 */
function grain(
  ctx: CanvasRenderingContext2D,
  scale: number,
  strength: number,
  octaves = 3,
  stretchX = 1,
): void {
  const { width, height } = ctx.canvas;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = fbm((x / width) * scale * stretchX, (y / height) * scale, octaves);
      const delta = (n - 0.5) * 2 * strength * 255;
      const i = (y * width + x) * 4;
      data[i] = clampByte(data[i]! + delta);
      data[i + 1] = clampByte(data[i + 1]! + delta);
      data[i + 2] = clampByte(data[i + 2]! + delta);
    }
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function colourTexture(
  ctx: CanvasRenderingContext2D,
  repeat: [number, number] = [1, 1],
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return texture;
}

/* --------------------------------------------------------------------- felt
 *
 * The one texture that is not tiled. A `CircleGeometry` maps its disc into the
 * unit square, so a single 1024px image is the whole playing surface at about
 * 1.8mm per pixel - and, crucially, it means the drawing can be done in *world
 * radii*. `ringUV` is the conversion, and it is what lets the betting line be
 * placed by asking the layout where bets sit rather than by eye.
 */
const FELT_PIXELS = 1024;

/** World metres to a radius in this texture's pixels. */
function feltPixels(worldRadius: number): number {
  return (worldRadius / FELT_RADIUS) * (FELT_PIXELS / 2);
}

/**
 * The betting line: the arc a real table draws between a player's own space
 * and the pot's.
 *
 * Placed between where a stack sits (`stackAnchor`, 0.72 out) and where a bet
 * lands (`betAnchor`, 0.52 out), so chips genuinely cross it when they are
 * pushed forward. That is the whole meaning of the line, and it only holds
 * because this number and those anchors are in the same units.
 */
export const BETTING_LINE_RADIUS = 0.62;
/** A second, fainter race framing the board and the pot in the middle. */
export const CENTRE_RING_RADIUS = 0.4;

let felt: THREE.CanvasTexture | null = null;

export function feltTexture(): THREE.CanvasTexture {
  if (felt) return felt;

  const ctx = context(FELT_PIXELS, FELT_PIXELS);
  const centre = FELT_PIXELS / 2;

  // Base, with a pooled falloff baked in: the middle of the table is where the
  // light hangs, and a flat green disc reads as paper.
  const wash = ctx.createRadialGradient(
    centre,
    centre,
    0,
    centre,
    centre,
    centre,
  );
  wash.addColorStop(0, PALETTE.felt);
  wash.addColorStop(0.62, PALETTE.felt);
  wash.addColorStop(1, PALETTE.feltDark);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, FELT_PIXELS, FELT_PIXELS);

  // Two scales of fibre: a coarse cloudiness that reads as nap, and a fine
  // speckle that stops the surface looking like a gradient.
  grain(ctx, 26, 0.06, 4);
  grain(ctx, 340, 0.035, 1);

  const race = (worldRadius: number, width: number, alpha: number) => {
    ctx.save();
    ctx.strokeStyle = PALETTE.feltLine;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(centre, centre, feltPixels(worldRadius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  race(BETTING_LINE_RADIUS, 3, 0.5);
  race(BETTING_LINE_RADIUS - 0.012, 1.5, 0.22);
  race(CENTRE_RING_RADIUS, 1.5, 0.16);

  // The felt's own edge, darkened where it tucks under the rail, so the seam
  // reads as cloth going under leather rather than as two discs meeting.
  const tuck = ctx.createRadialGradient(
    centre,
    centre,
    feltPixels(FELT_RADIUS - 0.06),
    centre,
    centre,
    centre,
  );
  tuck.addColorStop(0, "rgba(0,0,0,0)");
  tuck.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = tuck;
  ctx.fillRect(0, 0, FELT_PIXELS, FELT_PIXELS);

  felt = colourTexture(ctx);
  felt.wrapS = THREE.ClampToEdgeWrapping;
  felt.wrapT = THREE.ClampToEdgeWrapping;
  return felt;
}

/* ------------------------------------------------------------------ leather,
 * wood, carpet, velvet. All tiled, all lathe- or plane-mapped.
 */

let leather: THREE.CanvasTexture | null = null;

/** Pebbled oxblood, for the padded rail. */
export function leatherTexture(): THREE.CanvasTexture {
  if (leather) return leather;

  const ctx = context(TILE, TILE);
  ctx.fillStyle = PALETTE.leather;
  ctx.fillRect(0, 0, TILE, TILE);

  // The pebble itself: bright specks on a dark ground at a scale where the
  // eye reads grain rather than dots.
  grain(ctx, 90, 0.14, 2);
  grain(ctx, 300, 0.06, 1);

  // A broad highlight sweep, so the rail is not uniformly matte all the way
  // round. Leather is the one surface at this table anyone actually touches.
  const sheen = ctx.createLinearGradient(0, 0, 0, TILE);
  sheen.addColorStop(0, "rgba(0,0,0,0.3)");
  sheen.addColorStop(0.5, `${PALETTE.leatherHigh}22`);
  sheen.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, TILE, TILE);

  leather = colourTexture(ctx, [18, 1]);
  return leather;
}

let wood: THREE.CanvasTexture | null = null;

/** Walnut grain, for the apron and the panelling. */
export function woodTexture(): THREE.CanvasTexture {
  if (wood) return wood;

  const ctx = context(TILE, TILE);
  ctx.fillStyle = PALETTE.walnut;
  ctx.fillRect(0, 0, TILE, TILE);

  // Grain lines: noise sampled hugely stretched along one axis, then
  // thresholded into rings. Cheaper and more convincing than drawing curves.
  const image = ctx.getImageData(0, 0, TILE, TILE);
  const data = image.data;
  const dark = new THREE.Color(PALETTE.walnutGrain);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const warp = fbm((x / TILE) * 3, (y / TILE) * 0.4, 3);
      const rings = Math.abs(Math.sin((x / TILE) * 26 + warp * 5.5));
      const mix = Math.pow(1 - rings, 3) * 0.7;
      const i = (y * TILE + x) * 4;
      data[i] = clampByte(data[i]! * (1 - mix) + dark.r * 255 * mix);
      data[i + 1] = clampByte(data[i + 1]! * (1 - mix) + dark.g * 255 * mix);
      data[i + 2] = clampByte(data[i + 2]! * (1 - mix) + dark.b * 255 * mix);
    }
  }
  ctx.putImageData(image, 0, 0);
  grain(ctx, 260, 0.045, 1, 0.25);

  wood = colourTexture(ctx, [10, 1]);
  return wood;
}

let carpet: THREE.CanvasTexture | null = null;

/**
 * Patterned carpet, for the floor.
 *
 * Deliberately low contrast and deliberately dark. A casino carpet in real
 * life is loud because it has to hide wear across an acre; here there is one
 * table and six faces, and a loud floor is six faces you are not looking at.
 */
export function carpetTexture(): THREE.CanvasTexture {
  if (carpet) return carpet;

  const ctx = context(TILE, TILE);
  ctx.fillStyle = PALETTE.carpet;
  ctx.fillRect(0, 0, TILE, TILE);

  // A quatrefoil lattice, drawn once and tiled. Faint enough that it is
  // texture from a seat and pattern only if you go and look.
  ctx.strokeStyle = PALETTE.carpetFigure;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = TILE / 57;
  for (let gx = 0; gx <= 2; gx++) {
    for (let gy = 0; gy <= 2; gy++) {
      const cx = (gx * TILE) / 2;
      const cy = (gy * TILE) / 2;
      for (let lobe = 0; lobe < 4; lobe++) {
        const angle = (lobe * Math.PI) / 2;
        ctx.beginPath();
        ctx.arc(
          cx + Math.cos(angle) * (TILE * 0.242),
          cy + Math.sin(angle) * (TILE * 0.242),
          TILE * 0.242,
          angle + Math.PI * 0.55,
          angle + Math.PI * 1.45,
        );
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;

  grain(ctx, 200, 0.07, 2);

  carpet = colourTexture(ctx, [8, 8]);
  return carpet;
}

let velvet: THREE.CanvasTexture | null = null;

/** Velvet wall covering: vertical nap, so the wall reads as fabric. */
export function velvetTexture(): THREE.CanvasTexture {
  if (velvet) return velvet;

  const ctx = context(TILE, TILE);
  ctx.fillStyle = PALETTE.velvet;
  ctx.fillRect(0, 0, TILE, TILE);

  // Stretched hard along Y: nap runs the way the cloth hangs.
  grain(ctx, 120, 0.1, 3, 12);
  grain(ctx, 420, 0.04, 1, 6);

  // Panel seams, at the pilaster spacing, so the wall covering and the joinery
  // agree with each other.
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = TILE / 85;
  for (const x of [0, TILE / 2, TILE]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TILE);
    ctx.stroke();
  }

  velvet = colourTexture(ctx, [4, 1]);
  return velvet;
}

/* -------------------------------------------------------------------- chips
 *
 * One texture for every chip, and one draw call for all of them, which is the
 * project rule. The trick is the same one `cardGeometry` uses: rather than
 * swapping a texture per denomination, the cylinder's own UVs are rewritten so
 * the caps sample the left half of this image and the side samples the right.
 *
 * It is drawn in **greys**, because `ChipField` tints each instance with that
 * denomination's colour and a `map` multiplies. So the edge spots are a
 * brighter shade of the chip's own hue rather than the white of a real casino
 * chip - the one thing about this that a photograph would not agree with. The
 * alternative was a per-instance UV attribute and a shader patch to select a
 * pre-coloured row, which is a lot of fragility across three.js versions for a
 * detail on a two-centimetre object seen from a metre away.
 */
const CHIP_TEXTURE_WIDTH = 512;
const CHIP_TEXTURE_HEIGHT = 256;
/** Edge spots, and the same count of them on the face. */
export const CHIP_SPOTS = 6;

let chip: THREE.CanvasTexture | null = null;

export function chipTexture(): THREE.CanvasTexture {
  if (chip) return chip;

  const ctx = context(CHIP_TEXTURE_WIDTH, CHIP_TEXTURE_HEIGHT);
  const half = CHIP_TEXTURE_WIDTH / 2;

  // --- left half: the face, mapped onto both caps.
  const centre = half / 2;
  const mid = CHIP_TEXTURE_HEIGHT / 2;
  const radius = CHIP_TEXTURE_HEIGHT / 2;

  ctx.fillStyle = "#b4b4b4";
  ctx.fillRect(0, 0, half, CHIP_TEXTURE_HEIGHT);

  // The inlay: a lighter disc in the middle, which is what a real chip's
  // printed centre is, and the ring of spots around it.
  ctx.save();
  ctx.beginPath();
  ctx.arc(centre, mid, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = "#8f8f8f";
  ctx.beginPath();
  ctx.arc(centre, mid, radius * 0.74, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < CHIP_SPOTS * 2; i++) {
    const angle = (i / (CHIP_SPOTS * 2)) * Math.PI * 2;
    ctx.save();
    ctx.translate(
      centre + Math.cos(angle) * radius * 0.87,
      mid + Math.sin(angle) * radius * 0.87,
    );
    ctx.rotate(angle);
    ctx.fillRect(-radius * 0.11, -radius * 0.055, radius * 0.22, radius * 0.11);
    ctx.restore();
  }

  ctx.fillStyle = "#cfcfcf";
  ctx.beginPath();
  ctx.arc(centre, mid, radius * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#6d6d6d";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(centre, mid, radius * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // --- right half: the edge, wrapped once around the rim.
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(half, 0, half, CHIP_TEXTURE_HEIGHT);
  ctx.fillStyle = "#f2f2f2";
  const spotWidth = half / (CHIP_SPOTS * 2);
  for (let i = 0; i < CHIP_SPOTS; i++) {
    ctx.fillRect(half + i * spotWidth * 2, 0, spotWidth, CHIP_TEXTURE_HEIGHT);
  }
  // Rolled top and bottom rims, so a stack shows lines between chips.
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(half, 0, half, 18);
  ctx.fillRect(half, CHIP_TEXTURE_HEIGHT - 18, half, 18);

  chip = colourTexture(ctx);
  chip.wrapS = THREE.ClampToEdgeWrapping;
  chip.wrapT = THREE.ClampToEdgeWrapping;
  return chip;
}

/**
 * A chip cylinder whose caps sample the face half of `chipTexture` and whose
 * side samples the edge half.
 *
 * `CylinderGeometry` gives the side `(theta, height)` UVs over the whole unit
 * square and gives each cap a disc inscribed in the same square, so out of the
 * box the two designs would sit on top of each other. Squeezing each into its
 * own half is four lines and keeps every chip in the room on one material.
 */
const chipGeometries = new Map<string, THREE.CylinderGeometry>();

export function chipGeometry(
  radius: number,
  thickness: number,
  segments: number,
): THREE.CylinderGeometry {
  // Cached like the card geometries: the chip field re-renders on every patch
  // of every hand, and building a fresh cylinder each time would leak a GPU
  // buffer per render for a shape that never changes.
  const key = `${radius}:${thickness}:${segments}`;
  const cached = chipGeometries.get(key);
  if (cached) return cached;

  const geometry = new THREE.CylinderGeometry(
    radius,
    radius,
    thickness,
    segments,
  );
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;

  // Which vertices are cap and which are side is read off the normals rather
  // than off the geometry's groups: a group is a range of the *index* buffer,
  // not of the attributes, and using one as a vertex range is a bug that shows
  // up as a chip with a smear across its face. A cap normal points along Y and
  // a side normal is horizontal, which is unambiguous for a cylinder.
  for (let i = 0; i < uv.count; i++) {
    const cap = Math.abs(normal.getY(i)) > 0.5;
    // Caps into the left (face) half, the side into the right (edge) half.
    uv.setX(i, cap ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
  }
  uv.needsUpdate = true;
  chipGeometries.set(key, geometry);
  return geometry;
}

/* --------------------------------------------------------------------- glow
 *
 * The plan asked for "emissive geometry plus bloom". This is the emissive
 * geometry plus a *sprite*, and the swap is deliberate.
 *
 * A real bloom pass means `postprocessing` and an `EffectComposer`, which
 * means the scene stops being rendered straight to the default framebuffer -
 * and with it goes the MSAA that is currently making every card edge and every
 * face plane clean. Getting that back costs an SMAA pass, so the bill is two
 * full-screen passes plus a bright-pass and its blur chain, on a laptop GPU
 * already carrying six video textures, to a 60 FPS target.
 *
 * And the thing bloom would do best is the thing this scene must not do:
 * bloom is a *screen-space* effect, so it cannot tell a neon tube from a
 * webcam highlight on somebody's forehead. Every bright face in the room would
 * start to glow. A glow sprite puts the halo exactly where a fixture is and
 * nowhere else, costs one transparent quad each, and is checked against the
 * face band in `decor.ts`.
 */
let glow: THREE.CanvasTexture | null = null;

export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;

  const size = 256;
  const ctx = context(size, size);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  // Not a linear falloff: a real bloom kernel has a bright tight core and a
  // long tail, and a straight ramp reads as a painted disc.
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.24)");
  gradient.addColorStop(0.65, "rgba(255,255,255,0.06)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  glow = texture;
  return glow;
}

const ringGlows = new Map<string, THREE.CanvasTexture>();

/**
 * A glow whose bright line is a *ring* rather than a point.
 *
 * The table's neon race and the room's floor cove are both tubes seen almost
 * edge-on from a seated eye-line, where a tube is a hairline and the thing you
 * actually read is the light it throws on the surface below it. That spill is
 * an annulus, so it gets an annular gradient on a flat disc: peak alpha at
 * `peak` of the disc's radius, falling away on both sides.
 *
 * `peak` is a fraction of the drawn disc, so the caller converts from world
 * radii once and the texture stays a pure function of one number.
 */
export function ringGlowTexture(peak: number): THREE.CanvasTexture {
  const key = peak.toFixed(3);
  const cached = ringGlows.get(key);
  if (cached) return cached;

  const size = 256;
  const ctx = context(size, size);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  // Inside the ring the spill is broad and weak; outside it falls off fast,
  // because outside is where the fixture's own housing is.
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(Math.max(0, peak - 0.42), "rgba(255,255,255,0.05)");
  gradient.addColorStop(Math.max(0, peak - 0.14), "rgba(255,255,255,0.38)");
  gradient.addColorStop(peak, "rgba(255,255,255,1)");
  gradient.addColorStop(Math.min(1, peak + 0.1), "rgba(255,255,255,0.3)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  ringGlows.set(key, texture);
  return texture;
}

let contact: THREE.CanvasTexture | null = null;

/**
 * Baked contact shadow: the dark pool a heavy object sits in.
 *
 * `plan.md` asks for baked AO wherever possible, and this is the one place it
 * buys the most. A real shadow map cast from the pendant onto the floor under
 * a table nobody can see under is pure cost; a painted gradient is free, never
 * flickers, and is what actually makes the table read as standing on the floor
 * rather than hovering a centimetre above it.
 */
export function contactShadowTexture(): THREE.CanvasTexture {
  if (contact) return contact;

  const size = 256;
  const ctx = context(size, size);
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.82)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(ctx.canvas);
  // Read as coverage, not colour: an sRGB curve through an alpha ramp gives a
  // shadow with a visible edge where it should be dissolving.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  contact = texture;
  return contact;
}

/* ---------------------------------------------------------------- materials
 *
 * Shared instances, so six avatars and one table are not seven copies of the
 * same shader program. Roughness and metalness are the honest half of the PBR
 * set the drawn textures replace, and they are where most of the material read
 * actually comes from at this distance.
 */
const materials = new Map<string, THREE.Material>();

function cache<T extends THREE.Material>(key: string, build: () => T): T {
  const existing = materials.get(key);
  if (existing) return existing as T;
  const material = build();
  materials.set(key, material);
  return material;
}

export function feltMaterial(): THREE.MeshStandardMaterial {
  return cache(
    "felt",
    () =>
      new THREE.MeshStandardMaterial({
        map: feltTexture(),
        // Cloth. Nothing on this table is less shiny.
        roughness: 0.97,
        metalness: 0,
      }),
  );
}

export function leatherMaterial(): THREE.MeshStandardMaterial {
  return cache(
    "leather",
    () =>
      new THREE.MeshStandardMaterial({
        map: leatherTexture(),
        // Polished by forearms. The rail is where the pooled light gets its
        // one specular highlight, and that highlight is most of what makes the
        // table read as a solid object rather than a painted disc.
        roughness: 0.42,
        metalness: 0.02,
      }),
  );
}

export function woodMaterial(darken = 1): THREE.MeshStandardMaterial {
  return cache(
    `wood:${darken}`,
    () =>
      new THREE.MeshStandardMaterial({
        map: woodTexture(),
        color: new THREE.Color(0xffffff).multiplyScalar(darken),
        roughness: 0.55,
        metalness: 0.04,
      }),
  );
}

export function brassMaterial(): THREE.MeshStandardMaterial {
  return cache(
    "brass",
    () =>
      new THREE.MeshStandardMaterial({
        color: PALETTE.brass,
        // The only genuinely metallic thing in the room, which is what makes
        // it read as gold rather than as a yellow line.
        metalness: 0.92,
        roughness: 0.24,
      }),
  );
}

export function carpetMaterial(): THREE.MeshStandardMaterial {
  return cache(
    "carpet",
    () =>
      new THREE.MeshStandardMaterial({
        map: carpetTexture(),
        roughness: 1,
        metalness: 0,
      }),
  );
}

export function velvetMaterial(): THREE.MeshStandardMaterial {
  return cache(
    "velvet",
    () =>
      new THREE.MeshStandardMaterial({
        map: velvetTexture(),
        roughness: 0.92,
        metalness: 0,
        side: THREE.BackSide,
      }),
  );
}

/**
 * A neon tube: unlit, full colour, never tone-mapped down.
 *
 * `toneMapped: false` is the whole trick. ACES filmic will happily roll a
 * saturated pink off to white, which is exactly what a neon tube must not do;
 * opting the emissive geometry out of it keeps the colour and lets the glow
 * sprite provide the bloom.
 */
export function neonMaterial(colour: string): THREE.MeshBasicMaterial {
  return cache(
    `neon:${colour}`,
    () =>
      new THREE.MeshBasicMaterial({
        color: colour,
        toneMapped: false,
      }),
  );
}

/** The halo around a neon tube or a lamp. Additive, so it lights, never darkens. */
export function glowMaterial(colour: string): THREE.MeshBasicMaterial {
  return cache(
    `glow:${colour}`,
    () =>
      new THREE.MeshBasicMaterial({
        color: colour,
        map: glowTexture(),
        transparent: true,
        blending: THREE.AdditiveBlending,
        // A halo is light in the air: it must not occlude what is behind it,
        // and two overlapping halos must not fight over which is in front.
        depthWrite: false,
        toneMapped: false,
      }),
  );
}

/** The annular spill a neon race throws on the surface under it. */
export function ringGlowMaterial(
  colour: string,
  peak: number,
): THREE.MeshBasicMaterial {
  return cache(
    `ringglow:${colour}:${peak.toFixed(3)}`,
    () =>
      new THREE.MeshBasicMaterial({
        color: colour,
        map: ringGlowTexture(peak),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
  );
}

/** A painted contact shadow. Darkens what is behind it and nothing else. */
export function contactShadowMaterial(
  opacity: number,
): THREE.MeshBasicMaterial {
  return cache(
    `contact:${opacity}`,
    () =>
      new THREE.MeshBasicMaterial({
        color: "#000000",
        alphaMap: contactShadowTexture(),
        transparent: true,
        opacity,
        depthWrite: false,
      }),
  );
}

/**
 * Draw everything, one texture per turn of the event loop.
 *
 * Every builder above is lazy, which on its own means the whole 280ms lands
 * synchronously on the first render of `PokerTable` and `RoomShell` - a visible
 * freeze at exactly the moment the room appears, which is the frame a player
 * judges the whole product on.
 *
 * So this is called from `main.tsx` while the lobby is on screen. The lobby is
 * a form somebody is typing a name into for several seconds and has no
 * animation to stutter, so the work is free there. Chained through `setTimeout`
 * rather than run in one block so the browser can paint between textures, and
 * ordered cheapest-first so that a player who joins immediately still gets the
 * small ones for nothing.
 *
 * Not a worker with an `OffscreenCanvas`, which would be the textbook answer:
 * these draw text, gradients and `roundRect` through the same 2D API, and
 * moving them would mean a second code path for a browser matrix that is not
 * pinned down until phase 6. Deferring gets the same result today.
 *
 * Idempotent - every builder returns its cache - so calling it twice, or
 * calling it after the room has already built something, costs nothing. Returns
 * a cancel function for the case where the tab is closed mid-warm.
 */
export function warmSurfaces(): () => void {
  const queue = [
    glowTexture,
    contactShadowTexture,
    chipTexture,
    woodTexture,
    carpetTexture,
    leatherTexture,
    velvetTexture,
    // Last, and on its own: a 1024px disc is more per-pixel work than every
    // other texture in this file put together.
    feltTexture,
  ];

  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const step = () => {
    const build = queue[index++];
    if (!build) return;
    try {
      build();
    } catch {
      // No 2D context - a headless or hardened browser. The room will try
      // again on its own and fail the same way, visibly, which is the right
      // place for it to surface.
      return;
    }
    timer = setTimeout(step, 0);
  };
  timer = setTimeout(step, 0);

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    index = queue.length;
  };
}

/** Where the felt's own inlay ring sits, in world radii. */
export const INLAY = {
  inner: INLAY_INNER,
  outer: INLAY_OUTER,
  /** Just proud of the felt, so it catches the key light without z-fighting. */
  lift: 0.0012,
  /** Under the rail's inner lip, so the two meet without a gap. */
  railInner: RAIL_INNER,
} as const;

/* ---------------------------------------------------------------- portrait
 *
 * The one texture in this file that is a file.
 *
 * Everything above is drawn because a downloaded surface would cost a licence
 * row and could not be parameterised by the geometry. A portrait is neither of
 * those things: it is a photograph, it has to *be* the photograph, and there
 * is nothing to parameterise. So it loads, and the room draws black where it
 * goes until it arrives - which is a ceiling in a dark room, so nobody sees
 * the gap.
 *
 * Module-cached and never disposed, like every other texture here: eight
 * medallions share one image and one upload.
 */
let portrait: THREE.Texture | null = null;

export function portraitTexture(): THREE.Texture {
  if (portrait) return portrait;
  const texture = new THREE.TextureLoader().load("/textures/ravi.jpg");
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  // Seen from four metres away at a glancing angle, so the mips do all the
  // work and the top level is never sampled. 447px is already more than the
  // medallion is ever drawn at.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  portrait = texture;
  return portrait;
}
