# FaceCards

Browser-based multiplayer Texas Hold'em where the product is the *feeling of
sitting at a table with friends*. Players sit in fixed seats around a stylized
3D casino table as low-poly avatars with their live webcam face on the avatar's
head, talking over live voice.

- Requirements: `virtual_poker_night_developer_spec.pdf`
- Build order: `plan.md`
- Pinned versions and the reasoning behind each: `docs/TECH-DECISIONS.md`
- Working agreements for day-to-day changes: `CLAUDE.md`

**Phases 0 (technical spike), 2 (poker prototype), 3 (multiplayer) and 4
(physical interaction) are complete.** The server runs a full authoritative
Hold'em game for two to six players, holds a dropped player's seat while they
reconnect, and keeps the hand moving on a clock when nobody answers. The game
is now on the table rather than in a HUD: cards fly out of the dealer's hands
and lie on the felt, you hold your own two up to look at them, every chip in
the room is drawn from server state, and the table has its own sound. The art
arrives in phase 5, so plain is still correct here — but web-form is not.

Phase 1's scene, seated camera and webcam-face pipeline are built, but its exit
criteria are the ones only a person can sign off — eye-line, and five minutes
of mouse-look that has to feel like turning your head — so it is not ticked
below.

---

## Quick start

```bash
npm install
npm run livekit:up     # local SFU in Docker; needs Docker running
npm run dev            # game server on :2567, client on :5173
```

Open http://localhost:5173, click **Create room**, then open the invite link in
a second tab. You should see both faces, hear both mics, and — two seconds
after the second tab sits down — a hand deals itself. Each tab sees its own two
cards and nobody else's.

`.env` is created from `.env.example` on first setup. The committed LiveKit dev
credentials match `docker/livekit/livekit.yaml` and are not secret; production
values come from LiveKit Cloud or your own host and live only in the server's
environment.

Deploying to LiveKit Cloud and Render: `docs/DEPLOYMENT.md`.

## Commands

| | |
| --- | --- |
| `npm run dev` | Game server and client together |
| `npm run typecheck` | `tsc -b` across all three workspaces |
| `npm test` | Unit tests (vitest) |
| `npm run verify:phase0` | Plumbing check against a running stack |
| `npm run verify:phase2` | Plays a full hand against a running stack |
| `npm run verify:phase3` | Six clients, a drop, a reconnect, and a sit-out |
| `npm run verify:phase4` | Sound assets, then a hand replayed through the drawing layer |
| `npm run verify:phase5` | Geometry, fixtures, idles and font assets. Needs nothing running |
| `npm run verify:phase6` | Permission recovery, the GPU ladder, socket budgets, TLS and the leak audit. Needs nothing running |
| `npm run build` | Production client bundle |
| `npm run livekit:up` / `:down` / `:logs` | Local SFU |

`npm run verify:phase0` needs `npm run dev` and `npm run livekit:up` already
running. It drives two headless clients through every phase-0 exit criterion,
including asserting that one client's private state is absent from the other's
payload and that the real SFU accepts the minted token and rejects a tampered
one. **Run it after any version bump** — it is what caught the Colyseus client
and server being wire-incompatible before anything was built on top.

`npm run verify:phase2` needs only `npm run dev`. Two headless clients play a
complete hand — blinds, a raise, all four streets, showdown, payout, and the
next hand dealing itself — and it snapshots every state frame either client
ever received to assert that no opponent hole card, no deck stub and no burn
card appeared in any of them before the showdown published them deliberately.

`npm run verify:phase4` runs its sound-asset section with nothing running, and
needs `npm run dev` for the rest. It plays a hand and pushes every state patch
either client received back through the *drawing* layer the scene uses: every
stack, bet and pot has to draw chips worth exactly what the server said, every
rung of the chip-push ladder has to be legal by that same patch's own flags,
and no client may ever be able to resolve an opponent's card to a face. It is
what caught the odd chip a split pot leaves behind, which no hand-written
fixture had.

`npm run verify:phase5` is the one that needs **nothing running at all**, which
is deliberate: it is the check most likely to be wanted in a hurry, in the
middle of moving something two centimetres. It replays every card and chip
anchor the scene draws to, at every seat count, against the rail's inner radius
so the decoration can never creep in over the game; asserts that no fixture in
the room glows inside the band of height a face occupies; sweeps two hours of
every archetype's idle against its amplitude ceilings; and checks the shipped
fonts against `docs/ASSET-CREDITS.md` and `styles.css` in both directions.

