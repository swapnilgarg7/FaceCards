# FaceCards / Virtual Poker Night
## Phase-by-phase implementation plan

Derived from `virtual_poker_night_developer_spec.pdf`, which remains the requirements source of truth. This document is the build order.

Companion docs:
- `docs/TECH-DECISIONS.md`: pinned versions, chosen packages, hosting, and the reasoning behind each pick (researched 2026-08-29).
- `docs/ASSET-SOURCES.md`: the vetted free-asset catalog. Every entry license-checked.
- `docs/ASSET-CREDITS.md`: the running license audit trail for assets actually in the build.

---

## 0. What we are actually building

A desktop-browser room where 2 to 6 friends sit in **fixed seats** around one stylized 3D poker table, see each other's **live webcam faces mapped onto low-poly avatar heads**, talk over live voice, and play server-authoritative Texas Hold'em with 3D cards and chips.

Poker is the activity. **Social presence is the product.** The spec's own closing principle: every decision serves *"holy shit, it feels like we're actually sitting at the table together."*

### The three things that make or break it

1. **Faces on avatars.** A live webcam `VideoTexture` on an avatar's face plane, at a believable eye-line, is the entire differentiator. If this looks bad, nothing else rescues the product.
2. **Server-authoritative poker with private hole cards.** Not a feature, a correctness floor. Any leak of another player's cards is a critical bug.
3. **60 FPS on a MacBook Air** with 6 avatars and 6 simultaneous video textures. A real constraint that shapes the art direction, not a cleanup task.

### Locked decisions (spec section 2, do not relitigate)

| | V1 |
| --- | --- |
| Seating | Fixed seats, no walking |
| Camera | First-person only, no third-person |
| Look | Smooth mouse look, left/right plus look down at cards, clamped pitch |
| Players | 2 to 6 shipping, architecture ready for 10 |
| Avatars | Stylized 3D, live webcam face on the head |
| Voice | Open by default after permission, mute and camera toggles |
| Rooms | Private, created by anyone, joined by URL/code |
| Accounts | None in V1 |
| Style | Beautiful, funky, premium casino. Stylized, never photorealistic |
| Platform | Desktop browser, Mac and Windows. No native app |
| Stakes | Fake chips only |

### Out of scope for V1 (spec section 14)

Native mobile apps, walking or exploration, real money, public matchmaking, accounts, tournaments, cosmetics store, AI players, multiple venues, full-body mocap, AI lip-sync, spatial audio, large casino environments.

Anything on this list that creeps into a phase gets cut on sight.

---

## 1. Stack (pinned)

Full reasoning in `docs/TECH-DECISIONS.md`. Short version:

| Layer | Choice | Version |
| --- | --- | --- |
| 3D | `three` | 0.185.1 |
| R3F | `@react-three/fiber` | 9.7.0 (pairs with React 19) |
| Helpers | `@react-three/drei` | 10.7.8 |
| UI | React + TypeScript + Vite | React 19 |
| Animation | `@react-spring/three` + manual `damp` | 10.1.2 |
| Physics | **none** | intentional |
| Voice/video | LiveKit (`livekit-client`, `livekit-server-sdk`) | client 2.22.0 |
| Networking | Colyseus + `@colyseus/schema`, client `@colyseus/sdk` | 0.17.10 / 4.0.30 / 0.17.43 |
| Hand eval | `poker-evaluator` | maintained, lookup-table |
| Betting logic | hand-rolled, pure, fully tested | n/a |
| DB | Supabase free tier (room metadata only) | n/a |
| Hosting | Cloudflare Pages (client) + Render (game server) | n/a |

Two picks deserve calling out here because they shape the code:

**Colyseus `StateView`, not `@filter()`.** The old `@filter()` / `@filterChildren()` decorators are removed as of 0.16. Per-client private state is now expressed with `StateView`, which is exactly the hole-cards problem. This is the single reason Colyseus wins over a hand-rolled `ws` protocol: the two hardest parts of this server, per-client filtered state and reconnection, are both native.

**No physics engine.** Card deals and chip pushes are scripted, server-triggered events, not emergent simulation. Springs and damped lerps are deterministic across clients, cheaper, and more art-directable. Rapier would add WASM weight and cross-client nondeterminism to buy nothing the spec asks for.

---

## 2. Repository layout

```
FaceCards/
├─ client/                  React + TypeScript + Vite
│  └─ src/
│     ├─ scene/             room, table, seat layout, camera rig, lighting
│     ├─ avatars/           avatar meshes, face plane, video texture binding
│     ├─ cards/             card meshes, atlas, deal/flip/peek animation
│     ├─ chips/             instanced chips, stacks, push-to-pot
│     ├─ media/             LiveKit connection, track lifecycle, device controls
│     ├─ net/               Colyseus client, state store
│     ├─ ui/                lobby, HUD, action bar, settings, credits
│     └─ audio/             SFX bus
│  └─ public/
│     ├─ models/            .glb, Draco/Meshopt compressed
│     ├─ textures/          .ktx2 / .webp
│     └─ audio/
├─ server/                  Node + TypeScript, authoritative
│  └─ src/
│     ├─ rooms/             Colyseus rooms, seats, join/leave/reconnect
│     ├─ poker/             PURE Hold'em engine, no I/O imports
│     ├─ state/             schema + StateView wiring
│     └─ livekit/           access token minting
├─ shared/                  message types + constants, imported by both
├─ docs/
├─ plan.md
└─ CLAUDE.md
```

**Rule:** `server/src/poker/` imports nothing from `rooms/`, `state/`, or any I/O. It is a pure state machine, which is what makes it exhaustively unit-testable without a server. The client never re-implements a poker rule; it renders server state and sends intents.

---

## 3. Phases

The spec gives 8 phases (section 15). This plan keeps that spine and fills in the work, exit criteria and traps. Phases are ordered so the **riskiest unknown is proven first**: the webcam-face-on-avatar trick lands in phase 0 and 1, before a single poker rule is written, because if it doesn't feel good the whole product thesis needs rethinking.

---

### Phase 0: Technical spike — DONE
**Spec definition of done:** two browser tabs connect and share realtime camera/mic plus basic state.

Verified in two real tabs and by `npm run verify:phase0` (27 checks). See `README.md` for the checklist and `docs/TECH-DECISIONS.md` for what the spike corrected.

Prove the plumbing. No art, no poker, no polish. Ugly is correct here.

