/**
 * Phase 4 exit-criteria check.
 *
 * Phase 4 is mostly a thing you judge by sitting in it: whether a peek feels
 * like lifting the corner of a card, and whether pushing chips beats clicking
 * Call, are questions for a person and not for a script. What a script *can*
 * prove is the half underneath, and it is the half that would rot silently:
 *
 * 1. **The picture never disagrees with the numbers.** Chips are a drawing of
 *    a stack, a bet and a pot the server owns. Every patch of a real hand is
 *    run through the layout the scene uses, and the chips it produces are
 *    added back up. This is the check that caught the odd chip from a split
 *    pot, which no hand-written fixture had.
 * 2. **No gesture can aim at an illegal action.** For every decision the
 *    server put on the clock, every rung of the chip-push ladder is checked
 *    against the legality flags that same patch published.
 * 3. **No card mesh holds a value the server did not send.** Every patch, for
 *    every seat that is not ours, the atlas slot the scene would build is the
 *    face-down one.
 * 4. **Every sound the table can ask for actually ships, and is credited.**
 *    The manifest, the files on disk, and `docs/ASSET-CREDITS.md` have to
 *    agree in all three directions, or the table plays a hand in silence in
 *    production and nowhere else.
 *
 * Section 4 needs nothing running. Sections 1 to 3 need the dev stack up:
 *   npm run dev
 *   npm run verify:phase4
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import {
  PAYOUT_DISPLAY_MS,
  PokerAction,
  ROOM_NAME,
  ClientMessage,
  TablePhase,
} from "@facecards/shared";
import {
  chipBreakdown,
  chipValue,
  betAnchor,
  pileLayout,
  potAnchor,
  splitAcrossPiles,
  stackAnchor,
} from "../client/src/scene/chips.ts";
import { assignChips } from "../client/src/scene/chipPool.ts";
import { cardIndex } from "../client/src/scene/cards.ts";
import { BACK_SLOT } from "../client/src/scene/cardAtlas.ts";
import { assignSeats, TABLE } from "../client/src/scene/layout.ts";
import { betLadder } from "../client/src/ui/betLadder.ts";
import { soundFiles, SOUNDS } from "../client/src/audio/sounds.ts";
import { tableCues } from "../client/src/audio/cues.ts";

const HTTP = process.env.VERIFY_HTTP_URL ?? "http://localhost:2567";
const WS = process.env.VERIFY_WS_URL ?? "ws://localhost:2567";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(
    `${pass ? "  ok  " : " FAIL "} ${name}${detail ? `  (${detail})` : ""}`,
  );
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const section = (title) => console.log(`\n${title}`);
const waitFor = async (predicate, timeoutMs, label = "condition") => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(80);
  }
  console.log(`        timed out waiting for ${label}`);
  return false;
};

// ================================================== the shipped sound assets

section("Sound assets");

const AUDIO_DIR = join(root, "client", "public", "audio");
const wanted = soundFiles();
const onDisk = readdirSync(AUDIO_DIR).filter((f) => f.endsWith(".ogg"));

const missing = wanted.filter((file) => !onDisk.includes(file));
check(
  "every sound the table can ask for is on disk",
  missing.length === 0,
  missing.join(", "),
);

const orphans = onDisk.filter((file) => !wanted.includes(file));
check(
  "and nothing ships that nothing plays",
  orphans.length === 0,
  orphans.join(", "),
);

// Real bytes, not a declared size. A foley clip is a couple of seconds; a file
// an order of magnitude past that is a mistake nobody would hear until the
// bundle was already on someone's connection.
const oversized = onDisk.filter(
  (file) => statSync(join(AUDIO_DIR, file)).size > 120_000,
);
check(
  "no sound file is implausibly large for a foley clip",
  oversized.length === 0,
  oversized.join(", "),
);

const credits = readFileSync(join(root, "docs", "ASSET-CREDITS.md"), "utf8");
const uncredited = onDisk.filter((file) => !credits.includes(file));
check(
  "every shipped sound has a row in docs/ASSET-CREDITS.md",
  uncredited.length === 0,
  uncredited.join(", "),
);
check(
  "and the licence ships beside the files",
  readdirSync(AUDIO_DIR).includes("LICENSE.txt"),
);

const variantless = Object.entries(SOUNDS).filter(
  ([, spec]) => spec.files.length === 0,
);
check("every sound has at least one take", variantless.length === 0);

// ==================================================== a real hand, in pictures

section("A hand, drawn");

const created = await fetch(`${HTTP}/api/rooms`, { method: "POST" }).then((r) =>
  r.json(),
);
const code = created.code;

const seats = [];
for (const name of ["Ada", "Grace"]) {
  // The same two-step every client makes: the server minted the code above,
  // and this joins it like any guest would. There is no privileged path.
  const room = await new Client(WS).join(ROOM_NAME, {
    code,
    displayName: name,
    avatar: "cowboy",
  });
  seats.push({ name, room });
  await sleep(150);
}

/**
 * Everything the scene would draw from this patch, checked against the numbers
 * the patch itself carries.
 *
 * This is the whole point of the section: the drawing layer is re-derived from
 * real server output rather than from a fixture somebody wrote by hand, so a
 * value the server can produce and the scene cannot draw shows up here.
 */