`npm run verify:phase6` also needs **nothing running**. It is the reliability
check, and almost everything it asserts is about a machine that is not this
one — a denied camera, an unplugged webcam, a GPU that cannot keep up, a second
tab, a plaintext deploy — so it checks the *properties* that make those cases
handled rather than trying to reproduce them. It replays all eleven errors
`getUserMedia` can throw and asserts that a Retry button appears if and only if
retrying could work; it simulates a throttled GPU by feeding the quality ladder
slow frames and asserts it settles rather than oscillating; it floods the
message limiter; it re-runs the private-state audit as a closed set over the
wire side rather than as a spot check. See `docs/BROWSERS.md` for the parts
that need a person.

`npm run verify:phase3` needs only `npm run dev`, and takes about a minute.
It also carries the regression guard for the clock: a player who is *not* on
the clock drops and reconnects, and the acting seat's remaining time must have
gone down rather than up.
Six headless clients fill a table; one of them has its socket closed without a
leave message in the middle of a hand, and the script asserts that the table
moved on inside the short clock, that the seat, the stack and *only that
client's own* cards came back on reconnect, and that no client ever received
another player's card across six sets of hole cards. It also covers avatar
validation, sitting out and sitting back in.

## Troubleshooting

**`npm run livekit:up` fails with "unable to get image" or "Docker Desktop is
unable to start".** Docker, not the compose file. Docker Desktop on Windows can
die with a containerd panic (`service containerd failed: panic detected ...
fatal error: index out of range`), after which every `docker` command reports
the daemon as unreachable. Quit Docker Desktop and reopen it; if it panics
again, "Reset to factory defaults" from its own error dialog clears it. Then
re-run `npm run livekit:up`.

**`verify:phase0` prints `skip  live SFU checks`.** Nothing is answering on
`ws://localhost:7880`. Token *minting* is local JWT signing and keeps working
with the SFU down, so the tokens in that run were never validated against a
real server. The remaining checks are still meaningful; start LiveKit and
re-run to cover the last two.

**Camera tile shows "camera off" for a second after joining.** Expected. The
element exists before the first frame arrives.

**Two tabs on one machine share one webcam.** Chrome allows it, and it is how
the two-tab test is meant to be run.

## Layout

```
client/   React + TypeScript + Vite
  src/media/   media provider boundary — the ONLY place livekit-client is imported
  src/net/     Colyseus client and state mirror
  src/scene/   the 3D room: table, seats, cards, chips, camera. Pure maths in
               .ts files, renderer in .tsx, so the geometry is unit-testable
  src/avatars/ bodies, archetypes and the webcam face-plane socket
  src/audio/   table sound: the cue derivation, the WebAudio engine, the bed
  src/ui/      lobby, HUD, keybindings and the flat action controls
  public/audio/ Kenney CC0 foley (see docs/ASSET-CREDITS.md)
server/   Node + TypeScript, authoritative
  src/rooms/   Colyseus rooms, room codes, seats
  src/state/   StateView wiring (who may see what)
  src/livekit/ token minting — the only vendor-coupled file on this side
  src/poker/   (phase 2) pure Hold'em engine, no I/O imports
shared/   protocol: message types, state schema, constants. Imported by both ends
docker/   local LiveKit SFU
scripts/  verification harnesses
```

## The rules that outlive phase 0

**The server is authoritative.** Clients send intents, never outcomes. There is
no HTTP route where a caller states who they are: rooms are created by the
server (which draws the code), and media identity is the Colyseus session id.

**Private state is genuinely absent, not merely unrendered.** Fields marked
`view: true` in `shared/src/state.ts` are delivered only to clients whose
`StateView` includes that instance, wired in one place
(`server/src/state/view.ts`). `holeCard0` and `holeCard1` go through that
function and no other; the only other way a card becomes public is a `Reveal`
the server writes at a real showdown. Asserted by both verify scripts.

**Nothing outside `client/src/media/` imports a vendor SDK.** The rest of the
app consumes `HTMLVideoElement`. Phase 1 turns those same elements into
`THREE.VideoTexture` on avatar faces without touching the boundary. Rationale
in `docs/TECH-DECISIONS.md`.

**Assets are free for commercial use or they don't ship.** CC0 preferred, CC-BY
only with the row recorded in `docs/ASSET-CREDITS.md` at the time it is added.

**Fake chips only.** No real money, and no recording or persistence of webcam,
microphone or voice data.