**Work**
- Scaffold the monorepo: `client/`, `server/`, `shared/`. One `npm run dev` starts both.
- Colyseus room: create room returns a short code, join by code, sync a trivial shared counter to prove state flows.
- LiveKit: server endpoint minting an `AccessToken` for `(room, identity)` with `roomJoin` grant. Client joins, publishes camera and mic, subscribes to the other participant.
- Two tabs on one machine with mutual video, mutual audio, and a synced value.
- Local `livekit-server` in Docker (`docker run --rm -it -v$PWD:/output livekit/generate`, then `docker compose up`) so the long middle phases don't burn cloud free-tier minutes.
- **Put LiveKit behind a `MediaProvider` interface in `client/src/media/`** and let nothing else import `livekit-client`. The scene consumes `HTMLVideoElement`, not a vendor type. Costs an afternoon now, expensive to retrofit once six modules are coupled to the SDK. Interface and rationale in `docs/TECH-DECISIONS.md`.

**Exit criteria**
- Two tabs, one room code, mutual video and audio, plus a shared value updating in both.
- Refreshing a tab rejoins cleanly without wedging the server.

**What the spike corrected**
- **The Colyseus client package is `@colyseus/sdk`, not `colyseus.js`.** `colyseus.js` still installs but its last release (0.16.22) speaks schema 3 while a 0.17 server encodes schema 4. They do not interoperate, and it fails at seat reservation before state is even decoded. Client and server minor versions must track each other.
- **`StateView` private fields use `{ type: "string", view: true }`** in the functional `schema()` API. The exported `view()` helper is a decorator for the class-based API; `view("string")` type-checks and then silently delivers the field to nobody.
- **Colyseus 0.17 `Room` takes an options bag**, `Room<{ state: S }>`, and `onLeave(client, code?: number)` receives a close code rather than the old `consented: boolean`. `onDrop` is the unclean-disconnect hook and is where phase 3's `allowReconnection()` belongs.
- An emptied room now lingers for `ROOM_EMPTY_GRACE_MS` before disposing, so refreshing the only open tab can return to the same code instead of 404ing.

**Traps**
- Autoplay policy: a remote `<video>` needs `muted` and `playsInline` before it will play without a gesture. LiveKit's `track.attach()` sets these, but if you build your own element, set them explicitly. Solve this here, not in phase 5.
- `room.state` is real but empty for the first few milliseconds after `join()` resolves. Reading through it unguarded throws inside the join handler, where it reads as a connection failure rather than a race.
- Do not let the client strip the room code out of the URL while sitting on the lobby: it turns an invite link into a bare lobby the instant it loads.
- `getUserMedia` needs a secure context. `localhost` is fine, a bare LAN IP is not. Set up HTTPS dev now if you plan to test across devices.
- LiveKit Cloud free tier is 5,000 participant-minutes/month and 100 concurrent connections. At 6 players for an hour that is roughly 14 sessions. Fine for dev and a small beta, not for traffic. Hence the local Docker server for daily work.

---

### Phase 1: Social prototype (the make-or-break phase)
**Spec definition of done:** two 3D avatars with live faces can look at each other and talk.

This is the product thesis. Build it before poker.

**Work**
- R3F scene: one table, two fixed seats facing each other, basic lighting.
- Seated first-person camera rig: camera parented to the seat at eye height. Smooth mouse-controlled yaw, clamped pitch so you can look down at your cards but never break the scene. Interpolated, never a snapping free-look. Add a subtle idle sway so it reads as a person sitting rather than a camera on a tripod.
- **No pointer lock.** For a seated, limited-arc view, pointer lock hides the cursor, triggers the browser's "press ESC" overlay, and makes bet buttons awkward. Use a constrained non-locked look (drag or edge-hover) so the cursor stays live and R3F's default raycasting keeps working with zero special-casing.
- Avatar: torso-up stylized mesh with a **face plane** on the head, a rounded oval, slightly inset, angled to the head's forward vector.
- Bind the remote LiveKit track: `const el = track.attach()` then `new THREE.VideoTexture(el)`. Crop to the face region via UV scale/offset so the framing is a face, not a laptop-webcam view of someone's ceiling.
- `texture.colorSpace = THREE.SRGBColorSpace`, or skin tones wash out. Verify flipY and mirroring empirically: your own preview should mirror, other people's should not.
- Track lifecycle: attach on subscribe, detach and **dispose** on unsubscribe. A leaked video texture per join/leave eats GPU memory within minutes.
- Mute and camera-off states: mute icon near the avatar's chest (spec section 7), placeholder face when the camera is off. Speaking indicator from LiveKit's active-speaker events.

**Exit criteria**
- Two people in a room see each other's live face on an avatar, at a plausible eye-line, and can hold a conversation.
- Mouse look feels like turning your head at a table. **Sit with it for five minutes.** If it feels like a video game camera, fix it now, not in phase 5.
- Joining and leaving repeatedly does not grow memory.

**Traps**
- Eye-line is everything. A face plane at the wrong height or angle instantly reads as a floating TV. Tune seat height, plane tilt and camera eye height together against a real face, iteratively.
- Webcam aspect (usually 16:9) onto a portrait-ish oval needs a deliberate crop, never a squash.
- `track.attach()` is required for LiveKit's adaptive stream to work at all. Reading the raw `MediaStream` bypasses visibility-based quality negotiation. The element may be off-screen or zero-opacity, but it must exist and be attached.
- Optional and cheap: drive a simple mouth-open blend from mic level (spec section 6). No AI lip-sync, explicitly out of scope.

---

### Phase 2: Poker prototype — DONE
**Spec definition of done:** two players can complete a full Hold'em hand.

Verified by 207 unit tests, `npm run typecheck`, and `npm run verify:phase2`
(25 checks against a live server), plus `poker-auditor` and `netcode-security`.
See `README.md` for the checklist and the boundaries left open.

Rules correctness, headless first.

**Work**
- Write `server/src/poker/` as a pure state machine: deck, shuffle, blinds, deal, preflop/flop/turn/river, betting rounds, showdown, pot award, button rotation.
- Shuffle with `crypto.randomInt` driving a hand-rolled Fisher-Yates. Never `Math.random()`, never `sort(() => Math.random() - 0.5)`. Ten lines, kept in-house so it stays auditable.
- Hand evaluation via `poker-evaluator` (Two-Plus-Two lookup tables, O(1) per eval, which matters when a multi-way side pot forces repeated evaluation).
- **Betting logic is hand-rolled**, not an npm dependency. The available engines are small and under-scrutinized; chip accounting is not where you trust an unmaintained black box. Read `@chevtek/poker-engine`'s pot model as a design reference: each pot stores an amount plus its set of eligible players. That pattern is the correct one.
- **Side pots.** Budget real time here. Multiple all-ins at different stack sizes is where poker engines die. Invariant asserted on every hand: *sum of all pots equals sum of all contributions.*
- Per-client privacy via Colyseus `StateView`: mark `holeCards` with `.view()` on the player schema, and in `onJoin` give each client a `StateView` containing only their own player instance. Other seats see face-down cards with no identity.
- Client: minimal HUD. Your cards, the board, pot, stacks, and Fold / Check / Call / Raise. Not pretty yet.
- Unit tests are the primary interface to the engine. Table-driven scenarios, no server needed.

