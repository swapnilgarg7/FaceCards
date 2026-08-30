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

## 2. FIXED (phase 6) — no rate limit on any client message or HTTP route

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

**Fixed.** The HTTP half went in with phase 3 (`RateLimiter`, per address, on
both routes plus a live-room ceiling). The socket half is phase 6:
`server/src/rooms/messageLimits.ts` gives every client message a per-client,
per-type fixed window, and `PokerRoom.onIntent` is the single registration path
so the budget is checked *before* the handler rather than inside it — a guard
after the `state.players.get` has already paid for the frame it refuses.

Three things about the fix are worth keeping:

- **Per type, not per socket.** One shared bucket would mean a player who
  bought in six times could not then fold, which turns a limiter into a way of
  freezing somebody out of their own hand.
- **The refusal is silent.** Answering would hand the flooder an amplifier, and
  one inbound frame becoming one outbound frame is exactly the trade that put
  `action` on this list in the first place. The log gets one line per client
  per window instead.
- **`forget` on leave.** Colyseus can hand out a session id again, and a new
  client inheriting an exhausted window would be refused its own first action.

`request-media-token` is six a minute rather than one, which is still far below
a signing loop and above anything a real client does — it asks once per session,
and the server sends the first one unprompted.

Not done: `GET /api/rooms/:code` still returns 400 for a malformed code and 404
for an unknown one, so the two remain distinguishable. It is a weak oracle
(a malformed code is one that could never exist, so it leaks nothing about
which rooms are live) and the limiter is what actually bounds the brute force,
but the two responses could still be collapsed.

## 3. FIXED (phase 6) — production TLS is documented but not asserted

`server/src/config.ts`, `client/src/net/endpoints.ts`, `render.yaml`

`docs/DEPLOYMENT.md` requires `https:`/`wss:` in production but nothing enforces
it. `VITE_SERVER_WS_URL` is baked in at build time with a `ws://localhost:2567`
fallback, and `CORS_ORIGINS` is a free-form list with no scheme check, so a
misconfigured deploy ships plaintext silently — and hole cards ride that socket.

**Fixed**, as described, in `server/src/tls.ts` and `client/src/net/endpoints.ts`.
Both throw rather than warn, and both exempt loopback so a production build can
still be run locally to reproduce something.

Both halves are needed and they catch different mistakes: the server terminates
plain HTTP behind Render's proxy and cannot see what scheme a browser used, and
the client cannot see what the server was configured with. What each *can*
check is what an operator typed at it. The server also rejects a wildcard
origin and an entry that is not a URL at all, and reports every problem at once
rather than one per restart — an operator fixing a comma-separated list against
a platform whose deploys take minutes is a miserable half hour otherwise.

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

## 5. LOW — Safari cannot see a permission being revoked mid-session

`client/src/media/permissions.ts` (`watchMediaPermission`)

Four of the five permission paths are driven by an exception or by the platform
`ended` event and work everywhere. The fifth — somebody revoking camera access
from the browser's own site settings while sitting at a table — has no such
signal: nothing fails, nothing throws, and the `PermissionStatus` flips
underneath a running session. The only way to notice is to subscribe to that
status, and **Safari implements neither the `camera` nor the `microphone`
descriptor**, so there is nothing to subscribe to. Firefox is the same.

Symptom on those browsers: the avatar shows a still frame of somebody who is
still talking, with no banner, until something else fails and raises a fault of
its own.

**No fix available.** There is no other way to ask the platform. Polling
`getUserMedia` would be worse than the bug — it re-prompts, flashes the capture
light, and can itself fail for four unrelated reasons. Recorded in
`docs/BROWSERS.md` so it is a known limitation rather than a mystery.

## 6. LOW — `onReconnect` admits a seatless client rather than refusing

Already addressed: `onReconnect` now throws when there is no `Player`, which
Colyseus converts to a clean `FAILED_TO_RECONNECT` leave. Kept here only so the
reasoning is not rediscovered: returning instead would leave the client JOINED,
holding the previous client's `StateView` and occupying a slot with nothing
behind it.

---

## 7. LOW — a captured face can come from a low simulcast layer

`client/src/moments/useMoments.ts` `capture`, `client/src/scene/AttentionDirector.tsx`

`adaptiveStream` and the attention director between them keep a peer whose
avatar is off to the side of the camera on a low simulcast rung. A Poker Moment
captures whatever layer is live at the instant the result is revealed, so the
player who was not being looked at is photographed at h180 and blown up to a
128-pixel portrait. It reads as a soft, blocky face next to a sharp one.

Not fixed, and the reason is that the obvious fix is worse than the symptom.
Asking for `high` on the whole cast at the moment of capture is useless — a
layer switch takes hundreds of milliseconds and the frame is drawn immediately.
Asking for it at the *start* of the payout would work, but it means a second
thing writing `setQuality` on a loop that already has one, and a fight between
two controllers of an adaptive system is exactly the oscillation
`docs/ENGINEERING-STYLE.md` warns about — the failure mode there is worse than a
soft photograph, because it is intermittent and affects live faces mid-hand.

**Fix:** give the attention director an explicit "showdown" mode it owns
itself, entered on `TablePhase.Payout` and left at the next deal, which pins
every subscribed peer to `high` for the duration. One controller, one rule, and
the moment gets sharp faces as a side effect of the thing the table already
wants — everyone looking at everyone during a showdown.

## 8. FIXED — Poker Moments showed a different card to every player

`client/src/moments/useMoments.ts`, `client/src/moments/seed.ts`

