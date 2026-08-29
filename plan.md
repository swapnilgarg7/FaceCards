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
- **The action clock has two budgets and one rule.** Time is for thinking, and a chair with nobody in it is not thinking. Thirty seconds connected, five disconnected, re-armed on every connection change rather than fixed when the street opened. A timeout **checks when checking is free** and folds only when staying in would cost chips: folding an absent player out of a pot they are entitled to is a rule invention, not a timeout.
- **A timed-out decision and a clicked one are the same event.** Both go through one `commit()`, so the turn token, the mirror, the payout and the next deal cannot tell them apart. Two paths into `applyAction` would be two places to forget to bump the token.
- **`adaptiveStream` cannot see attention.** It picks a layer from each element's size and visibility, and ours are six identically sized panes in a hidden sink. The thing that actually varies is where the head is pointing, which only the scene knows. Hence `AttentionDirector`: the scene measures the angle, `attention.ts` decides the level, and the vendor-neutral `setQuality` applies it. The cones are sized against the real ring — at six players a 30-degree cone would put three faces on the top layer while you sat perfectly still — and a hysteresis band stops a head resting on a boundary renegotiating its layer twice a second.
- **The avatar library shipped as plumbing, not as art.** An archetype id has to survive the join option, server validation, the schema, the snapshot and the scene, and that is the part phase 5 cannot retrofit cheaply. Procedural hats and fins prove six people can tell each other apart across a table; `archetypes.ts` is the seam the Quaternius meshes drop into, and the face-plane socket is the one thing in it that is not cosmetic.
- **Permission belongs in the lobby, and must not be a gate.** The prompt is browser chrome that blocks until answered, and the worst moment to meet it is the instant a 3D room finishes loading. Asked before the seat, one click primes and seats — and a refusal still seats you, because watching from the table beats being stuck on a form.

**Traps**
- Six simultaneous video textures is where the frame budget first bites. Measure now, not in phase 6.
- Disconnect during a betting round is a state-machine case, not an exception handler. Model it explicitly.
- Seat layout must keep every face within a comfortable look-arc from every other seat. A true circle at 6 players puts someone directly behind you. Bias the layout toward an arc facing the player.

---

### Phase 4: Physical interaction
**Spec definition of done:** cards and chips have polished 3D interactions and sounds.

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

**Traps**
- Resist adding physics. The spec asks for satisfying motion, not simulation.
- Never let a client-side card mesh hold a value the server did not send. Face-down cards are literally identity-less until revealed.

---

### Phase 5: Visual polish
**Spec definition of done:** funky premium casino, lighting, animations and UI.

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

---

### Phase 6: Reliability
**Spec definition of done:** permissions, reconnects, edge cases, browser compatibility and performance.

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
