/**
 * Phase 0 exit-criteria check.
 *
 * Two headless clients stand in for two browser tabs and assert everything the
 * plan asks phase 0 to prove, minus the parts that need a real camera and a
 * pair of human eyes (eye-line and "can you hold a conversation" are phase 1).
 *
 * Run with the dev stack up:
 *   npm run livekit:up
 *   npm run dev
 *   npm run verify:phase0
 *
 * This exists as a script rather than a vitest case because it is an
 * integration check against live processes, and because it is the artefact
 * that proved the Colyseus and LiveKit versions actually interoperate. Keep it
 * runnable: it is the regression test for every future version bump.
 */
import { WebSocket } from "ws";
import { Client } from "@colyseus/sdk";
import {
  MAX_PLAYERS,
  ROOM_CODE_PATTERN,
  ROOM_NAME,
  ClientMessage,
  ServerMessage,
  STARTING_STACK,
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
/** Poll until `predicate` holds, or give up so a failure reads as a failure. */
const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(100);
  }
  return false;
};
const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------- room codes

section("Room creation and lookup");

const created = await fetch(`${HTTP}/api/rooms`, { method: "POST" }).then((r) =>
  r.json(),
);
const code = created.code;
check("server mints a short room code", ROOM_CODE_PATTERN.test(code ?? ""), code);

check(
  "a live code resolves",
  (await fetch(`${HTTP}/api/rooms/${code}`)).status === 200,
);
check(
  "an unknown code 404s rather than creating a room",
  (await fetch(`${HTTP}/api/rooms/ZZZZZZ`)).status === 404,
);
check(
  "a malformed code is rejected",
  (await fetch(`${HTTP}/api/rooms/nope`)).status === 400,
);

// A client that joins a code nobody created must fail, not conjure a table.
let squatted = false;
try {
  await new Client(WS).join(ROOM_NAME, { code: "ZZZZZZ" });
  squatted = true;
} catch {
  /* expected */
}
check("joining an unminted code does not conjure a room", !squatted);

