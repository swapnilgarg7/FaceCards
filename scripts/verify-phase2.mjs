/**
 * Phase 2 exit-criteria check.
 *
 * Two headless clients play a real hand against a real server: blinds, all
 * four streets, a raise, a showdown, chips moving, and the next hand dealing
 * itself. It is the integration counterpart to the engine's unit tests, which
 * already cover the rules exhaustively without a server. What only a live
 * server can prove is the part the tests cannot see: that no opponent's card
 * ever crosses the socket.
 *
 * Run with the dev stack up:
 *   npm run dev
 *   npm run verify:phase2
 *
 * Takes about twenty seconds, most of it the deliberate pause between hands.
 */
import { Client } from "@colyseus/sdk";
import {
  MIN_PLAYERS,
  PAYOUT_DISPLAY_MS,
  ROOM_NAME,
  STARTING_STACK,
  ClientMessage,
  PokerAction,
  ServerMessage,
  TablePhase,
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

// ------------------------------------------------------------- two seats

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
async function seat(name) {
  const room = await new Client(WS).join(ROOM_NAME, { code, displayName: name });
  const player = { name, room, seen: [], rejections: [] };
  room.onStateChange(() => player.seen.push(JSON.stringify(room.state)));
  room.onMessage(ServerMessage.ActionRejected, (payload) =>
    player.rejections.push(payload.reason),
  );
  room.onMessage(ServerMessage.MediaToken, () => {});
  // Nothing is dealt until a seat says it is ready, so every scripted client
  // presses Play the way a person would. See `ClientMessage.Ready`.
  room.send(ClientMessage.Ready);
  seats.push(player);
  return player;
}

const alice = await seat("Alice");
const bob = await seat("Bob");
await sleep(400);

const me = (p) => p.room.state.players.get(p.room.sessionId);
const mySeat = (p) => me(p).seat;
const onTheClock = () => seats.find((p) => p.room.state.actingSeat === mySeat(p));

// --------------------------------------------------------- the deal

section("The server deals a hand by itself");

const dealt = await waitFor(
  () => alice.room.state.phase === TablePhase.Preflop,
  8000,
  "the first deal",
);
check(`${MIN_PLAYERS} players is enough for the server to deal`, dealt);
check(
  "blinds are posted",
  alice.room.state.pot ===
    alice.room.state.smallBlind + alice.room.state.bigBlind,
  `pot=${alice.room.state.pot}`,
);
check(
  "both players are dealt two cards",
  me(alice).cardCount === 2 && me(bob).cardCount === 2,
);
check(
  "each player can see its own two cards",
  Boolean(me(alice).holeCard0 && me(alice).holeCard1) &&
    Boolean(me(bob).holeCard0 && me(bob).holeCard1),
  `${me(alice).holeCard0}${me(alice).holeCard1} vs ${me(bob).holeCard0}${me(bob).holeCard1}`,
);
check(
  "heads-up puts the button in the small blind and on the clock",
  alice.room.state.actingSeat === alice.room.state.buttonSeat,
);

// Captured now, while they are unambiguously *this* hand's cards. Reading
// them later would compare hand two's cards against hand one's frames, and a
// card dealt to Alice in one hand and to Bob in the next reads as a leak.
const aliceCards = [me(alice).holeCard0, me(alice).holeCard1];
const bobCards = [me(bob).holeCard0, me(bob).holeCard1];

// --------------------------------------------------------- illegal intents

section("The server refuses what it should refuse");

const waiting = seats.find((p) => p.room.state.actingSeat !== mySeat(p));
const potBefore = alice.room.state.pot;
waiting.room.send(ClientMessage.Action, {
  type: PokerAction.Call,
  turn: waiting.room.state.turn,
});
await sleep(400);
check(
  "an action out of turn is refused",
  waiting.rejections.includes("not your turn") &&
    alice.room.state.pot === potBefore,
  waiting.rejections.at(-1) ?? "nothing was refused",
);

const acting = onTheClock();
acting.room.send(ClientMessage.Action, {
  type: PokerAction.Raise,
  amount: STARTING_STACK * 100,
  turn: acting.room.state.turn,
});
await sleep(400);
check(
  "a raise beyond the stack is refused",
  acting.rejections.length > 0 && alice.room.state.pot === potBefore,
  acting.rejections.at(-1) ?? "nothing was refused",
);

acting.room.send(ClientMessage.Action, {
  type: "steal-the-pot",
  turn: acting.room.state.turn,
});
await sleep(300);
check(
  "an action the protocol does not define is refused",
  acting.rejections.at(-1) === "unknown action",
  acting.rejections.at(-1),
);

// A double-click, or a resend that arrives a street late, must not act twice.
acting.room.send(ClientMessage.Action, {
  type: PokerAction.Call,
  turn: acting.room.state.turn - 1,
});
await sleep(400);
check(
  "an intent answering a decision that has passed is refused",
  acting.rejections.at(-1) === "that decision has already been made" &&
    alice.room.state.pot === potBefore,
  acting.rejections.at(-1),
);

// ------------------------------------------------------------ play it out

section("A full hand, end to end");

const streets = new Set();
const firstButton = alice.room.state.buttonSeat;
let raised = false;
let guard = 0;

/** Everything about the hand that any legal action must change. */
const signature = () => {
  const s = alice.room.state;
  return `${s.phase}:${s.actingSeat}:${s.pot}:${s.currentBet}`;
};

while (alice.room.state.phase !== TablePhase.Payout) {
  if (guard++ > 60) break;
  streets.add(alice.room.state.phase);

  const turn = onTheClock();
  if (!turn) {
    await sleep(150);
    continue;
  }

  const before = signature();
  const state = turn.room.state;
  const token = state.turn;
  if (!raised && state.canRaise) {
    // Exercise a real raise once, so the hand is not a check-down.
    turn.room.send(ClientMessage.Action, {
      type: PokerAction.Raise,
      amount: state.minRaiseTo,
      turn: token,
    });
    raised = true;
  } else if (state.canCheck) {
    turn.room.send(ClientMessage.Action, { type: PokerAction.Check, turn: token });
  } else {
    turn.room.send(ClientMessage.Action, { type: PokerAction.Call, turn: token });
  }

  // Wait on the hand moving, not on the seat changing: heads-up, the player
  // who closes a street is often the one who opens the next.
  await waitFor(() => signature() !== before, 3000, "the hand to move on");
}

check("the hand reached a payout", alice.room.state.phase === TablePhase.Payout);
check(
  "every street was dealt",
  [TablePhase.Preflop, TablePhase.Flop, TablePhase.Turn, TablePhase.River].every(
    (s) => streets.has(s),
  ),
  [...streets].join(" -> "),
);
check("a raise was made and called", raised);
check(
  "the board holds five cards",
  alice.room.state.board.length === 5,
  [...alice.room.state.board].join(" "),
);
check(
  "the showdown is published to both tabs",
  alice.room.state.reveals.length === 2 && bob.room.state.reveals.length === 2,
);
check(
  "exactly the contested chips changed hands",
  me(alice).stack + me(bob).stack === STARTING_STACK * 2,
  `${me(alice).stack} + ${me(bob).stack}`,
);
check(
  "the pot was awarded to someone",
  [...alice.room.state.reveals].some((r) => r.won > 0),
  alice.room.state.lastResult,
);
check(
  "the result names a hand",
  [...alice.room.state.reveals].every((r) => r.description.length > 0),
  [...alice.room.state.reveals].map((r) => r.description).join(" / "),
);

// ------------------------------------------------------------- privacy

section("No opponent hole card, in any frame, until the showdown");

// The reveal is a deliberate publication, so it is the boundary: every frame
// before it must be free of the opponent's cards, and the frame itself is
// where they are allowed to appear.
const firstRevealIndex = (player) =>
  player.seen.findIndex((frame) => frame.includes('"reveals":[{'));

// A hole card that also landed on the board is public by then, and appears in
// everyone's state legitimately.
const board = new Set([...alice.room.state.board]);
const privateOf = (cards) => cards.filter((c) => !board.has(c));

/** Did this client's state ever contain one of those cards before showdown? */
function leakedBeforeShowdown(player, cards) {
  const cutoff = firstRevealIndex(player);
  const frames = cutoff < 0 ? player.seen : player.seen.slice(0, cutoff);
  return privateOf(cards).filter((card) =>
    frames.some((frame) => frame.includes(`"${card}"`)),
  );
}

const leakedToAlice = leakedBeforeShowdown(alice, bobCards);
const leakedToBob = leakedBeforeShowdown(bob, aliceCards);

check(
  `Alice never received Bob's cards (${firstRevealIndex(alice)} frames checked)`,
  leakedToAlice.length === 0,
  leakedToAlice.join(" "),
);
check(
  `Bob never received Alice's cards (${firstRevealIndex(bob)} frames checked)`,
  leakedToBob.length === 0,
  leakedToBob.join(" "),
);
check(
  "no frame ever carried the deck stub or a burn card",
  seats.every((p) =>
    p.seen.every((f) => !f.includes('"deck"') && !f.includes('"burned"')),
  ),
);
check(
  "the showdown reveal is where the cards finally became public",
  [...alice.room.state.reveals].some(
    (r) => r.sessionId === bob.room.sessionId && [...r.cards].join("") === bobCards.join(""),
  ),
  [...alice.room.state.reveals].map((r) => [...r.cards].join(" ")).join(" / "),
);

// ------------------------------------------------------- the next hand

section("The next hand deals itself");

const redealt = await waitFor(
  () => alice.room.state.handNumber === 2,
  PAYOUT_DISPLAY_MS + 6000,
  "the second deal",
);
check("a second hand starts with no lobby round-trip", redealt);
check(
  "the button moved",
  alice.room.state.buttonSeat !== firstButton,
  `${firstButton} -> ${alice.room.state.buttonSeat}`,
);
check(
  "last hand's showdown was cleared before the new cards",
  alice.room.state.reveals.length === 0,
);
check(
  "and last hand's cards did not survive into it",
  ![me(alice).holeCard0, me(alice).holeCard1].every((c) =>
    aliceCards.includes(c),
  ),
  `${aliceCards.join("")} -> ${me(alice).holeCard0}${me(alice).holeCard1}`,
);

// ------------------------------------------------------------------ result

await Promise.all(seats.map((p) => p.room.leave()));
await sleep(300);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
