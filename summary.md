# FaceCards (Virtual Poker Night) - Technical Summary

Browser-based multiplayer Texas Hold'em where the product is the *feeling of
sitting at a table with friends*, not the poker. Six players sit in fixed seats
around a 3D casino table as low-poly avatars, each avatar's head carrying that
person's **live webcam face**, everyone talking over live voice.

Source of truth for requirements: `virtual_poker_night_developer_spec.pdf`.
Build order and per-phase retrospectives: `plan.md`. Known issues: `defects.md`.

---

## 1. Shape of the system

Three deployables, one npm workspace monorepo.

```
client/   React + TypeScript + Vite        the 3D table, the UI, the face pipeline
server/   Node + TypeScript (Colyseus)     authoritative deck, turn order, pot maths
shared/   protocol types + constants       imported by both ends, changed first
```

Media never touches the game server. The browser talks to the LiveKit SFU
directly; the server only mints the token that lets it in.

```
 Browser ──WebSocket (Colyseus)──> Game server (deck, bets, pots, StateView)
    │                                   │
    │                                   └── mints scoped LiveKit JWT
    └──WebRTC (LiveKit SFU)──> other browsers' camera + mic tracks
```

---

## 2. Technology stack (pinned)

| Layer | Choice | Version |
| --- | --- | --- |
| UI framework | React + TypeScript + Vite | React 19.2, Vite 8 |
| 3D renderer | `three` | 0.185.1 |
| React/3D bridge | `@react-three/fiber` | 9.7.0 (pairs with React 19) |
| 3D helpers | `@react-three/drei` | 10.7.8 |
| Physics | **none, deliberately** | n/a |
| Animation | hand-rolled `MathUtils.damp` + deterministic tweens | n/a |
| Voice / video | LiveKit (`livekit-client` / `livekit-server-sdk`) | client 2.22.0 |
| Face detection | MediaPipe `FaceDetector` (BlazeFace short-range) via `@mediapipe/tasks-vision` | 1.0.1, Apache 2.0 |
| Networking | Colyseus + `@colyseus/schema`, client `@colyseus/sdk` | 0.17.10 / 4.0.30 / 0.17.43 |
| HTTP | Express 5 + CORS | 5.2 |
| Poker engine | hand-rolled, pure TypeScript | n/a |
| Shuffle | `crypto.randomInt` + Fisher-Yates, server only | n/a |
| Language | TypeScript (deliberately 5.x, not the 7.x Go port) | 5.9.3 |
| Tests | Vitest | 4.1 |
| Client hosting | Cloudflare Pages | n/a |
| Server hosting | Render (free tier) | Node >= 22 |
| Media hosting | LiveKit Cloud for playtests, local Docker SFU for daily dev | n/a |

Full reasoning for every row: `docs/TECH-DECISIONS.md`.

### Three picks that shape everything else

**Colyseus `StateView`, not a hand-rolled `ws` protocol.** The two hardest
parts of this server are per-client private state (hole cards) and clean
reconnection, and both are native to Colyseus 0.17. The removed `@filter()`
decorators are replaced by `StateView`, which is exactly the hole-cards problem
expressed as a first-class feature.

**No physics engine.** Deals, chip pushes and pot collection are scripted,
server-triggered events, not emergent simulation. Rigid bodies would buy
cross-client nondeterminism, collider tuning and a WASM payload in exchange for
nothing the spec asks for. Deterministic tweens and damped lerps mean every
client watches the same flight.

**No pointer lock.** This is a seated view with a bounded head-turn arc, not an
FPS. Pointer lock would hide the cursor, turn every bet button into a mode
switch, and put a browser "press ESC" overlay across a poker UI. Constrained
yaw and pitch keeps the cursor visible and R3F's default raycasting working.

---

## 3. UI: how the interface is built

- **React 19 + Vite**, plain CSS (`client/src/styles.css`). No component
  library, no CSS framework, no state-management library. Room state arrives as
  a Colyseus mirror and is read through hooks.
- **Two self-hosted OFL fonts, 29KB together**: Cinzel Decorative where
  something should read as engraved, Bebas Neue for every chip count in the
  product. Brass on oxblood glass over a warm ground, so the flat UI matches the
  room underneath rather than sitting on it as a separate application.