**Exit criteria**
- Two players play a full hand end to end: blinds, all four streets, betting, showdown, correct winner, chips move, next hand starts automatically with no lobby round-trip.
- Tests cover: heads-up blind and button inversion, all-in short blind, min-raise rules, an under-raise all-in that does **not** reopen betting, a three-way multi-all-in side pot, split pots, odd-chip assignment.
- Devtools inspection of every frame on the wire shows **no opponent hole card anywhere**.

**What the audits caught**

`poker-auditor` and `netcode-security` both found real defects. Recording them because each one is a trap the next phase can walk back into:

- **`refundUncalled` paid an uncalled bet back to a *folded* seat.** Reachable only through `forfeit()`, so only when someone left mid-hand - which `onLeave` does on every unclean drop. Directly exploitable: three-bet big, pull the plug, and reclaim the wager if the pot ended up uncontested. The invariant everyone reaches for did not catch it, because `totalCommitted` was decremented in lockstep with the refund: chips stayed conserved and the pots still summed. The assertion that does catch it is *a folded seat's contribution never shrinks*, and the fuzz now asserts it over 4,000 hands with random leavers.
- **A sub-minimum all-in *opening bet* shut out a player who had only checked.** The reopening rule is about raises. An opening bet has no level anyone committed to, so there is nothing to reopen, and a check has never forfeited the right to raise once someone bets. `hasActed` was conflating "acted since the last full raise" with "acted at all this round".
- **Seat indices are not identities.** A player leaving mid-hand freed their seat index while the engine still held their `HandSeat`, so the next joiner could inherit their stack, their status, and their showdown attribution. Fixed on both sides: a seat the live hand still holds is not free, and `mirror.ts` matches `playerId` to `sessionId` before writing anything.
- **`create` and `joinOrCreate` were exposed over Colyseus matchmaking.** `POST /matchmake/create/poker` with `{"code":"ABCDEF"}` stood up a room on any code the caller chose - the exact squatting attack the `/api/rooms` two-step exists to prevent, through a door the verify script never knocked on. It only ever tested `join`. Both the door and the check are fixed.
- **An intent had no way to say which decision it was answering.** A double-click, or a resend arriving a street late, was indistinguishable from a fresh action. `PokerState.turn` is now an opaque token the client echoes back.

**What the build corrected**
- **`poker-evaluator` was dropped for a hand-rolled evaluator.** The package is 130 MB unpacked and `readFileSync`s the whole Two-Plus-Two table at import time, which is an I/O import inside `server/src/poker/` and therefore against this project's own rule, and ~130 MB resident on a 512 MB free tier. Its O(1) win is real and irrelevant at ~126 evaluations per showdown. Full reasoning in `docs/TECH-DECISIONS.md`.
- **The reopening rule is one flag, not a special case.** A full raise clears `hasActed` on every other active seat; an under-raise all-in does not. Players who have not acted keep their full rights, players who have may only call or fold, and the next full raise is still measured off the last real one. Encoding it any other way needs three interacting fields.
- **What you owe is capped by what an opponent can pay.** `amountToCall` measures against the deepest live opponent rather than the raw `currentBet`, which makes a big blind all-in for less than the blind fall out for free instead of needing its own branch. It pairs with an uncalled-bet refund at the close of every round, which is also what stops pot construction ever seeing a level only one player reached.
- **Private state ended up as two viewed scalars, not a viewed array.** `holeCard0` / `holeCard1` reuse exactly the `{ type: "string", view: true }` shape phase 0 verified end to end. Hold'em deals two cards, so the shape costs nothing and the audit surface is identical to the one already proven.
- **A showdown is a publication, not a widened view.** Cards become public through a `Reveal` the server writes after the hand is decided, and only for a hand that actually reached a showdown. A hand won on folds reveals nothing.

**Traps**
- Heads-up reverses button and blind order versus three-handed and up. Both need tests.
- An all-in for less than a full raise does not reopen action for players who already acted at that level.
- Never send the remaining deck stub or the RNG seed to anyone, in any form, including "for animation."
- Each `StateView` costs an extra encoding pass per client. It is purpose-built for this and worth it, but it is not free. Keep private fields minimal.
- A hand can be over before anyone acts. Two players all-in on the blinds runs the board out inside `startHand`, so the room has to be ready to mirror a finished hand straight out of the deal.

---

### Phase 3: Multiplayer — DONE
**Spec definition of done:** 3 to 6 players can join, sit, talk and play.

Verified by unit tests, `npm run typecheck`, and `npm run verify:phase3`
(46 checks against a live server: six clients, a mid-hand drop, a reconnect,
a sit-out and a six-way privacy sweep), plus `netcode-security` and
`scene-perf`. See `README.md` for the checklist and the boundaries left open.

**Work**
- Seat allocation: N fixed seats around the table, auto-assign on join, release on leave. Data-driven layout so 6 seats become 10 without touching scene code.
- Lobby flow (spec section 3): landing, Create Room / Join Room, display name, avatar picker, camera and mic permission, seated. Short shareable URL and code.
- Avatar library: cowboy, businessman, gentleman, wizard, alien, shark. One CC0 humanoid body (Quaternius modular base) differentiated by outfit, accessory and a stylized head, all sharing the same **face-plane socket** so the webcam binding is archetype-agnostic. See phase 5 and `docs/ASSET-SOURCES.md`.
- Multi-player poker: turn order around the ring, button rotation, blinds moving, sit-out and mid-hand disconnect.
- Reconnect via Colyseus `allowReconnection()` in `onDrop`/`onLeave`. Rejoining within the grace window restores the seat, the stack, and **that player's own** hole cards only.
- Video scaling (spec sections 6 and 12): `adaptiveStream: true` on the room as the baseline, since LiveKit watches the attached video element's size and visibility and picks the simulcast layer automatically. Then layer explicit `setVideoQuality(HIGH|MEDIUM|LOW)` driven by camera yaw, so the player you are looking at upgrades and the rest downgrade. Publish with `simulcast: true` or none of this works.