// The check above is not sufficient on its own, and for a while it was the
// only one here. Colyseus exposes `create` and `joinOrCreate` over
// `POST /matchmake/:method/:room` by default, both of which reach
// `PokerRoom.onCreate` with caller-supplied options - so a client could pick
// its own code through a door `join` never opened. Test the door directly.
for (const method of ["create", "joinOrCreate"]) {
  const response = await fetch(`${HTTP}/matchmake/${method}/${ROOM_NAME}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "ZZZZZZ" }),
  });
  const body = await response.json().catch(() => ({}));
  check(
    `a client cannot mint its own room code via matchmake/${method}`,
    !body?.sessionId,
    body?.error ?? body?.code ?? `http ${response.status}`,
  );
}
check(
  "and no room appeared on the squatted code",
  (await fetch(`${HTTP}/api/rooms/ZZZZZZ`)).status === 404,
);

// ------------------------------------------------------------- two "tabs"

section("Two tabs, one room");

const tokens = {};
async function seat(name) {
  const room = await new Client(WS).join(ROOM_NAME, {
    code,
    displayName: name,
  });
  room.onMessage(ServerMessage.MediaToken, (p) => (tokens[name] = p));
  // Nothing is dealt until a seat says it is ready, so every scripted client
  // presses Play the way a person would. See `ClientMessage.Ready`.
  room.send(ClientMessage.Ready);
  return room;
}

const alice = await seat("Alice");
const bob = await seat("Bob");
await sleep(700);

check("both land in the same room", alice.roomId === bob.roomId, alice.roomId);
check("both see two players", alice.state.players.size === 2 && bob.state.players.size === 2);
check(
  "seats are distinct and fixed",
  alice.state.players.get(alice.sessionId).seat !==
    bob.state.players.get(bob.sessionId).seat,
);

// ---------------------------------------------------------- shared state

section("Shared state flows to both");

// Two seated players is a table, so the server deals. Waiting for that is
// also the cheapest proof that server-owned state reaches both tabs: neither
// client asked for a hand, and both are now looking at the same one.
await waitFor(
  () =>
    alice.state.phase !== TablePhase.Waiting &&
    bob.state.phase !== TablePhase.Waiting,
  8000,
);

check(
  "the server starts a hand on its own",
  alice.state.handNumber === 1 && bob.state.handNumber === 1,
  `alice=${alice.state.handNumber} bob=${bob.state.handNumber}`,
);
check(
  "both tabs see the same public state",
  alice.state.pot === bob.state.pot &&
    alice.state.actingSeat === bob.state.actingSeat,
  `pot=${alice.state.pot} acting=${alice.state.actingSeat}`,
);

const aliceMe = alice.state.players.get(alice.sessionId);
const bobMe = bob.state.players.get(bob.sessionId);
check(
  "the server staked both players",
  aliceMe.stack + aliceMe.bet === STARTING_STACK &&
    bobMe.stack + bobMe.bet === STARTING_STACK,
  `${aliceMe.stack}+${aliceMe.bet}`,
);

// The standing rule, asserted rather than assumed: intents, never outcomes.
const rejections = [];
alice.onMessage(ServerMessage.ActionRejected, (p) => rejections.push(p.reason));
bob.onMessage(ServerMessage.ActionRejected, (p) => rejections.push(p.reason));

const idle = alice.state.actingSeat === aliceMe.seat ? bob : alice;
const potBefore = alice.state.pot;
// A payload that names a seat, an amount larger than the stack, and a result.
// Every field of it is either ignored or refused.
idle.send(ClientMessage.Action, {
  type: "raise",
  amount: 999999,
  seat: 0,
  turn: alice.state.turn,
});
await sleep(500);
check(
  "a client cannot act out of turn or name its own amount",
  alice.state.pot === potBefore && rejections.length > 0,
  rejections[0] ?? "no rejection sent",
);

// ------------------------------------------------------------- privacy

section("Private state is genuinely absent, not merely unrendered");

const aliceJson = JSON.stringify(alice.state);
const bobJson = JSON.stringify(bob.state);

check(
  "each client receives its own two cards",
  Boolean(aliceMe.holeCard0 && aliceMe.holeCard1) &&
    Boolean(bobMe.holeCard0 && bobMe.holeCard1),
  `${aliceMe.holeCard0}${aliceMe.holeCard1} / ${bobMe.holeCard0}${bobMe.holeCard1}`,
);
check(
  "the other player's cards are not in the payload",
  !aliceJson.includes(`"${bobMe.holeCard0}"`) &&
    !aliceJson.includes(`"${bobMe.holeCard1}"`) &&
    !bobJson.includes(`"${aliceMe.holeCard0}"`) &&
    !bobJson.includes(`"${aliceMe.holeCard1}"`),
);
check(
  "the private key itself is absent from the other player's entry",
  !bobJson.includes(`"sessionId":"${alice.sessionId}","displayName":"Alice","seat":${aliceMe.seat},"connected":true,"stack":${aliceMe.stack},"bet":${aliceMe.bet},"status":"${aliceMe.status}","cardCount":2,"holeCard0"`),
);
check(
  "everyone can still see that the other seat is holding cards",
  alice.state.players.get(bob.sessionId).cardCount === 2,
);
check(
  "the undealt deck and the burn cards are nowhere on the wire",
  !aliceJson.includes('"deck"') && !aliceJson.includes('"burned"'),
);
console.log(`        Alice sees: ${aliceJson}`);
console.log(`        Bob sees:   ${bobJson}`);

// -------------------------------------------------------------- media

section("Media credentials");

const mediaUp = tokens["Alice"]?.ok === true;
if (!mediaUp) {
  check(
    "a missing media server is reported, not thrown",
    tokens["Alice"]?.ok === false,
    tokens["Alice"]?.reason ?? "no token delivered",
  );
} else {
  check("each client is issued a token", tokens["Alice"].ok && tokens["Bob"].ok);
  check(
    "identity is the server-assigned session id",
    tokens["Alice"].identity === alice.sessionId &&
      tokens["Bob"].identity === bob.sessionId,
  );
  check(
    "both are scoped to the same media room",
    tokens["Alice"].room === tokens["Bob"].room &&
      tokens["Alice"].room.includes(code),
  );
  check("tokens differ per client", tokens["Alice"].token !== tokens["Bob"].token);
  check(
    "no token leaks into shared state",
    !aliceJson.includes(tokens["Alice"].token) &&
      !bobJson.includes(tokens["Bob"].token),
  );

  // Does the real SFU accept the grant? A token that looks right and is
  // refused at the door is the failure this catches.
  //
  // Minting is local JWT signing, so tokens are produced whether or not the
  // SFU is running. Probe reachability first: without this, a stopped Docker
  // reports as "the media server rejects our token", which sends you auditing
  // grants that were never wrong.
  if (await sfuReachable(tokens["Alice"].url)) {
    const accepted = await handshake(tokens["Alice"]);
    check("the media server accepts the minted token", accepted === true, String(accepted));
    const rejected = await handshake({
      ...tokens["Alice"],
      token: `${tokens["Alice"].token.slice(0, -4)}AAAA`,
    });
    check("the media server rejects a tampered token", rejected !== true, String(rejected));
  } else {
    console.log(
      `  skip  live SFU checks: nothing answering at ${tokens["Alice"].url} (run \`npm run livekit:up\`)`,
    );
  }
}