- **Diegetic first.** Each seat's stack count is engraved on the inner slope of
  the rail in front of it, which from every other seat sits directly under that
  person's face and is therefore read in the *same glance*. Who you are travels
  with you (the name plaque on the body); what you have sits where you are
  sitting.
- **The flat controls never go away.** Fold / Check / Call / Raise stay as
  buttons with keyboard shortcuts (`ui/keybinds.ts`), because the physical chip
  push is flavour on top and never the only path to acting.
- Screens and overlays: `Lobby`, `PlayGate` (autoplay unlock), `ActionBar`,
  `HandHud`, `TurnClock`, `ShowdownOverlay`, `Leaderboard`, `SettingsPanel`,
  `MediaFaultBanner`, `ServerWaking`, `AvatarPicker`, `PokerMoment`,
  `NightInReview`.

---

## 4. UX: the decisions that define the feel

**Presence beats poker features.** Every tradeoff is resolved toward faces,
voice, eye-line and the physicality of cards and chips.

- **Peeking.** Hold Space, or press and hold on your own two cards, and they
  draw back and stand up. Entirely local and view-only: the server already sent
  this client its own cards, so there is no round-trip and nothing for anyone
  else to see.
- **Pushing chips in.** On your turn, drag from your own stack toward the pot.
  The pile grows under your hand and detents click past as the amount changes.
  It *cannot aim at an illegal action*, because every rung of the ladder is
  built from the legality flags the server published, so there is nothing else
  to land on and nothing to validate client-side.
- **Never offer an action that cannot succeed.** Every failure classifies to a
  *recovery verb*; the UI renders the verb and decides nothing. A denied camera
  permission gets a sentence, not a Retry button, because nothing a page does
  can turn a denial into a grant, and a button that fails silently every time is
  how somebody concludes the whole app is broken.
- **The hand ends when people are done reacting**, not on a timer. The showdown
  stays up until every live seat sends `next-hand`, with a server-side maximum
  so one closed laptop cannot park the table.
- **Poker Moments.** After a hand worth photographing, one frame per person is
  captured client-side and handed back to the table with a caption. Nothing is
  recorded, uploaded or written to disk. Whether a hand is worth it is decided
  from a *server-derived* story (`server/src/poker/story.ts`), never re-read
  from cards on the client.
- **Rotational symmetry as a UX rule.** Seating, the pot ring, the light races
  and every fixture in the room are rings, because anything not rotationally
  symmetric quietly gives one seat a better view than the others.
- **Six people sitting still must look like six different people.** Per
  archetype idles (`avatars/idle.ts`) authored as `f(t) -> pose`: identical on
  every client without syncing a byte, and with an amplitude ceiling asserted in
  tests, so an idle can never swing a face plane off its socket.

---

## 5. Method: how the 3D and the face pipeline work

**The scene is procedural, not downloaded.** `public/models/` is empty on
purpose. No clean CC0 poker table, chip or card mesh exists, and once the hero
assets were being authored the argument kept applying outward:

- **Table**: lathed cross-sections authored as numbers in
  `scene/tableProfile.ts` (rail, apron, pedestal), brass inlay, a neon race
  under the rail lip. 3,528 triangles against a 15k budget.
- **Felt**: one 1024px disc rather than a tiled swatch, so the whole surface can
  be drawn in *world radii* and the betting line lands exactly where the layout
  says a bet lands.
- **Cards**: textured planes from a single canvas-drawn atlas
  (`scene/cardAtlas.ts`) with the real English pip patterns, inverted below the
  midline. A card this client was not sent is built from the *back* slot and
  carries no rank or suit anywhere in the object: a face-down card has no value,
  not a hidden one.
- **Chips**: every chip in the room in one `InstancedMesh`, one texture, one
  material, one draw call. The cylinder's UVs are squeezed so the caps sample
  the face design and the rim samples the edge spots.
- **Room**: a round shell of nine primitives, 3.6m radius. Emissive geometry
  plus additive glow sprites rather than a bloom post-pass, because bloom is
  screen-space and cannot tell a neon tube from a highlight on somebody's
  forehead.
- **Legibility as an assertion**: every fixture declares its vertical extent,
  and both the unit tests and `verify:phase5` fail if any of them glows inside
  the band of height a face occupies.

**Webcam to avatar face, the core trick:**