**Exit criteria**
- Six people join from six machines, get seated, see and hear everyone, and play multiple hands.
- Someone closing their laptop mid-hand does not stall the table. Fold-or-timeout keeps play moving.
- That person reopening their laptop gets their seat and stack back.

**What the build corrected**
- **A disconnect is three lifecycle hooks, not one.** Colyseus 0.17 routes an unclean close to `onDrop`, and only calls `onLeave` afterwards if the reconnection deferred rejects. That is what makes `onLeave` the *single* place a player is removed: the consented leave and the expired window both arrive there, so there is one function that frees a seat and one that folds an abandoned hand. Putting `allowReconnection` in `onLeave`, as older tutorials do, gives you two removal paths that have to agree.
- **Holding a seat means "empty" is no longer "no clients".** A table whose last player dropped has zero clients and one seat still being held. The dispose timer had to start counting `state.players` as well, or the room would throw away the stack and the hand somebody was about to reconnect into.
- **The reconnection window and the SDK's retry ladder are one mechanism in two halves.** The client retries fifteen times on a doubling backoff capped at five seconds, which comes to about fifty-six seconds — deliberately just inside the server's sixty. The last attempt is therefore made while the seat is still there, and giving up means the network is gone rather than that the client stopped asking early. Its `minUptime` is the one gap: a drop inside the first five seconds is treated as a bad join and never retried.
- **The action clock has two budgets and one rule.** Time is for thinking, and a chair with nobody in it is not thinking. Thirty seconds connected, five disconnected. A timeout **checks when checking is free** and folds only when staying in would cost chips: folding an absent player out of a pot they are entitled to is a rule invention, not a timeout.
- **A clock is a deadline, not a countdown you restart.** The first version re-armed a fresh budget on every connection change, which `netcode-security` caught as an exploit: *any* player at the table, in the hand or not, could hand the acting seat another thirty seconds by cycling their socket, and one player's wifi hiccup silently restarted somebody else's clock. It now computes the deadline from when the decision was put on the clock plus the acting seat's connection state, so it is a pure function of state and no sequence of drops and reconnects can push it past `turnStartedAt + TURN_TIMEOUT_MS`. The regression guard lives in `verify:phase3`.
- **"Log and give up" is not a recovery path.** A refused timeout action left the timer disarmed with the token unmoved, so the comment saying the clock could not wedge the table sat directly above the code that wedged it. It now falls back to `forfeit`, which is the abandonment path the room already had, and stops rather than re-arming if even that fails to move the clock.
- **A timed-out decision and a clicked one are the same event.** Both go through one `commit()`, so the turn token, the mirror, the payout and the next deal cannot tell them apart. Two paths into `applyAction` would be two places to forget to bump the token.
- **`adaptiveStream` cannot see attention.** It picks a layer from each element's size and visibility, and ours are six identically sized panes in a hidden sink. The thing that actually varies is where the head is pointing, which only the scene knows. Hence `AttentionDirector`: the scene measures the angle, `attention.ts` decides the level, and the vendor-neutral `setQuality` applies it. The cones are sized against the real ring — at six players a 30-degree cone would put three faces on the top layer while you sat perfectly still — and a hysteresis band stops a head resting on a boundary renegotiating its layer twice a second.
- **The avatar library shipped as plumbing, not as art.** An archetype id has to survive the join option, server validation, the schema, the snapshot and the scene, and that is the part phase 5 cannot retrofit cheaply. Procedural hats and fins prove six people can tell each other apart across a table; `archetypes.ts` is the seam the Quaternius meshes drop into, and the face-plane socket is the one thing in it that is not cosmetic.
- **A public field written unconditionally is an amplifier.** `SitOut`/`SitIn` wrote `player.sittingOut` on every inbound message, so one byte from one client became a patch fanned out to all six. Both handlers now no-op when the value is unchanged. General rate limiting is still phase 6.
- **The verify script found a bug in itself first.** Its `state()` helper was pinned to one client's room object, and a reconnected client is a *new* object whose predecessor is a dead socket frozen at the moment it died. Reading through the stale reference looked exactly like a server that had stopped responding, and cost a round of chasing a defect that was not there. Test harnesses that reconnect must read through the live seat list, never a captured client.
- **Permission belongs in the lobby, and must not be a gate.** The prompt is browser chrome that blocks until answered, and the worst moment to meet it is the instant a 3D room finishes loading. Asked before the seat, one click primes and seats — and a refusal still seats you, because watching from the table beats being stuck on a form.

**Traps**
- Six simultaneous video textures is where the frame budget first bites. Measure now, not in phase 6.
- Disconnect during a betting round is a state-machine case, not an exception handler. Model it explicitly.
- Seat layout must keep every face within a comfortable look-arc from every other seat. A true circle at 6 players puts someone directly behind you. Bias the layout toward an arc facing the player.

---

### Phase 4: Physical interaction — DONE
**Spec definition of done:** cards and chips have polished 3D interactions and sounds.

Verified by unit tests, `npm run typecheck`, and `npm run verify:phase4`
(15 checks: the shipped sound assets against the manifest and the credits
table, then a real hand replayed through the drawing layer), plus `scene-perf`.
See `README.md` for the checklist and the boundaries left open.

Where poker stops feeling like a web form.

**Work**
- Cards as physical objects: they sit on the table, you pick up and peek at your hole cards and set them back **face down**. Peeking is a local view-only affordance since the server already sent you your cards, so no round-trip.
- Deal animation: cards fly from the dealer position to each seat on an arc and settle.
- Chips: one `InstancedMesh` for every chip in the scene. Denomination stacks in front of each player, grab a denomination, push chips toward the pot. Pot chips gather in the middle, the winner's pot slides to them.
- Keep Fold / Check / Call / Raise as clear UI controls. Spec section 8 explicitly wants these as fallbacks. Physical interaction is flavor on top, never the only path to acting.
- Sound: shuffle, deal, flip, chip clink, chip slide, pot push, plus a low casino murmur bed. Sound does more work here than the visuals. A good chip clink sells physicality better than a better chip mesh.
- Motion via `@react-spring/three` or hand-rolled `MathUtils.damp` in `useFrame`. Deterministic start, end and duration means every client sees the same motion.

**Exit criteria**
- Peeking at your cards feels like lifting the corner of a real card.
- Pushing chips in feels better than clicking Call. Test this on someone who has not seen the codebase.
- No interaction can produce an illegal action. The server still validates everything.

