/**
 * Phase 5 exit-criteria check.
 *
 * Phase 5 is the phase whose exit criteria are least checkable by a script.
 * "A screenshot of the table looks like a place someone would want to hang
 * out" is a question for a person. But the two criteria under it are not
 * aesthetic at all, and they are the ones a later art pass would break
 * silently:
 *
 * 1. **Faces and cards are still the two most legible things on screen.**
 *    Mechanically: nothing that glows sits in the band of height a face
 *    occupies, and no background element moves more than the ceiling the
 *    scene declares for it.
 * 2. **The decoration never reaches the game.** The rail is now a lathed
 *    profile rather than a torus, and it has an inner radius that the cards
 *    and the chips know nothing about. Every anchor the scene draws to is
 *    replayed against it here, including the deck - which is further out than
 *    any hole card and is where every card of every hand begins.
 *
 * Plus the standing asset rule, now that this phase ships its first
 * downloaded files: every font on disk is a real woff2, is credited, and is
 * actually referenced by the stylesheet that claims to use it.
 *
 * Unlike `verify:phase4`, **nothing here needs the dev stack running.** Every
 * check is either a pure function replayed against real geometry or a file on
 * disk, which is deliberate: this is the check most likely to be run in a
 * hurry, in the middle of moving something two centimetres.
 *
 *   npm run verify:phase5
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  boardSpot,
  deckSpot,
  holeSpot,
  muckSpot,
} from "../client/src/scene/cards.ts";
import {
  CHIP_RADIUS,
  MAX_CHIPS_PER_PILE,
  betAnchor,
  chipBreakdown,
  pileLayout,
  potAnchor,
  splitAcrossPiles,
  stackAnchor,
} from "../client/src/scene/chips.ts";
import { MAX_PLAYERS, STARTING_STACK } from "@facecards/shared";
import { EYE_HEIGHT, seatLayout, TABLE } from "../client/src/scene/layout.ts";
import {
  AMBIENT_MOTION_MAX,
  FIXTURES,
  ROOM_RADIUS,
  WAINSCOT_HEIGHT,
  clearsFaceBand,
  faceBand,
  neonBreath,
} from "../client/src/scene/decor.ts";
import {
  FELT_RADIUS,
  RAIL_INNER,
  TABLE_TRIANGLE_BUDGET,
  apronProfile,
  pedestalProfile,
  profileNormal,
  railProfile,
  tableTriangles,
} from "../client/src/scene/tableProfile.ts";
import { AVATARS } from "@facecards/shared";
import {
  MAX_HEAD_PITCH,
  MAX_HEAD_YAW,
  MAX_PITCH,
  MAX_RISE,
  MAX_ROLL,
  idlePose,
  personalityFor,
} from "../client/src/avatars/idle.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${name}${detail ? `  (${detail})` : ""}`,
  );
};
const section = (title) => console.log(`\n${title}`);

// =============================================== 1. the game clears the art

section("The rail never reaches the game");

/** Furthest any corner of a card lying at `spot` gets from the table axis. */
function cardReach(spot) {
  const rightX = Math.cos(spot.yaw);
  const rightZ = -Math.sin(spot.yaw);
  const outX = Math.sin(spot.yaw);
  const outZ = Math.cos(spot.yaw);

  let worst = 0;
  for (const sw of [-1, 1]) {
    for (const sh of [-1, 1]) {
      const x =
        spot.x +
        rightX * ((sw * CARD_WIDTH) / 2) +
        outX * ((sh * CARD_HEIGHT) / 2);
      const z =
        spot.z +
        rightZ * ((sw * CARD_WIDTH) / 2) +
        outZ * ((sh * CARD_HEIGHT) / 2);
      worst = Math.max(worst, Math.hypot(x, z));
    }
  }
  return worst;
}

const fouled = [];
let worstReach = 0;
const note = (what, reach) => {
  worstReach = Math.max(worstReach, reach);
  if (reach >= FELT_RADIUS) fouled.push(`${what} at ${reach.toFixed(3)}m`);
};