const faults = {
  chipsMisdrawn: [],
  illegalRung: [],
  leakedFace: [],
  chipTeleport: 0,
  cueUnknown: [],
};
let patches = 0;
let sawBet = false;
let sawPot = false;
let sawBoard = false;

function inspect(seat) {
  const state = seat.room.state;
  if (!state?.players) return;

  const players = [];
  state.players.forEach((p) =>
    players.push({
      sessionId: p.sessionId,
      seat: p.seat,
      stack: p.stack,
      bet: p.bet,
      status: p.status,
      cardCount: p.cardCount,
      holeCards: [p.holeCard0, p.holeCard1].filter(Boolean),
      displayName: p.displayName,
      avatar: p.avatar,
      connected: p.connected,
      sittingOut: p.sittingOut,
    }),
  );
  players.sort((a, b) => a.seat - b.seat);
  patches++;

  const placed = assignSeats(players.map((p) => p.seat));

  // 1. The chips add up.
  let committed = 0;
  for (const player of players) committed += player.bet;
  const middle = Math.max(0, state.pot - committed);
  if (committed > 0) sawBet = true;
  if (middle > 0) sawPot = true;
  if (state.board?.length > 0) sawBoard = true;

  const drawn = [];
  for (const player of players) {
    const ring = placed.get(player.seat);
    if (!ring) continue;
    for (const [amount, anchor, tag] of [
      [player.stack, stackAnchor(ring), `stack:${player.seat}`],
      [player.bet, betAnchor(ring), `bet:${player.seat}`],
    ]) {
      const chips = chipBreakdown(amount);
      if (chipValue(chips) !== amount) {
        faults.chipsMisdrawn.push(`${tag} ${chipValue(chips)} != ${amount}`);
      }
      for (const chip of pileLayout(chips, anchor, ring.yaw, player.seat)) {
        drawn.push({ pile: tag, ...chip });
        if (Math.hypot(chip.x, chip.z) > TABLE.radius) {
          faults.chipsMisdrawn.push(`${tag} off the felt`);
        }
      }
    }
  }
  const potChips = chipBreakdown(middle, 24);
  if (chipValue(potChips) !== middle) {
    faults.chipsMisdrawn.push(`pot ${chipValue(potChips)} != ${middle}`);
  }
  splitAcrossPiles(potChips).forEach((pile, index) => {
    const anchor = potAnchor(index);
    for (const chip of pileLayout(pile, anchor, anchor.yaw, index)) {
      drawn.push({ pile: `pot:${index}`, ...chip });
    }
  });

  // Chips keep their identity across the patch, which is what makes them
  // slide rather than blink from one side of the table to the other.
  const previous = seat.drawn ?? [];
  if (previous.length > 0) {
    const { assignments } = assignChips(previous, drawn, 256);
    for (const { instance, slot } of assignments) {
      const was = previous[instance];
      if (was && was.denomination !== slot.denomination) faults.chipTeleport++;
    }
  }
  seat.drawn = drawn;

  // 2. Nothing the drag can aim at is illegal.
  const me = players.find((p) => p.sessionId === seat.room.sessionId);
  const snapshot = {
    ...plain(state),
    players,
  };
  for (const rung of betLadder(snapshot, me)) {
    if (rung.type === PokerAction.Raise) {
      if (rung.amount < state.minRaiseTo || rung.amount > state.maxRaiseTo) {
        faults.illegalRung.push(
          `${rung.amount} outside ${state.minRaiseTo}..${state.maxRaiseTo}`,
        );
      }
      if (!state.canRaise) faults.illegalRung.push(`raise while canRaise=false`);
    }
    if (rung.type === PokerAction.Check && !state.canCheck) {
      faults.illegalRung.push("check while canCheck=false");
    }
  }

  // 3. No opponent's card resolves to a face.
  for (const player of players) {
    if (player.sessionId === seat.room.sessionId) continue;
    for (const card of player.holeCards) {
      if (cardIndex(card) !== BACK_SLOT && cardIndex(card) >= 0) {
        faults.leakedFace.push(`${seat.name} could draw ${player.seat}'s ${card}`);
      }
    }
  }

  // 4. Every sound this transition asks for is one that exists.
  for (const cue of tableCues(seat.previous ?? null, snapshot)) {
    if (!SOUNDS[cue.sound]) faults.cueUnknown.push(cue.sound);
  }
  seat.previous = snapshot;
}