**What the build corrected**
- **The chips are not animated; they are re-derived.** Nobody wrote a "collect the bets" animation or a "slide the pot to the winner" animation. A stack, a bet and a pot are numbers, `chips.ts` turns a number into positions, and `chipPool.ts` decides which drawn chip is which across a change of state - same denomination, nearest first. When a round closes, the same chips are simply wanted in the middle instead of in front of a seat, and they glide there because they kept their identity. Both of the phase's headline chip motions are that one mechanism pointed in different directions.
- **A split pot does not divide evenly, and that reaches the felt.** Three players splitting 65 get 21, 22 and 22, and from that moment no stack at the table is on the five. Denominations of 500/100/25/5 could not draw those stacks exactly, so the picture would have quietly disagreed with the number for the rest of the session. The 1 chip exists for that and only that: it is change, never a base, or a small blind would draw as five white chips instead of one red one. `verify:phase4` found this by running real server output through the layout, which no hand-written fixture had.
- **The gesture is not validated; it is built out of legal values.** A chip push cannot aim at an illegal action because every rung of its ladder comes from `canCheck`, `canRaise`, `callAmount`, `minRaiseTo` and `maxRaiseTo` - flags the server published. There is nothing else to land on, so there is nothing to check. The intent still travels the same `act()` path as the buttons, with the same turn token, and the server still decides.
- **A face-down card has no value, rather than a hidden one.** The face is a property of the geometry: a card this client was not sent is built from the back slot, and there is no rank or suit anywhere in the object. `cardIndex` refuses anything it does not recognise, so a malformed string cannot resolve to a face by accident either.
- **Deals are tweened and everything else is damped.** A deal has a stated start, end and duration, so every client draws the same flight; a card following a table that re-flowed, or a chip following a pot that is still growing, is damped, because those targets move for reasons no two clients agree on the timing of.
- **The room murmur is synthesised.** No CC0 crowd bed exists, and a short loop of chatter is recognisable as a loop inside a minute of an evening-long session. Three bands of filtered noise on incommensurate cycles never repeat, cost no licence row, and are the same argument the card atlas already makes for being drawn rather than downloaded.
- **Cards cast no shadow.** `scene-perf` was right that seventeen 1.6mm rectangles lying flush on felt double what the phase costs in draw calls for a shadow nobody can see.

**Traps**
- Resist adding physics. The spec asks for satisfying motion, not simulation.
- Never let a client-side card mesh hold a value the server did not send. Face-down cards are literally identity-less until revealed.

---

### Phase 5: Visual polish — DONE
**Spec definition of done:** funky premium casino, lighting, animations and UI.

Verified by unit tests, `npm run typecheck`, `npm run build` and
`npm run verify:phase5` (23 checks), plus `scene-perf`. Unlike the earlier
verify scripts this one needs nothing running: every check is a pure function
replayed against the real geometry, or a file on disk. See `README.md` for the
checklist and the boundaries left open.

Now, and only now, make it beautiful.

**Work**
- Art direction: rich wood, velvet, gold, neon accents, glass, tasteful pooled lighting over the table (spec section 4). Compact and highly polished. **Do not build a large explorable casino.** The table is the hero asset.
- **Most hero assets are built, not downloaded.** Research confirmed no clean CC0 poker table, chip or card mesh exists. That is fine, because procedural is the better answer here anyway:
  - Table: lathe or extrude an oval/octagon profile (rail plus inset felt) in Blender, export glTF, dress with ambientCG felt, wood and leather PBR sets.
  - Chips: cylinder plus optional edge lip, `CanvasTexture` denomination label, one material per denomination. Ten denominations from one material instead of ten downloads.
  - Cards: `RoundedBoxGeometry` around 50 to 100 tris, UV-mapped from a texture atlas baked from RevK's CC0 SVG playing cards.
  - Neon: emissive geometry plus bloom. Beats every free neon mesh available.
- Sourced free: Poly Haven furniture, plants, lamps and the "Warm Bar" indoor HDRI (all CC0); ambientCG materials (CC0); Quaternius Ultimate Modular Men Pack for avatar bodies (CC0); Kenney Casino Audio (CC0); Cinzel Decorative, Playfair Display and Bebas Neue from Google Fonts (OFL).
- Baked lighting and baked AO wherever possible. A small number of dynamic lights with bounded shadow maps.
- Background elements may animate subtly but must never pull attention off faces and cards.
- Avatar idle animations, per-archetype personality, outfits with a bit of exaggeration. Mixamo for rigging and idles (free for commercial use; you may ship the animations inside the game but not redistribute the raw FBX).
- UI in funky premium casino styling. Diegetic where it helps: stack counts on the table read better than a floating HUD number.

**Exit criteria**
- A screenshot of the table looks like a place someone would want to hang out.
- Faces and cards are still the two most legible things on screen.
- Still 60 FPS with 6 players.

**Budgets**
- Hero table under 15k tris, each seated avatar under 8k tris, background props under 2k tris each.
- `gltf-transform optimize in.glb out.glb --compress draco --texture-compress webp` on everything entering `public/models/`. KTX2/Basis for the large PBR sets, which otherwise ship as full-res JPG and bloat both download and VRAM.

**What the build corrected**