1. LiveKit `track.attach()` produces an `HTMLVideoElement`. This is mandatory:
   reading the raw `MediaStream` bypasses visibility-based quality negotiation
   and silently kills adaptive stream.
2. That element becomes a `THREE.VideoTexture` with `SRGBColorSpace`, mapped
   onto the avatar's face plane. Your own preview mirrors, remote faces do not.
3. **Face framing is detected on the sender and broadcast, not guessed.**
   MediaPipe `FaceDetector` runs locally in the browser (a ~230KB model on a
   lazily imported wasm runtime, so it is not in the bundle anyone downloads to
   reach the lobby) and the resulting box travels as a LiveKit datagram. A fixed
   crop window cannot frame a face; it frames wherever the person happened to be
   sitting when the constants were tuned. Smoothing and crop maths live in pure
   modules (`scene/faceBox.ts`, `faceCrop.ts`, `faceSmooth.ts`).
4. Textures are disposed and elements detached on unsubscribe, because leaked
   video textures eat VRAM fast at six players cycling in and out.

**Scene code mutates refs inside `useFrame`.** It never sets React state per
frame. Maths lives in `.ts` files and is unit-tested; renderers live in `.tsx`.

**Chips are not animated, they are re-derived.** A stack, a bet and a pot are
numbers; `chips.ts` turns a number into positions and `chipPool.ts` decides
which drawn chip is which across a change of state (same denomination, nearest
first). "Collect the bets" and "slide the pot to the winner" are the same
mechanism pointed in different directions, with no animation code for either.

**Audio** is derived from the difference between one state snapshot and the
next, so a cue cannot fire twice for one event or be missed because two patches
coalesced. Kenney CC0 casino foley for shuffle, deal, flip, fold and chips, plus
a *synthesised* room murmur: three bands of filtered noise on incommensurate
cycles, which never loops audibly and costs no licence row.

---

## 6. The server and the security model

**The server is authoritative.** Clients send intents, never outcomes. A client
asks to raise to an amount; it never states the pot, the winner or its own
stack. Room codes are drawn by the server; media identity is the Colyseus
session id, so there is no route where a caller states who they are.

**Poker lives in `server/src/poker/` and is pure**: `cards`, `shuffle`,
`blinds`, `evaluate`, `pots`, `engine`, `story`. It imports nothing from
`rooms/`, `state/` or any I/O, which is what makes it exhaustively unit-testable
without a server. The client never re-implements a rule.

**Hole cards are private server state.** Fields marked `view: true` in
`shared/src/state.ts` reach only clients whose `StateView` includes that
instance, wired in exactly one function (`server/src/state/view.ts`). The only
other way a card becomes public is a `Reveal` the server writes at a real
showdown. The audit is a *closed set*: `verify:phase6` enumerates every file on
the wire side that names `holeCard` and fails on a fifth one, because a debug
payload, a log line or a convenience getter is the shape this bug would actually
take.

Other protocol guarantees, each asserted rather than documented:

- Two `client.send` call sites, both addressed to one client. No `broadcast`.
- No rejection reason can quote a card.
- **Every client message has a budget**, per client *and* per type, checked in
  `onIntent` before the handler (`rooms/messageLimits.ts`). Over-budget messages
  are dropped silently, because answering one would hand a flooder an amplifier.
  `MESSAGE_LIMITS` is an exhaustive `Record`, so a new message without a budget
  is a compile error.
- **TLS asserted at both ends.** A server whose `CORS_ORIGINS` is not https
  refuses to boot; a client bundle pointed at `ws://` throws at module load.
  Loopback is exempt. Hole cards ride that socket.
- **No real money, and no persistence of any A/V.** Virtual chips only.

---

## 7. Reliability and performance

- **Five permission paths, all recoverable without a reload**: refused up front,
  no device, unplugged mid-session, taken by another app, and revoked from
  browser settings while seated. Each classifies to a fault carrying a recovery
  verb; `retryable` is *derived* from the verb, so a Retry on an unretryable
  failure is unrepresentable rather than merely untested. `devicechange` is
  diffed rather than acted on, so a camera plugged back in recovers with no
  click and a pair of headphones changes nothing.
- **Connecting and publishing are separate failures.** A refused camera means
  one person is not being seen at a table they are otherwise fully seated at,
  not that they were thrown out.
