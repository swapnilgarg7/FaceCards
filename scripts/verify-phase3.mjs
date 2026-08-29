/**
 * Phase 3 exit-criteria check.
 *
 * Six headless clients fill a table, play multi-way hands, and then one of
 * them has its connection pulled out mid-hand: the table has to keep moving
 * without it, hold its seat, and give the seat, the stack and *only its own*
 * cards back when it returns.
 *
 * What only a live server can prove is the part the unit tests cannot see.
 * The engine's tests already cover the rules exhaustively without a server,
 * and `attention.test.ts` and `avatars.test.ts` cover the pure client and
 * lobby logic. What is left is the room: seat allocation across six clients,
 * the reconnection window, the action clock, sitting out, and the privacy
 * invariant holding with six sets of cards on the table instead of two.
 *
 * Run with the dev stack up:
 *   npm run dev
 *   npm run verify:phase3
 *
 * Takes about a minute, most of it the deliberate pauses between hands and
 * the action clock running down on a seat nobody is in.
 */
import { Client } from "@colyseus/sdk";
import {
  AVATAR_IDS,
  DISCONNECTED_TURN_TIMEOUT_MS,
  MAX_PLAYERS,
  PAYOUT_DISPLAY_MS,
  ROOM_NAME,
  STARTING_STACK,
  TURN_TIMEOUT_MS,
  ClientMessage,
  PokerAction,
  ServerMessage,
  TablePhase,
  isAvatarId,
} from "@facecards/shared";

const HTTP = process.env.VERIFY_HTTP_URL ?? "http://localhost:2567";
const WS = process.env.VERIFY_WS_URL ?? "ws://localhost:2567";

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

// -------------------------------------------------------------- six seats

const created = await fetch(`${HTTP}/api/rooms`, { method: "POST" }).then((r) =>
  r.json(),
);
const code = created.code;

const seats = [];

/**
 * A seated client, plus a running log of everything its state has ever
 * contained.
 *
 * The privacy check is the reason for the log. Inspecting the final state
 * would only prove that no card leaked *at the end*; a leak on the flop that
 * was overwritten by the river would pass. Every patch is snapshotted as it
 * arrives, and the whole history is searched at the end.
 */
function track(player) {
  player.room.onStateChange(() =>
    player.seen.push(JSON.stringify(player.room.state)),
  );
  player.room.onMessage(ServerMessage.ActionRejected, (payload) =>
    player.rejections.push(payload.reason),
  );
  player.room.onMessage(ServerMessage.MediaToken, () => {});
  return player;
}

async function seat(name, avatar) {
  const room = await new Client(WS).join(ROOM_NAME, {
    code,
    displayName: name,
    ...(avatar === undefined ? {} : { avatar }),
  });
  const player = track({ name, room, seen: [], rejections: [] });
  seats.push(player);
  return player;
}

section(`Six players take seats in room ${code}`);

// Two express a preference, one asks for something this build does not ship,
// and three say nothing at all.
const alice = await seat("Alice", "wizard");
const bob = await seat("Bob", "shark");
const carol = await seat("Carol", "ninja");
const dave = await seat("Dave");
const erin = await seat("Erin");
const frank = await seat("Frank");
await sleep(600);

const state = () => alice.room.state;
const playerOf = (p) => p.room.state.players.get(p.room.sessionId);
const seatOf = (p) => playerOf(p).seat;
const onTheClock = () => seats.find((p) => state().actingSeat === seatOf(p));
const anyOf = (predicate) => [...state().players.values()].filter(predicate);

check(
  `all ${MAX_PLAYERS} clients are seated`,
  state().players.size === MAX_PLAYERS,
  `${state().players.size} seated`,
);
check(
  "every seat index is distinct and inside the table",
  new Set(seats.map(seatOf)).size === MAX_PLAYERS &&
    seats.every((p) => seatOf(p) >= 0 && seatOf(p) < MAX_PLAYERS),
  seats.map(seatOf).join(","),
);

let seventhRefused = false;
try {
  await new Client(WS).join(ROOM_NAME, { code, displayName: "Gatecrasher" });
} catch {
  seventhRefused = true;
}
check("a seventh player cannot squeeze in", seventhRefused);

// ---------------------------------------------------------------- avatars

section("Avatars are chosen by the player and validated by the server");