## Phase 0 status

Verified end to end, in two real browser tabs and by `npm run verify:phase0`:

- [x] Monorepo with one `npm run dev` starting both halves
- [x] Server-minted short room code; join by code; a client cannot pick its own
- [x] Server state syncing to both tabs, driven by payload-free intents (the
      phase-0 counter that first proved this was replaced by real poker state
      in phase 2; the same assertions now run against the hand)
- [x] LiveKit token minted server-side against the session id, accepted by a
      real SFU and rejected when tampered with
- [x] Two tabs with mutual video and audio; own preview mirrors, remote does not
- [x] Autoplay handled (`muted` + `playsInline`, plus a click-to-enable-sound path)
- [x] Refreshing a tab rejoins cleanly by code without wedging the server
- [x] Media provider behind a vendor-neutral interface
- [x] Local LiveKit in Docker so the cloud free tier is saved for real playtests

Not covered here, by design: eye-line, face crop and "does it feel like sitting
together" are phase 1, and need a person rather than a test.

## Phase 2 status

Verified by 207 unit tests, `npm run typecheck`, and `npm run verify:phase2`
against a live server:

- [x] `server/src/poker/` is a pure state machine — no I/O imports, no network,
      no clock. The entropy source is injected from outside it
- [x] Crypto-seeded Fisher-Yates shuffle, hand-rolled and ten lines
- [x] Hand evaluation hand-rolled (the `poker-evaluator` reversal is recorded in
      `docs/TECH-DECISIONS.md`)
- [x] Blinds, all four streets, betting, showdown, pot award, button rotation
- [x] Side pots, with *sum of all pots equals sum of all contributions* asserted
      on every hand, including a thousand randomised ones
- [x] Heads-up blind and button inversion, preflop and postflop
- [x] Min-raise rules, and an under-raise all-in that does **not** reopen betting
- [x] Split pots and odd-chip assignment clockwise from the button
- [x] Hole cards delivered per-client through `StateView`; opponents see a card
      count and nothing else
- [x] Two players play a full hand and the next one deals itself, no lobby
      round-trip
- [x] Client HUD renders server state and sends intents; it contains no poker
      rule, not even the min-raise
- [x] Keyboard-first table controls, because the mouse turns your head: reaching
      for a button swings the view on the way there. `F` fold, `C` check/call,
      `R` raise, `⇧R` all in, `←`/`→` to size it, `Esc` settings, `M` mute, `V`
      camera. Defined once in `client/src/ui/keybinds.ts`, which every chip and
      the settings list read from. **W, A, S and D are reserved** for camera
      movement later, and a test fails if anything claims them

Known boundaries left to later phases, on purpose:

- A player who busts is out of chips. No rebuy, so a heads-up table stalls once
  someone loses everything.
- **Stacks do not survive a leave.** Rejoining is a fresh 1000, which makes
  leave-and-rejoin a free rebuy. Fixing it properly means keying stacks to a
  stable identity, which is the same change phase 3 needs for reconnection.
- No action timer: an idle player holds the hand open. Phase 3.
- No rate limiting on room creation, room-code lookup, actions, sit-out flips
  or media-token requests, and the room code is ~29 bits. `GET /api/rooms/:code`
  is also an unthrottled existence oracle that queries every live room, and with
  `autoDispose = false` unlimited room creation is a memory DoS. The code is the
  only thing guarding a room, and a room is a live webcam and voice call — see
  the security pass in phase 6.
- Nothing enforces `wss:`/`https:` in production builds; `client/src/net/client.ts`
  falls back to plaintext localhost when the env vars are unset, with no
  production assert. Over plaintext the per-client `StateView` buys nothing, so
  this gates any real deployment.