- **Three quality tiers with automatic fallback.** A probe picks the starting
  tier (an absent signal is explicitly *not* evidence of a weak machine, so
  Safari starts high), and a frame clock moves off it within two seconds.
  Demotion is fast, promotion is six times slower, a dead band between the
  thresholds advances neither counter, and a session demoted twice stops
  climbing, so a borderline machine settles instead of oscillating.
- **No tier may ever turn a face off.** What the fallback spends is pixel ratio,
  shadows and the top simulcast rung, because the real cost on a weak machine is
  eight simultaneous video decodes, paid on the CPU.
- **The same table in two tabs** is detected over `BroadcastChannel` and named.
  It is not a server bug (two tabs are two honest sessions) and the server can
  never fix it, because two tabs of one browser are indistinguishable from two
  laptops in one room. The protocol is asymmetric (only a tab already holding
  the table answers a claim) and advisory (it never closes anything, so a stale
  claim cannot lock somebody out of their own table).
- **Browser support is probed, never version-checked.** Matrix and by-hand test
  plan in `docs/BROWSERS.md`. Known gap: Safari implements no `camera` or
  `microphone` Permissions API descriptor, so revocation mid-session cannot be
  watched there.
- Render's free tier spins down after 15 minutes idle, so
  `.github/workflows/keep-server-awake.yml` pings `/api/health` from outside the
  process. An in-session keep-alive was deliberately *not* added: a server that
  has spun down cannot ping itself awake.

---

## 8. Engineering method

Full account in `docs/ENGINEERING-STYLE.md`; packaged for reuse in
`docs/portable/`.

> Everything that decides something is a pure module with a unit test.
> Everything that touches the world is a thin shell with no test, covered
> instead by a simulation that replays the real modules.

- **Decisions are pure; wiring is thin.** Anything with arithmetic, a
  classification, a threshold or a rule lives in a module with no framework or
  I/O imports. Hooks, components and SDK wrappers hold no decisions.
- **Inject the seam.** Never call `Date.now()` inside logic; take a `now()`.
  Take numbers, not a `WebGLRenderer`.
- **Derive invariants, never store them.** Two fields that must agree will one
  day disagree; one field and a function cannot.
- **Adaptive loops get a dead band and asymmetric windows.** Fast to degrade,
  slow to recover, settle after a change, give up eventually.
- **Closed sets, not spot checks.** Where the rule is "only these files may do
  X", enumerate and diff against an allowlist in `verify:*`. Prefer an
  exhaustive `Record<Union, T>` over a `Partial`, so a missing case is a compile
  error.
- **Comments explain why, never what.** Every non-obvious constant carries the
  argument that chose it, and why the obvious alternative was rejected.
- **Vendor SDKs are boxed.** Nothing outside `client/src/media/` imports
  `livekit-client`; the rest of the app consumes `HTMLVideoElement`. On the
  server, `livekit/token.ts` is the only vendor-coupled file.

### Verification

| Layer | What it proves |
| --- | --- |
| `npm run typecheck` | project-referenced `tsc -b` across all three workspaces |
| `npm test` (Vitest) | ~36.8k lines of source, 60 test files, ~770 cases, not one of which renders a component |
| `verify:phase0/2/3/4/5/6` | whole-system properties a unit test structurally cannot make: no card reaches the wrong client, this guard is in the one place it has to be, every shipped asset is credited in both directions. Phases 5 and 6 need nothing running |
| `poker-auditor` agent | rules correctness after any change under `server/src/poker/` |
| `netcode-security` agent | leak trace over every client-bound message after any protocol change |
| `scene-perf` agent | frame time and memory against the 60 FPS MacBook Air target |

### Assets

All 3D, textures, fonts and sound effects must be free for commercial use, CC0
preferred, and every accepted asset gets a row in `docs/ASSET-CREDITS.md` at the
time it is added. In practice the repo ships almost nothing downloaded: Kenney
CC0 casino audio and two OFL fonts. Everything else is drawn or synthesised.

---

## 9. Build status

Phases 0 through 6 plus 7a (Poker Moments) are complete and verified. Phase 7
(private beta: real hosting, real links, real poker nights on LiveKit Cloud) is
the remaining work, along with the two exit criteria that need people rather
than a script: a measured 60 FPS on the target laptop, and a one-hour
six-player session with no crash, no desync and no stuck hand.