check(
  "a requested archetype is honoured",
  playerOf(alice).avatar === "wizard" && playerOf(bob).avatar === "shark",
  `${playerOf(alice).avatar}, ${playerOf(bob).avatar}`,
);
check(
  "an archetype this build does not ship is replaced, not accepted",
  isAvatarId(playerOf(carol).avatar) && playerOf(carol).avatar !== "ninja",
  playerOf(carol).avatar,
);
check(
  "every seat carries an archetype the client can draw",
  anyOf(() => true).every((p) => isAvatarId(p.avatar)),
  anyOf(() => true)
    .map((p) => p.avatar)
    .join(","),
);
check(
  "players who expressed no preference did not all become the same one",
  new Set([dave, erin, frank].map((p) => playerOf(p).avatar)).size === 3,
  [dave, erin, frank].map((p) => playerOf(p).avatar).join(","),
);
check(
  "nobody was given an archetype outside the shipped list",
  anyOf(() => true).every((p) => AVATAR_IDS.includes(p.avatar)),
);

// ------------------------------------------------------------- the deal

section("Six-handed play");

const dealt = await waitFor(
  () => state().phase === TablePhase.Preflop,
  10_000,
  "the first deal",
);
check("the server deals to a full table", dealt);
check(
  "everyone is dealt in",
  anyOf((p) => p.cardCount === 2).length === MAX_PLAYERS,
  anyOf((p) => p.cardCount === 2).length + " with cards",
);
check(
  "every client can see its own two cards",
  seats.every((p) => playerOf(p).holeCard0 && playerOf(p).holeCard1),
);
check(
  "the button is not a blind six-handed",
  state().actingSeat !== state().buttonSeat,
  `button ${state().buttonSeat}, acting ${state().actingSeat}`,
);
check(
  "the server publishes a clock for the seat on the clock",
  state().actingMs === TURN_TIMEOUT_MS,
  `${state().actingMs}ms`,
);

// Captured now, while they are unambiguously *this* hand's cards.
const cardsOf = new Map(
  seats.map((p) => [p.name, [playerOf(p).holeCard0, playerOf(p).holeCard1]]),
);

// ------------------------------------------------------- the closed laptop

section("A player drops mid-hand");

const dropped = onTheClock();
check("someone is on the clock to drop", Boolean(dropped), dropped?.name);

const droppedSeat = seatOf(dropped);
const droppedStack = playerOf(dropped).stack;
const droppedCards = cardsOf.get(dropped.name);
const reconnectionToken = dropped.room.reconnectionToken;
const droppedSessionId = dropped.room.sessionId;
const beforeDrop = state().turn;

// An unclean close: the socket goes away without a leave message, which is
// what a closed laptop looks like from the server's side.
await dropped.room.leave(false);
await sleep(600);

const stillSeated = state().players.get(droppedSessionId);
check(
  "their seat is held, not freed",
  Boolean(stillSeated) && stillSeated.seat === droppedSeat,
  `seat ${stillSeated?.seat}`,
);
check("their stack is still on the table", stillSeated?.stack === droppedStack);
check("the table can see they are gone", stillSeated?.connected === false);
check(
  "the clock drops to the budget for an empty chair",
  state().actingMs === DISCONNECTED_TURN_TIMEOUT_MS,
  `${state().actingMs}ms`,
);

const movedOn = await waitFor(
  () => state().turn !== beforeDrop,
  DISCONNECTED_TURN_TIMEOUT_MS + 4000,
  "the table to move past the empty seat",
);
check("fold-or-timeout keeps the hand moving", movedOn);
check(
  "the seat that timed out is out of the hand, not out of the game",
  state().players.get(droppedSessionId)?.status === "folded" &&
    state().players.has(droppedSessionId),
  state().players.get(droppedSessionId)?.status,
);

// -------------------------------------------------------- and comes back

section("They reopen the laptop");

const backRoom = await new Client(WS).reconnect(reconnectionToken);
const back = track({
  name: dropped.name,
  room: backRoom,
  seen: [],
  rejections: [],
});
seats[seats.indexOf(dropped)] = back;
await sleep(600);

check(
  "reconnecting restores the same session, not a new one",
  backRoom.sessionId === droppedSessionId,
  `${droppedSessionId} -> ${backRoom.sessionId}`,
);
check("and the same seat", playerOf(back).seat === droppedSeat);
check(
  "and the same stack, so dropping is not a free rebuy",
  playerOf(back).stack === droppedStack,
  `${droppedStack} -> ${playerOf(back).stack}`,
);
check(
  "the table sees them back",
  state().players.get(droppedSessionId)?.connected === true,
);
check(
  "their own cards are theirs again",
  playerOf(back).holeCard0 === droppedCards[0] &&
    playerOf(back).holeCard1 === droppedCards[1],
  `${droppedCards.join("")} -> ${playerOf(back).holeCard0}${playerOf(back).holeCard1}`,
);
check(
  "and nobody else's came back with them",
  [...backRoom.state.players.values()]
    .filter((p) => p.sessionId !== droppedSessionId)
    .every((p) => !p.holeCard0 && !p.holeCard1),
);

// --------------------------------------------------------- play it out

section("The hand finishes multi-way");

let guard = 0;
const signature = () =>
  `${state().phase}:${state().actingSeat}:${state().pot}:${state().currentBet}`;