- **`public/models/` is still empty, and the compression pipeline never ran.** Not one mesh was downloaded. The plan had already conceded that the *hero* assets had to be built rather than sourced, because no clean CC0 poker table, chip or card exists — and once the table, the chips and the cards were being drawn, the argument kept applying outward. A round room with a velvet wall, a wainscot and eight pilasters is nine primitives. Poly Haven furniture standing behind six people who are looking at each other would have been megabytes of download to fill a space the fog already handles. The one thing that *was* downloaded is the thing that could not be drawn: two OFL fonts, 29KB together.
- **A texture that knows where the bets are is worth more than a photographic one.** The felt is a single 1024px disc rather than a tiled ambientCG swatch, and that is not a compromise, it is the better artefact: because a `CircleGeometry` maps its disc into the unit square, the whole surface can be drawn *in world radii*, so the betting line is placed by asking the layout where a bet actually lands. It sits between the stack anchor and the bet anchor, which means chips genuinely cross it when they are pushed. A downloaded felt could not know that. The five PBR sets the phase budgeted for would have been twenty 2K JPEGs and a KTX2 pipeline, to add measured detail to surfaces that are deliberately dark, deliberately behind the faces, and never seen closer than a metre.
- **Bloom was the wrong tool, and it was wrong for a product reason rather than a performance one.** The plan asked for "emissive geometry plus bloom". Bloom is a screen-space effect, so it cannot tell a neon tube from a webcam highlight on somebody's forehead — every bright face in the room would start to glow, which is precisely the thing the art direction may not do. It also means an `EffectComposer`, which takes the scene off the default framebuffer and takes MSAA with it, so every card edge and face plane would need an SMAA pass to get back to where it already was. Emissive geometry plus additive glow sprites puts the halo exactly where a fixture is, costs one transparent quad each, and — unlike a post pass — can be *checked*.
- **"Faces stay the most legible thing" is a number now, not an intention.** A face plane is 0.34m tall on a 0.34m halo scale at `EYE_HEIGHT`, and the room is 7.2m across, so from every seat the far wall is directly behind somebody's head. Every emissive fixture therefore declares its vertical extent in `decor.ts`, and both the unit tests and `verify:phase5` assert that none of them intersects that band. The same argument capped the wainscot rail below it: a horizontal line at chin height running right round the room behind everybody is the sort of thing nobody points at and everybody registers.
- **Every fixture in the room is a ring, for the reason the seating is.** A neon sign on one wall is behind somebody. A sconce at one bearing is over one person's shoulder and nowhere near anyone else's. `seatLayout` already established that anything not rotationally symmetric quietly gives one seat a better view than the others, and a room is subject to that rule exactly as a table is. So the sign became a cornice race, the sconces became a ring of eight, and the wordmark that would have gone on the felt was cut rather than pointed at a favourite.
- **The rail is bounded by the deck, not by the hole cards.** The binding constraint on how far in the padded rail may come turned out not to be the cards in front of a player at 0.894m but the *deck*, off the button's left at 0.912m, where every card of every hand begins its flight. Nothing in the type system connects a lathe profile to a card anchor, so `verify:phase5` replays every anchor at every seat count against it: 22mm of margin at the worst case. This is the phase-5 equivalent of the odd chip a split pot leaves behind — a number no hand-written fixture would have contained.
- **`LatheGeometry`'s winding rule is not the obvious one, and it cost a bug.** Three.js computes lathe normals along the profile as `(dy, -dx)`, so the correct rule is "traverse the cross-section counter-clockwise", not "list the points bottom to top". Those agree for the apron and the pedestal, which never turn over. They disagree for the rail, which goes up the inside, over a crown and down the outside — authored bottom-to-top, its crown faces the floor, and the table reads as lit from underneath in a way that is very hard to diagnose by eye. The convention is a function now (`profileNormal`) and the tests assert the sign of it at the crown and at the inner wall.
- **Mixamo was the wrong answer for these bodies.** The plan pointed at it for idles, but these avatars are a capsule, a cylinder and a sphere with a video plane on the front — there are no joints to drive, so retargeting a mocap clip is a large download for a body that cannot use it. What an idle has to do here is narrower: make six people who are sitting still look like six *different* people who are sitting still. As `f(t) -> pose` that is identical on every client without syncing a byte, costs no licence row, and — the reason it is a pure module rather than four lines in `useFrame` — its amplitude is a number that can be asserted. Two hours of every archetype, swept against ceilings, in the verify script.
- **A sway pivots at the hips, and finding that out was the whole of the tuning.** The seat's origin is on the carpet. Rolling a body about it swings the head through six centimetres for the two degrees the idle allows, which reads as a person swaying in a boat. Pivoting at hip height puts the head two thirds of a metre out instead, and the same two degrees becomes somebody shifting their weight in a chair.
- **The Quaternius bodies were not swapped in either, and the socket is why.** Every dimension of these avatars is derived from `EYE_HEIGHT` through `body.ts`, which is what makes a face plane land on a neck rather than float over one. A downloaded rig arrives with its own proportions and its own idea of where a head is, so adopting one means re-deriving that relationship against a mesh nobody can edit — to gain skinned shoulders on a body seen from the chest up, mostly in shadow, under the one thing anybody is actually looking at. What the plan wanted out of that swap was personality and silhouette, and both are cheaper to author directly.
- **The numbers moved onto the table and the names stayed on the body.** Spec section 8 keeps the flat list as a fallback, but it is no longer where anybody finds out how much someone has: each seat's stack is engraved on the inner slope of the rail in front of it, which from every other seat is directly under that person's face and is therefore read in the *same glance*. The same number in a panel in the corner is read instead of a face. The split falls out cleanly — who you are travels with you, what you have sits where you are sitting.
- **Court cards are devices rather than figures.** A real court card is an engraving with a face, a costume and a mirrored half, and any attempt at one inside a 128×180 canvas cell lands between crude and unreadable. The job is only ever "this is a king, from two metres, at an angle", and a framed panel with a rank over a knocked-back suit does that better than a bad imitation. The numbered ranks did get the real English pip patterns, inverted below the midline as a real card is — because a five you have to *count* is exactly what a card across a table must not be.
- **The chips' edge spots are the wrong colour on purpose.** One texture, one material, one draw call is the project rule, so the instance colour multiplies through a grey map and a chip's spots come out a brighter shade of its own denomination instead of the white of a real casino chip. True white would need a per-instance UV attribute and an `onBeforeCompile` patch against three.js internals — a lot of fragility for a detail on a two-centimetre object seen from a metre away.

**Traps**
- The room is not a place. It has no doors, nothing to walk to and a 3.6m radius, and `decor.test.ts` fails if that grows past 5m. "Do not build a large explorable casino" is easier to obey while there is still nothing there.
- Anything added to the room has to declare where it glows. A fixture that is not in `FIXTURES` is not checked against the face band, and a rule with two lists is a rule with a hole in it.

---

### Phase 6: Reliability — DONE
**Spec definition of done:** permissions, reconnects, edge cases, browser compatibility and performance.

Verified by unit tests, `npm run typecheck`, `npm run build` and
`npm run verify:phase6` (56 checks), which needs nothing running. The two exit
criteria that need people rather than a script — 60 FPS measured on the target
laptop, and a one-hour six-player session — are carried into phase 7, where
there are six people. See `README.md` and `docs/BROWSERS.md`.