for (let count = 1; count <= MAX_PLAYERS; count++) {
  for (const seat of seatLayout(count)) {
    for (const index of [0, 1]) {
      note(`hole card (${count} seats)`, cardReach(holeSpot(seat, index)));
      note(`muck (${count} seats)`, cardReach(muckSpot(seat, index)));
    }
    note(`deck (${count} seats)`, cardReach(deckSpot(seat)));

    // A whole starting stack in front of a seat, and the same amount shoved
    // out as a bet: the two widest things a seat ever puts on the felt.
    for (const [what, anchor] of [
      ["stack", stackAnchor(seat)],
      ["bet", betAnchor(seat)],
    ]) {
      const chips = pileLayout(
        chipBreakdown(STARTING_STACK, MAX_CHIPS_PER_PILE),
        anchor,
        seat.yaw,
        seat.index * 101,
      );
      for (const chip of chips) {
        note(`${what} (${count} seats)`, Math.hypot(chip.x, chip.z) + CHIP_RADIUS);
      }
    }
  }
}
for (let index = 0; index < 5; index++) {
  note("board", cardReach(boardSpot(index)));
}
// Every chip at the table in the middle at once, which is what an all-in
// six-handed pot actually is.
const wholeTable = splitAcrossPiles(
  chipBreakdown(STARTING_STACK * MAX_PLAYERS, MAX_CHIPS_PER_PILE),
);
wholeTable.forEach((pile, index) => {
  const anchor = potAnchor(index);
  for (const chip of pileLayout(pile, anchor, anchor.yaw, 7000 + index)) {
    note("pot", Math.hypot(chip.x, chip.z) + CHIP_RADIUS);
  }
});

check(
  "every card and chip the table can draw stays on the felt",
  fouled.length === 0,
  fouled.slice(0, 3).join("; "),
);
check(
  "and there is margin left over",
  FELT_RADIUS - worstReach > 0.015,
  `${((FELT_RADIUS - worstReach) * 1000).toFixed(0)}mm to the rail, worst case`,
);
check(
  "the rail starts outside the felt",
  RAIL_INNER >= FELT_RADIUS,
  `felt ${FELT_RADIUS}, rail ${RAIL_INNER}`,
);

// ================================================ 2. the table is authored

section("The table");

const crownIndex = railProfile().findIndex((p) => p.r === TABLE.radius);
check(
  "the rail's crown faces up, not at the floor",
  profileNormal(railProfile(), crownIndex).y > 0.3 &&
    profileNormal(railProfile(), crownIndex - 1).y > 0.3,
  "a profile authored the wrong way round turns the table inside out",
);
check(
  "the apron's underside faces down",
  profileNormal(apronProfile(), 0).y < -0.9,
);
check(
  "the pedestal's foot faces down",
  profileNormal(pedestalProfile(), 0).y < -0.9,
);
check(
  "the rail is a closed ring with no open edge",
  JSON.stringify(railProfile().at(0)) === JSON.stringify(railProfile().at(-1)),
);
check(
  "the hero asset is inside its triangle budget",
  tableTriangles() < TABLE_TRIANGLE_BUDGET,
  `${tableTriangles()} of ${TABLE_TRIANGLE_BUDGET} tris`,
);

// ============================================ 3. faces stay the most legible

section("Faces stay the most legible thing on screen");

const band = faceBand();
const glaring = FIXTURES.filter((f) => !clearsFaceBand(f));
check(
  "no fixture in the room glows at eye height",
  glaring.length === 0,
  glaring.map((f) => f.id).join(", ") ||
    `band ${band.low.toFixed(2)}-${band.high.toFixed(2)}m, ` +
      `${FIXTURES.length} fixtures checked`,
);
check(
  "the panelling is capped below that band",
  WAINSCOT_HEIGHT > TABLE.topY && WAINSCOT_HEIGHT < band.low,
  `cap at ${WAINSCOT_HEIGHT}m, band opens at ${band.low.toFixed(2)}m`,
);
check(
  "the room is a room around a table, not a hall",
  ROOM_RADIUS > TABLE.radius + 1 && ROOM_RADIUS < 5,
  `${ROOM_RADIUS}m radius`,
);

let breathLow = Infinity;
let breathHigh = -Infinity;
for (let t = 0; t < 7200; t += 0.1) {
  const value = neonBreath(t);
  breathLow = Math.min(breathLow, value);
  breathHigh = Math.max(breathHigh, value);
}
check(
  "background motion stays inside its declared ceiling for two hours",
  breathLow >= 1 - AMBIENT_MOTION_MAX - 1e-9 &&
    breathHigh <= 1 + AMBIENT_MOTION_MAX + 1e-9,
  `${((breathHigh - breathLow) * 100).toFixed(1)}% peak to peak, ` +
    `ceiling ${AMBIENT_MOTION_MAX * 200}%`,
);