(The mid-hand-disconnect boundary listed here through phase 2 is closed by
phase 3's reconnection window, below.)

## Phase 3 status

Verified by unit tests, `npm run typecheck`, and `npm run verify:phase3`
(46 checks against a live server), plus `netcode-security` and `scene-perf`.

- [x] Six clients fill a table, every seat index distinct, a seventh refused.
      Seat *placement* is derived from who is actually present
      (`client/src/scene/layout.ts`), so two players sit opposite rather than
      taking the first two slots of a table built for six, and raising
      `MAX_PLAYERS` to ten needs no scene change
- [x] Lobby flow: invite link, display name, avatar picker, camera and mic
      permission, seated. Permission is primed in the lobby rather than met on
      arrival in a 3D room, and a refusal seats you anyway
- [x] Six archetypes — cowboy, businessman, gentleman, wizard, alien, shark —
      defined once in `shared/src/avatars.ts`, validated server-side, and drawn
      through one lookup that keeps the face-plane socket archetype-agnostic.
      **Procedural, not modelled**: phase 3 owns the plumbing an id travels
      through, phase 5 swaps the primitives for the Quaternius bodies, and no
      asset means no row in `docs/ASSET-CREDITS.md` yet
- [x] Multi-way play: turn order around the ring, button and blinds moving,
      sit-out and sit-in that take effect at the next deal and never mid-hand
- [x] **A dropped player keeps their seat, their stack and their own cards** for
      `RECONNECT_GRACE_MS`. `onDrop` holds it, `onReconnect` gives it back, and
      `onLeave` is the single place a player is ever removed
- [x] **A closed laptop does not stall the table.** The action clock is
      server-side: thirty seconds for a player who is there, five for a chair
      nobody is in, and on timeout the server checks when checking is free and
      folds only when staying in would cost chips. It is a *deadline* computed
      from when the decision started, not a countdown restarted by events, so
      no sequence of drops and reconnects — by the acting player or by anyone
      else at the table — can push it past the budget the decision began with
- [x] Video scaling: `adaptiveStream` and simulcast as the baseline, plus
      explicit per-peer quality driven by camera yaw. At six players sitting
      still, one face is on the top layer and two are on the bottom
      (`client/src/scene/attention.test.ts` asserts that profile)
- [x] No opponent hole card in any state frame any of six clients ever
      received, including across the reconnection

Known boundaries left to later phases, on purpose:

- **Leaving on purpose still gives up the stack.** Rejoining is a fresh 1000,
  so leave-and-rejoin remains a free rebuy. Reconnection keys stacks to a
  session that survives a *drop*; surviving a deliberate leave needs an
  identity that outlives the session, which is a phase 7 account question.
- The client SDK does not retry a drop that happens inside the first five
  seconds of a session (its own `minUptime`), so a laptop closed immediately
  after sitting down is a real leave.
- No rebuy, so a table still stalls once someone busts.
- **A reconnection token is a bearer credential for a seat.** Whoever holds one
  can forcibly close the live client and take over the seat *and its hole-card
  view*. The SDK keeps it in memory only; it must never be logged, persisted or
  put in a URL.
- An all-in seat whose player leaves for good still reaches the showdown in the
  engine but has no seat to publish it against, so its winnings leave with it.

## Phase 4 status

Verified by unit tests, `npm run typecheck`, and `npm run verify:phase4`
(15 checks), plus `scene-perf`.

- [x] **Cards are objects on the felt.** The board lies in a row through the
      middle and every seat has two cards in front of it. A card this client
      was not sent is built from the back slot of the atlas and carries no rank
      or suit at all — a face-down card has no value, not a hidden one
- [x] **Peeking.** Hold Space, or press and hold on your own two cards, and
      they draw back towards you and stand up. Entirely local and view-only:
      the server already sent this client its own cards, so there is no
      round-trip and nothing for anyone else to see
- [x] **A deal is a deal.** Cards fly out of the deck in front of the button,
      once round the table and then round again, on a tweened arc with a stated
      start, end and duration so every client watches the same flight. Joining
      or reconnecting mid-hand does not replay a deal that already happened
- [x] **Every chip in the room in one `InstancedMesh`.** Stacks in front of
      each seat, bets pushed forward, and the collected pot as a ring of piles
      around the board — a ring because it is the one shape in the middle that
      is the same from every seat
- [x] **Bets collect and pots slide, without an animation for either.** Chips
      keep their identity across a change of state (`chipPool.ts`), so when a
      round closes the same chips are simply wanted in the middle and they
      glide there. The pot going to the winner is the same mechanism
- [x] **Pushing chips in.** On your turn, drag from your own stack towards the
      pot: the pile in front of your seat grows under your hand, detents click
      past as the amount changes, and letting go commits. **It cannot aim at an
      illegal action** — every rung comes from the legality flags the server
      published, so there is nothing else to land on
- [x] Fold / Check / Call / Raise remain as buttons with their keyboard
      shortcuts (spec section 8), and so does your own hand in the HUD. The
      physical path is flavour on top, never the only way to act
- [x] **Sound**: shuffle, deal, flip, fold, chip push, chip collect and pot
      push, from Kenney's CC0 casino pack, plus a synthesised room murmur
      underneath. All derived from the difference between one snapshot and the
      next, so a cue cannot fire twice for one event or be missed because two
      patches were coalesced. Volume and mute are in the Escape menu and are
      separate from everyone's voices

Known boundaries left to later phases, on purpose:

- **It is not pretty yet.** Cards are drawn on a canvas atlas, chips are
  cylinders with a flat colour, and the table is still primitives. Phase 5
  bakes the RevK card atlas, dresses the table, and swaps the avatars for the
  Quaternius bodies. The card atlas's *grid* is the contract that has to
  survive that swap, and it is the part `cardAtlas.test.ts` pins down.
- **Sound files are Ogg Vorbis only.** Safari has supported it since 17.4, and
  a clip that will not decode costs that clip and nothing else, but the browser
  matrix is a phase-6 job and this is on its list.
- **The peek is not visible to anyone else.** Lifting your cards is a local
  affordance; nobody across the table sees you do it. Broadcasting the gesture
  would be presence, which is worth having, and it is a protocol change rather
  than a scene one.
- Chip piles cap at 24 chips, so a stack past a few thousand is drawn in 500s
  and eventually truncates. The number beside it is always exact.

Next: **phase 5, visual polish.**


## Phase 5 status

Verified by unit tests, `npm run typecheck`, `npm run build` and
`npm run verify:phase5` (23 checks), plus `scene-perf`.

Unlike the earlier verify scripts, `verify:phase5` needs **nothing running** —
every check is a pure function replayed against the real geometry, or a file on
disk. That is deliberate: it is the check most likely to be run in a hurry, in
the middle of moving something two centimetres.

- [x] **The table is a turned object.** A rail, an apron and a pedestal, each
      a lathed cross-section authored in `tableProfile.ts` as numbers; brass
      inlay between cloth and leather; a neon race tucked under the rail lip.
      3,528 triangles against a 15k budget
- [x] **The felt is one 1024px disc, not a tiled swatch** — which is what lets
      the betting line be drawn at a world radius the layout agrees with, so
      chips genuinely cross it when they are pushed forward
- [x] **There is a room.** A round shell: carpet, velvet above panelling with a
      brass cap, eight pilasters, a pendant over the table, and three races of
      light. Everything in it is a ring, for the same reason the seating is —
      anything that is not rotationally symmetric quietly gives one seat a
      better view than the others
- [x] **Six people sitting still are six different people.** Every archetype
      now has an idle (`idle.ts`) and an outfit (`Outfit.tsx`): the cowboy
      leans back in a yoke, the businessman cannot sit still, the gentleman is
      carved out of wood, the wizard is somewhere else in a cape, the alien
      scans the room, the shark barely moves
- [x] **Stack counts are on the table.** Each seat's chip count is engraved on
      the inner slope of the rail in front of it, which from every other seat
      is directly under that person's face — read in the same glance. The
      dealer button is a disc on the felt that slides to the next seat between
      hands
- [x] **Real cards.** The atlas now draws the standard English pip patterns,
      inverted below the midline as a real card is, with framed devices for the
      courts and one large pip for the ace
- [x] **Chips have a face and an edge.** One texture, one material, one draw
      call: the cylinder's own UVs are squeezed so the caps sample the face
      design and the rim samples the edge spots
- [x] **UI in casino styling.** Two OFL faces, self-hosted: Cinzel Decorative
      where something should read as engraved, Bebas Neue for every chip count
      in the product. Brass on oxblood glass over a warm ground, matching the
      room underneath rather than sitting on top of it as a separate
      application
- [x] **Faces and cards are still the two most legible things on screen**, and
      that is now a check rather than an intention: no fixture in the room
      glows inside the band of height a face occupies, and no background
      element varies by more than 6%

Two rules the phase turned into assertions, because both are the kind of thing
a later art pass breaks silently:

- **The decoration never reaches the game.** Every card and chip anchor, at
  every seat count, replayed against the rail's inner radius. The binding
  constraint turned out not to be the hole cards but the *deck*, which sits
  further out and is where every card of every hand begins. 22mm of margin
  at the worst case
- **An idle never takes a face with it.** Every archetype swept for two hours
  of session time against the amplitude ceilings in `idle.ts`. Worst glance
  6.9 degrees, which foreshortens a face plane by 0.7%

Known boundaries left to later phases, on purpose:

- **No quality tiers yet.** One set of textures and one light rig for every
  machine. Spec section 12 wants a quality setting with automatic fallback for
  weak GPUs, and that is a phase-6 job alongside the browser matrix
- **The room is deliberately small.** 3.6m radius, no doors, nothing to walk
  to. `plan.md` says the table is the hero asset and not to build an
  explorable casino, and the shell exists only so the table is standing
  somewhere rather than floating in fog
- **Chip edge spots are a brighter shade of the chip's own colour**, not the
  white of a real casino chip. The instance colour multiplies through a grey
  map; true white spots would need a per-instance UV attribute and a shader
  patch, which is a lot of fragility for a detail on a two-centimetre object
- **The court cards are devices, not figures.** A framed panel with a rank and
  a suit rather than an engraving with a face. What the card has to do is read
  as a king from two metres away at an angle, and a crude figure does that
  worse than a clear device

## Phase 6 status

Verified by unit tests, `npm run typecheck`, `npm run build` and
`npm run verify:phase6` (56 checks). Like `verify:phase5` it needs **nothing
running**, for a different reason: almost every failure this phase handles
happens on a machine that is not this one, so what is checkable is the property
rather than the incident.

- [x] **Five permission paths, all recoverable without a reload.** Refused up
      front, no device, unplugged mid-session, taken by another app, and
      revoked from the browser's own settings while seated. Each classifies to
      a fault carrying a *recovery verb* (`media/faults.ts`), and the banner
      offers a Retry if and only if retrying could work
- [x] **A denial gets a sentence, not a button.** Nothing a page does can turn
      a denied permission into a granted one, so a Retry there fails silently
      every time it is pressed. `retryable` is derived from the verb rather
      than stored, which makes that pairing impossible to get wrong
- [x] **Plugging a webcam back in retries by itself.** `devicechange` is
      diffed rather than acted on, so a pair of headphones changes nothing and
      a camera arriving while a retryable fault is up recovers with no click
- [x] **A quality setting plus an automatic fallback** (spec section 12).
      Three tiers, each one object; a probe for where to start; and a frame
      clock that moves off it within two seconds. Demotion is fast, promotion
      is six times slower, and a session demoted twice stops climbing — which
      is what makes a borderline machine settle instead of alternating
- [x] **The fallback never turns a face off.** What it spends is pixel ratio,
      shadows and the top simulcast rung. Even the floor still shows everybody
- [x] **Every client message has a budget**, per client and per type, checked
      *before* the handler rather than inside it. `buy-in` was the amplifier
      that equality checks could not fix; `action` reached the poker engine on
      every out-of-turn frame and answered each with a rejection
- [x] **Production TLS is asserted at both ends, not documented.** A server
      whose `CORS_ORIGINS` is not https refuses to start; a client bundle
      pointed at `ws://` throws at module load. Hole cards ride that socket
- [x] **The same table in two tabs is caught and named.** Not a server
      question — two tabs are two honest sessions — but two publications of one
      microphone, which is the loudest failure the product has
- [x] **The browser is probed, never version-checked.** `support.ts` asks the
      platform in the lobby and says one line; `docs/BROWSERS.md` is the matrix
      and the by-hand test plan
- [x] **Full protocol re-audit.** The server sends exactly two kinds of
      message, both addressed to one client, neither able to carry a card; no
      rejection reason can quote one; the datagram channel still carries one
      topic; nothing records or stores any A/V

Known boundaries, stated rather than papered over:

- **Safari cannot see a permission being revoked.** It implements no `camera`
  or `microphone` descriptor for the Permissions API, so there is nothing to
  subscribe to and no workaround. The other four denial paths work there, being
  driven by exceptions and by the platform `ended` event. See
  `docs/BROWSERS.md`
- **The 60 FPS and one-hour-six-player criteria still need people.** The ladder
  is proven to settle; what it settles *at* on a particular MacBook Air is a
  measurement, and a full evening without a stuck hand is six friends
- **No client keep-alive was added.** The phase asked for one; the repo already
  had a better answer in `.github/workflows/keep-server-awake.yml`, which pings
  every five minutes from outside. A second mechanism inside the session would
  hold awake only a server that was already awake
- **No Supabase ping either**, because nothing is wired to Supabase yet. Room
  metadata still lives in process memory

Next: **phase 7, private beta** — real hosting, real links, real poker nights,
and LiveKit Cloud so friends outside the dev machine's network can connect.
See `plan.md`.