**Work**
- Permission flows: denied camera, denied mic, no devices, device unplugged mid-session, permission revoked mid-session. Every one gets a graceful state and a way back, and camera and mic must stay explicitly reversible (spec section 16).
- Browser matrix: Chrome, Safari, Edge on Mac and Windows. Safari is the one that will hurt. Test it deliberately and early in this phase, not at the end.
- Performance: profile a real 6-player room on a MacBook Air. Draw calls, texture memory, shadow cost, video texture cost. Add a quality setting plus automatic fallback for weak GPUs (spec section 12).
- Network edge cases: server restart, room expiry, duplicate join, same room in two tabs, action spam.
- Security pass: WSS and HTTPS in production, high-entropy room tokens, rate-limited room creation and actions, no persistence of any A/V (spec section 16).
- Full protocol re-audit for private-state leaks now that every message exists.
- Hosting caveats to handle: Render's free tier spins down after 15 minutes idle with roughly a one-minute cold start, so add a keep-alive during active sessions. Supabase free projects pause after a week idle, so schedule a ping.

**Exit criteria**
- A one-hour six-player session with no crash, no desync, no stuck hand.
- Every permission denial path recoverable without a page reload.
- Verified 60 FPS on the target laptop, and the fallback path verified on a deliberately throttled GPU.

**What the build corrected**

- **The hard part of a permission flow is not the message, it is the verb.** The plan lists five denial paths and asks for "a graceful state and a way back", which reads as a request for five sentences. It is not. There are only four honest things a browser can offer — try again, go to site settings, plug something in, nothing — and *picking the wrong one is worse than saying nothing at all*. Nothing a page does can turn a denied permission into a granted one, and Chrome will not even re-prompt after a hard denial, so a Retry button on a refusal is a button that fails silently every time it is pressed. That is precisely how somebody concludes the whole app is broken rather than that their camera is off. `faults.ts` therefore stores the *recovery verb* and derives `retryable` from it, so the two can never disagree, and `verify:phase6` asserts the biconditional across all eleven errors `getUserMedia` can throw.
- **Connecting and publishing shared a `try`, and that was a real bug.** A refused camera came out of `useMedia` as a failed *connection*: the player was dropped to `failed` and the whole table went away, over a device. Those are not the same event. Failing to reach the SFU means nobody can see or hear anybody; failing to open a camera means one person is not being seen, at a table they are otherwise fully seated at, talking to five people who can hear them fine. Splitting them was four lines, and it is the change in this phase that most alters what a bad evening feels like — the difference between "your camera is off" and "you have been thrown out".
- **The invisible failure was the one worth building for.** Four of the five paths announce themselves with an exception. The fifth — permission revoked from the browser's own settings, mid-session — does not: no call fails, no track ends with an error, the `PermissionStatus` flips underneath a running session and the avatar goes on showing whichever frame was up. The symptom is a photograph of somebody who is still talking, which is also the symptom of three unrelated bugs this project has already had. It needs an explicit watcher, and **Safari cannot provide one**: no `camera` or `microphone` descriptor, no workaround. That gap is now written down in `docs/BROWSERS.md` rather than discovered by a friend on a Mac.
- **`lite` was right about phones and silent about everything else.** Phase 5 shipped one boolean meaning "this is a handset", which turned off shadows and multisampling. But a five-year-old laptop, a browser with hardware acceleration disabled, and a machine thermally throttled after an hour of poker all need exactly those savings, and none of them is a phone. `useViewport` can only answer the question it is asked — screen size and pointer type — and none of the real cases change either. The replacement is a tier, decided by the only number that actually knows: how long the last frame took.
- **The probe is the smaller half, and it had to be built to be ignorable.** `deviceMemory` is Chromium-only, `WEBGL_debug_renderer_info` is being removed from the platform for fingerprinting reasons, and Safari reports neither. A probe built to *require* those would put every Safari user on the floor. So `probeTier({})` is `high` — an absent signal is explicitly not evidence of a weak machine — and the probe's job is narrowed to the two things it can be certain about: a software rasteriser by name, and a handset. Everything else starts at the top and is moved by the frame clock within two seconds.
- **A quality ladder that oscillates is worse than either of the tiers it alternates between.** Every step reallocates a shadow map and renegotiates video layers, so a machine flapping between medium and high stutters more than one pinned to low. The fix is asymmetry, and the ratio is the design: two seconds of clearly bad frames demotes, twelve seconds of clearly *good* ones promotes, the band between the two thresholds advances neither counter, and a session demoted twice stops climbing for good. A borderline machine therefore trips the fast rule, never the slow one, and settles. That is a test rather than a hope, which is the only reason the numbers can be retuned later without fear.
- **What the fallback spends is not what you would guess.** The instinct is to cut geometry and lights. The actual cost on a weak machine is eight simultaneous video decodes, which is more than everything else in the frame put together and is paid on the CPU, where a throttled laptop has the least left to give. So the floor's largest saving is the top simulcast rung: the face you are looking straight at drops from capture resolution to h180. The rule the tests enforce is that **no tier may ever turn a face off** — a room with no faces in it is not a cheaper version of this product, it is a different and much worse one.
- **The socket's threat model is not an outsider, it is a guest.** Phase 3 locked matchmaking down and rate-limited room creation per address, which covers the internet. It does not cover the person who already has a seat and an open console, and that is the only person who can reach `onMessage` at all. `buy-in` was the amplifier, and it *cannot* be fixed with the equality check that defused `sit-out`: the minimum top-up for a seat with any chips is 1, so `{"amount":1}` in a loop is accepted every time and each acceptance dirties two public fields that fan out to the whole table. The budgets are per client *and* per type, because one shared bucket would mean a player who bought in six times could not then fold — which turns a limiter into a way of freezing somebody out of their own hand.
- **The refusal is silent, and that is the security decision.** Answering an over-budget message would hand the flooder an amplifier: one inbound frame becoming one outbound frame is exactly the trade that put `action` on the list, since it answers every out-of-turn frame with an `ActionRejected`. The evidence goes to the server log instead, once per client per window. And the check lives in `onIntent` rather than inside each handler, because a guard placed after the state lookup has already paid for the frame it is refusing; `verify:phase6` counts the raw `onMessage` calls and fails if there is ever more than the one.
- **Two tabs is not a server bug, which is exactly why it needed a client fix.** The server is entirely correct: two tabs are two sessions, two seats, two private hands. The damage is local and severe — both publish the *same microphone*, so the table hears the person twice half a second apart and their own speakers feed one of their mics. And the server can never fix it, because it cannot distinguish two tabs of one browser from two laptops in one room, and that second case is the product working as designed. `BroadcastChannel` can, being same-origin. The protocol is deliberately asymmetric — only a tab that already *holds* the table answers a claim, so the second to arrive is always the one told it is second — and deliberately advisory: it never closes anything, because a stale claim from a tab that crashed must not be able to lock somebody out of their own table.
- **The keep-alive the plan asked for already existed, and in a better place.** `.github/workflows/keep-server-awake.yml` pings `/api/health` every five minutes from outside the process, and its own comments already carry the argument against the in-session version: a server that has spun down cannot ping itself awake, and Render reserves the right to suspend services for self-directed outbound traffic. A client keep-alive would only ever hold awake a server that was already awake, because the session holding the socket open *is* the traffic. Nothing was added. The Supabase ping was not added either, for the simpler reason that nothing is wired to Supabase — room metadata still lives in process memory.
- **TLS needed asserting at both ends, because neither end can see the other's.** The server terminates plain HTTP behind Render's proxy and cannot know what scheme a browser used; the client cannot know what the server was configured with. What each *can* check is what an operator typed at it — `CORS_ORIGINS` on one side, the baked-in `VITE_` URLs on the other. Both refuse to start rather than warning, and both exempt loopback so a production build can still be run locally to reproduce something. This is the one place in the codebase where refusing to boot is the safe outcome: a deploy that will not start is a five-minute problem, and a deploy that starts and sends hole cards in the clear is a problem nobody notices.
- **The leak audit came back clean, and how it is written down is the deliverable.** Two `client.send` calls, both addressed to one client; no `broadcast` anywhere; no rejection reason that can quote a card; hole cards written in one file and viewed in one function. What changed is that the audit is now a *closed set* — `verify:phase6` enumerates every file on the wire side that names `holeCard` and fails on a fifth one — rather than a grep somebody ran once. A debug payload, a log line or a convenience getter is the shape this bug would actually take, and none of those would have failed any other test in the repo.