// ================================================ 4. the idle never wanders

section("An idle never takes a face with it");

const strayed = [];
let worstYaw = 0;
for (const archetype of AVATARS) {
  const personality = personalityFor(archetype.id);
  for (let t = 0; t < 7200; t += 0.05) {
    const pose = idlePose(t, personality, archetype.id.length * 0.7);
    worstYaw = Math.max(worstYaw, Math.abs(pose.headYaw));
    if (
      Math.abs(pose.roll) > MAX_ROLL + 1e-9 ||
      Math.abs(pose.pitch) > MAX_PITCH + 1e-9 ||
      Math.abs(pose.headYaw) > MAX_HEAD_YAW + 1e-9 ||
      Math.abs(pose.headPitch) > MAX_HEAD_PITCH + 1e-9 ||
      Math.abs(pose.rise) > MAX_RISE + 1e-9
    ) {
      strayed.push(`${archetype.id} at t=${t.toFixed(2)}`);
      break;
    }
  }
}
check(
  "every archetype stays inside its bounds for a two-hour session",
  strayed.length === 0,
  strayed.slice(0, 3).join("; "),
);
check(
  "a face plane never turns far enough to foreshorten",
  Math.cos(worstYaw) > 0.98,
  `worst glance ${((worstYaw * 180) / Math.PI).toFixed(1)} degrees, ` +
    `${((1 - Math.cos(worstYaw)) * 100).toFixed(1)}% narrower`,
);
check(
  "the eye-line the layout protects is still the one the bodies hang off",
  Math.abs(seatLayout(6)[0].eyeY - EYE_HEIGHT) < 1e-9,
);

// ============================================== 5. the shipped font assets

section("Font assets");

const FONT_DIR = join(root, "client", "public", "fonts");
const fonts = readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff2"));

check("fonts ship with the client", fonts.length > 0, fonts.join(", "));

// The magic number, not the extension. A `.woff2` that is really a 404 page
// is a font that silently falls back on every machine but the one it was
// downloaded on.
const notWoff2 = fonts.filter((file) => {
  const bytes = readFileSync(join(FONT_DIR, file));
  return bytes.subarray(0, 4).toString("latin1") !== "wOF2";
});
check(
  "every font file is really a woff2",
  notWoff2.length === 0,
  notWoff2.join(", "),
);

// A latin subset of a display face is tens of kilobytes. An order of
// magnitude past that means a full multi-script family got committed.
const bloated = fonts.filter(
  (file) => statSync(join(FONT_DIR, file)).size > 120_000,
);
check(
  "no font is a whole family committed by mistake",
  bloated.length === 0,
  bloated.join(", "),
);

const credits = readFileSync(join(root, "docs", "ASSET-CREDITS.md"), "utf8");
const uncredited = fonts.filter((file) => !credits.includes(file));
check(
  "every shipped font has a row in docs/ASSET-CREDITS.md",
  uncredited.length === 0,
  uncredited.join(", "),
);

// OFL section 1 requires the notice and licence to travel with the files.
const licence = readFileSync(join(FONT_DIR, "LICENSE.txt"), "utf8");
check(
  "the SIL Open Font License ships beside them",
  licence.includes("SIL OPEN FONT LICENSE Version 1.1") &&
    licence.includes("Copyright"),
);

const css = readFileSync(join(root, "client", "src", "styles.css"), "utf8");
const unreferenced = fonts.filter((file) => !css.includes(file));
check(
  "and the stylesheet actually loads each one",
  unreferenced.length === 0,
  unreferenced.join(", "),
);

// The other direction: a `@font-face` pointing at a file that is not there is
// a fallback face on every machine and an error nobody reads.
const referenced = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map(
  (m) => m[1],
);
const dangling = referenced.filter((file) => !fonts.includes(file));
check(
  "and every font the stylesheet asks for exists",
  dangling.length === 0,
  dangling.join(", "),
);

// A CDN link would undo the point of self-hosting: a third-party request from
// every player's browser, and a race the first rail plaque loses.
const html = readFileSync(join(root, "client", "index.html"), "utf8");
check(
  "no font is fetched from a third party at runtime",
  !html.includes("fonts.googleapis.com") &&
    !html.includes("fonts.gstatic.com") &&
    !css.includes("fonts.googleapis.com") &&
    !css.includes("fonts.gstatic.com"),
);

// ---------------------------------------------------------------- result

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
