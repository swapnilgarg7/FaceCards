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
check("a client cannot create a room by picking its own code", !squatted);

// ------------------------------------------------------------- two "tabs"

section("Two tabs, one room");

const tokens = {};
async function seat(name) {
  const room = await new Client(WS).join(ROOM_NAME, {
    code,
    displayName: name,
  });
  room.onMessage(ServerMessage.MediaToken, (p) => (tokens[name] = p));
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

alice.send(ClientMessage.Bump);
await sleep(250);
bob.send(ClientMessage.Bump);
await sleep(500);

check(
  "the shared value updates in both tabs",
  alice.state.counter === 2 && bob.state.counter === 2,
  `alice=${alice.state.counter} bob=${bob.state.counter}`,
);
check(
  "the server attributes the action",
  alice.state.lastBumpBy === "Bob" && bob.state.lastBumpBy === "Bob",
);

// The standing rule, asserted rather than assumed: intents, never outcomes.
alice.send(ClientMessage.Bump, { counter: 9999, amount: 1000 });
await sleep(400);
check(
  "a client-supplied payload cannot set the value",
  alice.state.counter === 3,
  `counter=${alice.state.counter}`,
);

// ------------------------------------------------------------- privacy

section("Private state is genuinely absent, not merely unrendered");

const aliceJson = JSON.stringify(alice.state);
const bobJson = JSON.stringify(bob.state);
const aliceSeat = alice.state.players.get(alice.sessionId).seat;
const bobSeat = bob.state.players.get(bob.sessionId).seat;

check(
  "each client receives its own private field",
  Boolean(alice.state.players.get(alice.sessionId).privateNote) &&
    Boolean(bob.state.players.get(bob.sessionId).privateNote),
);
check(
  "the other player's private field is not in the payload",
  !aliceJson.includes(`seat ${bobSeat} private`) &&
    !bobJson.includes(`seat ${aliceSeat} private`),
);
check(
  "the private key itself is absent from the other player's entry",
  !bobJson.includes(`"seat":${aliceSeat},"connected":true,"privateNote"`),
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
check("state survives the rejoin", bobAgain.state.counter === 3);

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