Each client plans its own moment from server state, so everybody agreed on the
hand and the winner. Everything else was rolled locally with `Math.random`: the
winner saw a newspaper, the player next to them saw a wanted poster, and the
captions under the same face were different words. Reported from an actual
game, and the report is the clearest statement of why it mattered — *"I won,
but I'd have preferred seeing what my friend was shown."* A Poker Moment is a
shared artifact or it is nothing; six people looking at six different cards
cannot laugh at the same joke.

**Fixed.** `seed.ts` derives a seed from the room code and the hand number —
state every client already holds — and one `mulberry32` generator per hand
feeds the treatment pick and every caption, drawn in a fixed order (hero,
fallen, witnesses). No message was added, nothing is trusted from another
client, and there is no round trip: each browser computes the same answer
independently. The caption cooldown stays local and converges, because every
client plans the same moments and therefore records the same history; a player
who joins mid-session diverges for at most `COOLDOWN_HANDS` hands before their
memory ages back into agreement.

What is still per-viewer, and always will be: **the photographs**. Each client
captures the video stream it is already receiving — your own camera at full
resolution on your machine, whatever the SFU delivered on everyone else's. The
only way to make those identical is to upload people's webcam frames to a
server, which is the one thing this feature promises it never does.

Worth carrying forward: the captions are only in sync because every draw from
the seeded generator happens **synchronously, in a fixed order**, before any
capture starts. The first version picked each caption inside the async function
that photographed that person, and those run concurrently — so the draw order
was whatever the promises settled in. A future edit that moves a `pickCaption`
back inside `shootPerson` would silently desynchronise the table again, and
nothing would fail.

## 9. FIXED — a seven-handed table dealt cards to two people, then let them in one per hand

`server/src/rooms/PokerRoom.ts` `considerDealing`, `deal`;
`server/src/poker/blinds.ts` `nextBlinds`

Two independent bugs that compounded into the worst first impression the
product can make: seven friends sit down, and four of them watch.

**The first deal fired two seconds after the second Play.** `considerDealing`
scheduled on `HAND_START_DELAY_MS` the moment `MIN_PLAYERS` were eligible.
Seven people do not press Play simultaneously — they press it across ten or
fifteen seconds of finding a camera — so the two fastest clickers started a
heads-up hand and everybody else was dealt out of it. "Enough players" and
"the table" are the same set for every hand except the first one, and the code
only knew the first meaning.

**Then the waiting rule stretched from one hand to a whole orbit.** Every seat
not dealt into a hand was assigned `owesBlind = true`, and `nextBlinds` admits
exactly one waiter per hand: the seat the big blind happens to land on. So the
five who missed hand 1 joined back at one per hand — six hands before the last
one saw a card. The rule is real casino procedure and it is there for a real
reason, but it is a rule about *being away*, and it was being charged to people
who were sitting in their chairs, ready, connected, funded, watching a hand
they had asked to be in. Being held out by a debt was itself re-incurring the
debt.

Neither half shows up in a two-player test, which is why both survived.

**Fixed.**

- `server/src/rooms/firstDeal.ts` (`dealDelayMs`, pure, unit-tested) holds the
  table's *first* deal for `FIRST_HAND_GRACE_MS` (20s) unless every seat that
  could press Play already has, in which case the normal two-second beat runs.
  Pressing Play only ever shortens that countdown, never restarts it, or the
  last friend to click would be the one who delayed the deal. Every hand after
  the first is untouched, and a pending payout timer is left strictly alone so
  that sitting in during the results screen cannot cut it short.
- `seatsOwingBlind` in `blinds.ts` charges the wait for absence only: not dealt
  in **and** not eligible. A seat held out by the arrangement clears its debt
  and is dealt in on the very next hand, so the wait is bounded at one hand
  instead of one orbit. A dropped player is still charged — that reversal is
  argued at the call site and is unchanged.
- `client/src/ui/startGate.ts` keeps the gate up while the table is still
  waiting on someone, naming them. With a twenty-second grace, a player who is
  ready early would otherwise stare at empty felt with nothing saying why. It
  only names seats that could actually press Play, matching the server's rule,
  so the table is never shown waiting on a closed laptop.

## Not defects, recorded so they are not re-litigated

**A Poker Moment publishes no card that was not already public.** The feature
needs to know whether a hand was a bluff, a cooler or a suckout, and all three
are statements about hole cards. They are derived in `server/src/poker/story.ts`
and published as `HandNote`, and the rule is enforced in two independent places:
`story.ts` refuses to classify a seat that is not in `result.showdown`, and
`state/mirror.ts` re-checks the reveal list before writing a single note, so a
future edit to one of them cannot open the hole on its own. A hand won on folds
carries `showed: false`, `category: -1` and `bluffCaughtSeat: -1`, however
obvious the bluff was — the winner never has to show, and a caption is not a
good enough reason to make them. `server/src/state/mirror.test.ts` tests exactly
that hand: seven-deuce shoves, everybody folds, and nothing published
distinguishes it from a shove with aces.

**What `HandNote` *does* say about a folded hand is public by construction.**
Who made the last raise, how much somebody called, what a seat committed and
whether they have chips left were all watched by the whole table as they
happened, and every one of them is already derivable from the public schema.
The note is a convenience, not a new disclosure.

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

**The duplicate-tab channel is not a new leak surface.** Phase 6 added a
`BroadcastChannel` (`client/src/net/tabLock.ts`) so two tabs of one browser at
one table can notice each other. It is same-origin, reaches only other tabs of
this site, and carries exactly `{ kind, code }` — a room code that is already in
that same browser's address bar. It must never carry the reconnection token: a
channel is not a URL and not a log, but it is adjacent to both, and the token
would hand a listener the seat and the hole-card view with it.
`verify:phase6` asserts the message type stays closed and that the file does
not mention a token.

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