/** Is anything listening on the SFU's HTTP port? */
async function sfuReachable(wsUrl) {
  const http = wsUrl.replace(/^ws/, "http").replace(/\/$/, "");
  try {
    await fetch(http, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

/** Open the SFU's signalling socket. Resolves true on accept. */
function handshake(cred) {
  return new Promise((resolve) => {
    const url = `${cred.url.replace(/\/$/, "")}/rtc?access_token=${cred.token}&auto_subscribe=1&sdk=js&protocol=15`;
    const socket = new WebSocket(url);
    const done = (value) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      resolve(value);
    };
    const timer = setTimeout(() => done("timeout"), 15000);
    socket.on("open", () => done(true));
    socket.on("unexpected-response", (_req, res) => done(`http ${res.statusCode}`));
    socket.on("error", (err) => done(err.message));
  });
}

// ------------------------------------------------- leave, rejoin, capacity

section("Leaving, rejoining and capacity");

await bob.leave();
await sleep(600);
check("leaving frees the seat", alice.state.players.size === 1);

const bobAgain = await seat("Bob");
await sleep(500);
check("rejoining by code returns to the same room", bobAgain.roomId === alice.roomId);
check("state survives the rejoin", bobAgain.state.code === code);

// The phase-0 exit criterion: refreshing the last open tab must not wedge the
// server or evaporate the room before the reload lands.
await alice.leave();
await bobAgain.leave();
await sleep(900);
check(
  "an emptied room stays joinable long enough to reload into",
  (await fetch(`${HTTP}/api/rooms/${code}`)).status === 200,
);
const reloaded = await new Client(WS).join(ROOM_NAME, { code });
await sleep(400);
check("the last tab can rejoin after closing", reloaded.state.code === code);
await reloaded.leave();
await sleep(300);

const seated = [];
for (let i = 0; i < MAX_PLAYERS + 2; i++) {
  try {
    seated.push(await seat(`P${i}`));
    await sleep(120);
  } catch {
    break;
  }
}
check(
  `the server caps the table at ${MAX_PLAYERS}`,
  seated.length === MAX_PLAYERS,
  `seated ${seated.length}`,
);
await Promise.all(seated.map((r) => r.leave()));

// ------------------------------------------------------------------ result

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed` +
    (mediaUp ? "" : "\n(media checks skipped: run `npm run livekit:up`)"),
);
process.exit(failed.length === 0 ? 0 : 1);