while (state().phase !== TablePhase.Payout && state().phase !== TablePhase.Waiting) {
  if (guard++ > 90) break;
  const turn = onTheClock();
  if (!turn) {
    await sleep(120);
    continue;
  }
  const before = signature();
  const s = turn.room.state;
  turn.room.send(ClientMessage.Action, {
    type: s.canCheck ? PokerAction.Check : PokerAction.Call,
    turn: s.turn,
  });
  await waitFor(() => signature() !== before, 4000, "the hand to move on");
}

check("the hand reached a payout", state().phase === TablePhase.Payout);
check(
  "the board holds five cards",
  state().board.length === 5,
  [...state().board].join(" "),
);
check(
  "a multi-way showdown was published",
  state().reveals.length >= 2,
  `${state().reveals.length} shown`,
);
check(
  "the chips are all still on the table",
  anyOf(() => true).reduce((sum, p) => sum + p.stack, 0) ===
    STARTING_STACK * MAX_PLAYERS,
  String(anyOf(() => true).reduce((sum, p) => sum + p.stack, 0)),
);
check(
  "the timed-out seat kept the chips it had not committed",
  state().players.get(droppedSessionId).stack > 0,
);

// ------------------------------------------------------------- privacy

section("No opponent hole card, in any frame, with six sets on the table");

// The reveal is a deliberate publication, so it is the boundary: every frame
// before it must be free of every opponent's cards.
const firstRevealIndex = (player) =>
  player.seen.findIndex((frame) => frame.includes('"reveals":[{'));

// A hole card that also landed on the board is public by then, and appears in
// everyone's state legitimately.
const board = new Set([...state().board]);

function leakedTo(viewer) {
  const cutoff = firstRevealIndex(viewer);
  const frames = cutoff < 0 ? viewer.seen : viewer.seen.slice(0, cutoff);
  const leaks = [];
  for (const [name, cards] of cardsOf) {
    if (name === viewer.name) continue;
    for (const card of cards) {
      if (board.has(card)) continue;
      if (frames.some((frame) => frame.includes(`"${card}"`))) {
        leaks.push(`${name}:${card}`);
      }
    }
  }
  return leaks;
}

let anyLeak = false;
for (const viewer of seats) {
  const leaks = leakedTo(viewer);
  if (leaks.length > 0) anyLeak = true;
  check(
    `${viewer.name} never received another player's card (${viewer.seen.length} frames)`,
    leaks.length === 0,
    leaks.join(" "),
  );
}
check("no client learned anything it should not have", !anyLeak);
check(
  "no frame ever carried the deck stub or a burn card",
  seats.every((p) =>
    p.seen.every((f) => !f.includes('"deck"') && !f.includes('"burned"')),
  ),
);

// ----------------------------------------------------------- sitting out

section("Sitting out and sitting back in");

const sitter = seats.find((p) => p.room.sessionId !== droppedSessionId);
sitter.room.send(ClientMessage.SitOut);
await sleep(400);
check(
  "the table can see who is sitting out",
  playerOf(sitter).sittingOut === true,
);

const handTwo = await waitFor(
  () => state().handNumber === 2,
  PAYOUT_DISPLAY_MS + 10_000,
  "the second deal",
);
check("the next hand deals itself", handTwo);
check(
  "and deals around the player sitting out",
  playerOf(sitter).cardCount === 0 &&
    anyOf((p) => p.cardCount === 2).length === MAX_PLAYERS - 1,
  `${anyOf((p) => p.cardCount === 2).length} dealt in`,
);
check(
  "who still has their seat and their chips",
  playerOf(sitter).stack > 0 && playerOf(sitter).seat >= 0,
);

sitter.room.send(ClientMessage.SitIn);
await sleep(400);
check("sitting back in is immediate", playerOf(sitter).sittingOut === false);

// Fold the second hand out quickly, so the third deal comes round.
guard = 0;
while (state().phase !== TablePhase.Payout && state().phase !== TablePhase.Waiting) {
  if (guard++ > 90) break;
  const turn = onTheClock();
  if (!turn) {
    await sleep(120);
    continue;
  }
  const before = signature();
  turn.room.send(ClientMessage.Action, {
    type: PokerAction.Fold,
    turn: turn.room.state.turn,
  });
  await waitFor(() => signature() !== before, 4000, "the fold to land");
}

const handThree = await waitFor(
  () => state().handNumber === 3,
  PAYOUT_DISPLAY_MS + 10_000,
  "the third deal",
);
check("a third hand deals itself", handThree);
check(
  "and the player who sat back in is dealt in again",
  playerOf(sitter).cardCount === 2,
);

// ------------------------------------------------------------------ result

await Promise.all(seats.map((p) => p.room.leave()));
await sleep(400);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