function plain(state) {
  return {
    code: state.code,
    phase: state.phase || TablePhase.Waiting,
    board: [...(state.board ?? [])],
    pot: state.pot,
    pots: [],
    currentBet: state.currentBet,
    canCheck: state.canCheck,
    canRaise: state.canRaise,
    callAmount: state.callAmount,
    minRaiseTo: state.minRaiseTo,
    maxRaiseTo: state.maxRaiseTo,
    actingSeat: state.actingSeat,
    actingMs: state.actingMs,
    turn: state.turn,
    buttonSeat: state.buttonSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    handNumber: state.handNumber,
    reveals: [],
    lastResult: state.lastResult,
    players: [],
  };
}

for (const seat of seats) seat.room.onStateChange(() => inspect(seat));

await waitFor(
  () => seats[0].room.state?.handNumber >= 1,
  15_000,
  "the first deal",
);

// Play it out, raising once so there is something in front of a seat to draw
// and something to sweep into the middle.
let raised = false;
const deadline = Date.now() + 60_000;
while (Date.now() < deadline && seats[0].room.state?.handNumber < 2) {
  const state = seats[0].room.state;
  const acting = seats.find((s) => {
    const me = [...state.players.values()].find(
      (p) => p.sessionId === s.room.sessionId,
    );
    return me && me.seat === state.actingSeat;
  });
  if (!acting) {
    await sleep(120);
    continue;
  }
  const live = acting.room.state;
  const type =
    !raised && live.canRaise
      ? PokerAction.Raise
      : live.canCheck
        ? PokerAction.Check
        : PokerAction.Call;
  if (type === PokerAction.Raise) raised = true;
  acting.room.send(ClientMessage.Action, {
    turn: live.turn,
    type,
    ...(type === PokerAction.Raise ? { amount: live.minRaiseTo } : {}),
  });
  await sleep(260);
}

await sleep(PAYOUT_DISPLAY_MS / 2);

check("the hand produced patches to draw", patches > 10, `${patches} patches`);
check("chips reached the middle of the table", sawPot);
check("a bet sat in front of a seat", sawBet);
check("community cards were dealt", sawBoard);
check(
  "every stack, bet and pot drew exactly what it was worth",
  faults.chipsMisdrawn.length === 0,
  faults.chipsMisdrawn.slice(0, 3).join("; "),
);
check(
  "no rung of the chip push was ever an illegal action",
  faults.illegalRung.length === 0,
  faults.illegalRung.slice(0, 3).join("; "),
);
check(
  "no client could ever draw an opponent's card face",
  faults.leakedFace.length === 0,
  faults.leakedFace.slice(0, 3).join("; "),
);
check(
  "chips kept their denomination as they moved",
  faults.chipTeleport === 0,
  `${faults.chipTeleport} swaps`,
);
check(
  "every sound the hand asked for exists",
  faults.cueUnknown.length === 0,
  [...new Set(faults.cueUnknown)].join(", "),
);

// ------------------------------------------------------------------ result

await Promise.all(seats.map((s) => s.room.leave()));
await sleep(400);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
