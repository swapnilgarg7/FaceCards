# Defects

Audited against the tree as it stands. Items 1 and 2 of the previous list are
**fixed** and have been moved to the bottom rather than deleted, because the
shape of the fix is the part worth keeping.

---

## 1. MEDIUM — a leaver can reset their own row on the leaderboard

`server/src/rooms/PokerRoom.ts` `onJoin` (`player.stack = STARTING_STACK;
player.totalBuyIn = STARTING_STACK;`), `onLeave` (`state.players.delete`)

`room.leave()` is a consented close, so Colyseus routes it straight to
`onLeave` and skips the reconnection window entirely. The seat is freed and the
`Player` deleted; rejoining the same code hands out a fresh 1000 chips and, now,
a fresh `totalBuyIn`, `handsPlayed` and `handsWon`.

The chip half of this is no longer interesting — unlimited rebuying is a
sanctioned feature, so nobody has to leave to reload. What is new is that
`totalBuyIn` is a **public field the product presents as the score**: "stack
minus this is the only honest score" is the stated reason the buy-in column
exists. A player who is down 3000 can leave, rejoin, and reappear at the top of
the standings on `+0`. That is a client deciding an outcome, which is the one
thing the architecture is supposed to make impossible.

Nothing else on the leaderboard can be falsified; every other number is
server-derived and survives a drop.

**Fix:** key stacks and buy-in totals to a stable per-room identity rather than
to the session, so a rejoin returns to the same row. Until then the standings
are honest for a table nobody leaves, and only for that.

## 2. MEDIUM — no rate limit on any client message or HTTP route

`server/src/rooms/PokerRoom.ts` `onCreate` handlers; `server/src/index.ts`
`POST /api/rooms`, `GET /api/rooms/:code`

- `sit-out` / `sit-in` now early-return when the value is unchanged, so they are
  no longer the cheap amplifier they were.
- `buy-in` has taken their place and **cannot** be fixed the same way: the
  minimum top-up for a seat with any chips at all is 1, so `{"amount":1}` in a
  loop is accepted every time, and each acceptance dirties two public `uint32`
  fields that fan out to every client. It self-limits at the stack ceiling
  (`MAX_STACK - stack` accepted frames per hand cycle) and Colyseus coalesces
  repeated writes within a patch tick, so this is mild — but it means the
  per-client token bucket is now the load-bearing half of the fix rather than an
  optimisation on top of the equality checks.
- `action` still reaches `applyAction` + `legalActions` on every out-of-turn
  frame and answers each with an `ActionRejected`.
- `request-media-token` mints an HMAC-signed JWT per message with no cooldown.
- Both HTTP routes are unauthenticated and unlimited. `GET /api/rooms/:code` is
  an existence oracle over a 30^6 (~29.4 bit) space and runs a `matchMaker.query`
  per call, which is enough to find live tables by brute force; `POST /api/rooms`
  creates a room that lives at least `ROOM_EMPTY_GRACE_MS` with
  `autoDispose = false`.

**Fix:** a per-client token bucket in `onCreate`, a per-IP bucket on both HTTP
routes, and a cooldown of roughly one a minute on `request-media-token`. Return
404 for a malformed code as well as an unknown one, so the two are
indistinguishable.

## 3. LOW — production TLS is documented but not asserted

`server/src/config.ts`, `client/src/net/endpoints.ts`, `render.yaml`

`docs/DEPLOYMENT.md` requires `https:`/`wss:` in production but nothing enforces
it. `VITE_SERVER_WS_URL` is baked in at build time with a `ws://localhost:2567`
fallback, and `CORS_ORIGINS` is a free-form list with no scheme check, so a
misconfigured deploy ships plaintext silently — and hole cards ride that socket.

**Fix:** when `isProduction`, throw on any `corsOrigins` entry that is not
`https:`; on the client, throw at module load if `import.meta.env.PROD` and the
socket URL is not `wss:`. The `isProduction && !livekit.configured` warning in
`index.ts` is the right precedent.

## 4. LOW — the dealer puck is not drawn on a dead button

`client/src/scene/SeatPlaques.tsx` (`placed.get(snapshot.buttonSeat) ?? null`),
`client/src/scene/TableCards.tsx` (`placed.get(snapshot.buttonSeat)`)

`state.buttonSeat` can now legitimately name a seat nobody is sitting in - a
**dead button** is ordinary casino procedure, see `server/src/poker/blinds.ts`.
`placed` only contains seats that have a player, so the lookup misses and the
puck simply is not rendered for those hands, and the deck spot falls back to
its no-button position.

Both paths degrade safely rather than throwing, so this is cosmetic: for a hand
or two after someone leaves, the table has no visible button. Fixing it means
placing the puck from the seat *ring* rather than from the occupied seats, which
is a scene change and wants a screenshot to judge.

## 5. LOW — `onReconnect` admits a seatless client rather than refusing

Already addressed: `onReconnect` now throws when there is no `Player`, which
Colyseus converts to a clean `FAILED_TO_RECONNECT` leave. Kept here only so the
reasoning is not rediscovered: returning instead would leave the client JOINED,
holding the previous client's `StateView` and occupying a slot with nothing
behind it.

---

## Not defects, recorded so they are not re-litigated

**Seat hijack through the reconnection window is not possible.** `claimSeat`
skips both `takenSeats` and any seat the running hand still holds, and neither
is released until `onLeave` runs. The write side re-checks `playerId`
independently (`state/mirror.ts`). Reconnection is keyed on
`client.reconnectionToken` — nanoid(9), ~54 bits from a CSPRNG — not on
`Player.sessionId`, which is public in the schema but is not a credential.

Worth carrying forward: **a leaked reconnection token lets the holder forcibly
close the live client and take over the seat and its hole-card view**, so that
token must never be logged, persisted, or put in a URL. Today the SDK keeps it
in memory only.

**A departed seat's showdown is published.** `mirrorResult` now writes a
`Reveal` for a seat whose player left mid-hand while all-in. Those cards are
public by definition — the hand reached a real showdown, which only happens with
two or more live seats — and the reveal is withdrawn in `onLeave` so it cannot
be inherited by whoever takes the seat index next. No `Player` instance is
written through the departed seat; `seatedPlayer` still guards every such write.

---

## Fixed

**The action clock was client-resettable.** `armTurnClock` used to clear the
pending timer and restart a full budget for whoever was on the clock, with no
accounting of elapsed time — so any player at the table, in the hand or not,
could hand the acting seat a fresh thirty seconds by cycling their socket. It is
now a *deadline computed from state*: `turnDeadline(seat)` is a pure function of
`turnStartedAt`, whether the acting player is connected, and when they dropped,
and every branch is bounded above by `turnStartedAt + TURN_TIMEOUT_MS`.
`bumpTurn` — the only writer of `turnStartedAt` — is called from exactly four
places, all of them genuinely new decisions. `onLeave` was the last one left: it
bumped unconditionally, so anyone leaving restarted the acting seat's clock. It
now compares the acting seat before and after and bumps only on a real change.

**A refused timeout action killed the clock permanently.** `actOnTimeout` logged
and returned, leaving `turnTimer` undefined with nothing to re-arm it.
It now falls back to `forfeit`, which folds the seat and moves the clock on, and
stops rather than re-arming in the unreachable case where the seat will not
release it.