**Traps**
- A Retry button that cannot retry is worse than no button. When a failure mode is added to `faults.ts`, the verb is the decision; the sentence is the easy part.
- Anything added to `QualityProfile` has to be read by the scene, or the tier is a setting that changes nothing. `verify:phase6` checks each knob by name for exactly that reason.
- A new client message without a budget is a compile error today, because `MESSAGE_LIMITS` is an exhaustive `Record`. Keep it that way: a `Partial` here would be a hole with a default in front of it.

---

### Phase 7: Private beta
**Spec definition of done:** test with real friend groups and iterate on the social experience.

**Work**
- Ship to real hosting, hand out real links, run real poker nights.
- Switch LiveKit from local Docker to LiveKit Cloud (see `docs/TECH-DECISIONS.md`) so remote friends outside the dev machine's network can actually connect — local Docker has no public TURN/relay.
- Watch what people actually do. The metric is not bugs found, it is **whether they keep talking after the hand ends.** That is the whole product.
- Iterate on presence: seat layout, eye-line, face crop, voice levels, table proportions. These are the levers that move the feeling.
- Collect the next roadmap (spec section 19: blackjack, Uno-style games, trivia, avatar customization, spectator mode, themed rooms).

**Exit criteria**
- Six real friends complete a full poker night without the developer in the room narrating fixes.
- At least one of them says some version of "it feels like we're actually sitting together."

---

## 4. Definition of done (spec section 21)

The V1 gate. Every line demonstrably true:

- [ ] A host creates a private room and shares a link
- [ ] At least six players can join
- [ ] Each player is assigned a fixed seat
- [ ] Players see and hear one another live
- [ ] Each real webcam face appears on the selected 3D avatar
- [ ] Mouse-look feels smooth and seated
- [ ] Players can look down and interact with their cards
- [ ] A complete Hold'em hand can be played
- [ ] Hidden cards remain private
- [ ] Game state is server-authoritative
- [ ] Players can immediately start another hand
- [ ] The casino feels visually cohesive and polished
- [ ] Runs on a modern MacBook Air with no native app

---

## 5. Standing constraints

Apply in every phase. Also encoded in `CLAUDE.md` so they survive into day-to-day work.

**Assets are free or they don't ship.** CC0 preferred, CC-BY acceptable only with attribution recorded in `docs/ASSET-CREDITS.md`. No paid assets, no CC-BY-NC, no EULA forbidding redistribution. A browser game hands the mesh to every visitor, so redistribution restrictions are disqualifying. Every accepted asset gets a credits row the moment it is added. Run `/asset-check` before any release. Two specific traps found during research: Sketchfab titles can say "CC0" while the actual license badge reads CC-BY (the Polygonal Mind "100 Avatars CC0" pack is exactly this), and Ready Player Me's web-creator avatars are CC-BY-NC-SA unless you register as a paid partner. Always read the license field on the page, never the title.

**The server is authoritative.** Clients send intents, never outcomes. Never trust a client-supplied seat, amount, balance, card or result.

**Hole cards are private server state.** Not "the client doesn't render them," genuinely absent from that client's payload.

**Fake chips only.** No real-money mechanics of any kind. No recording or persistence of webcam, microphone or voice data.

**60 FPS on a MacBook Air** is a design constraint that shapes the art, not a phase-6 cleanup task.

---

## 6. Cost

Spec section 17 budgets 20 to 300 USD upfront. With the asset strategy above that lands near the bottom of the range:

| Item | Cost |
| --- | --- |
| All 3D models, textures, HDRIs, audio, fonts | 0 (CC0 or procedural) |
| LiveKit | 0 on free tier for dev and beta, 50/mo before real traffic |
| Colyseus | 0 self-hosted (MIT), 15/mo managed if ops burden grows |
| Client hosting (Cloudflare Pages) | 0, unlimited bandwidth |
| Game server hosting (Render) | 0 on free tier, accepting the idle spin-down |
| Supabase | 0 on free tier |
| Domain | the one likely real expense |

---

## 7. Tooling in `.claude/`

Four project agents, invoked by name:

- **`asset-scout`**: sources and license-verifies free 3D models, textures, HDRIs, fonts and SFX. Knows the rejection rules and always reports what should be built procedurally instead. Appends accepted assets to `docs/ASSET-CREDITS.md`.
- **`poker-auditor`**: audits `server/src/poker/` for rules bugs, with side pots, heads-up ordering and min-raise reopening at the top of its checklist. Run after any engine change.
- **`netcode-security`**: traces every outbound message for leaked private state and every inbound message for missing server validation. Run after any protocol change.
- **`scene-perf`**: reviews the R3F scene against the 60 FPS MacBook Air target. Draw calls, instancing, video texture disposal, shadow cost.

Two slash commands:

- **`/asset-check`**: audits shipped assets against `docs/ASSET-CREDITS.md` and the free-for-commercial-use rule.
- **`/phase [n]`**: checks the codebase against a phase's exit criteria and names the next task.
