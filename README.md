# FaceCards

Browser-based multiplayer Texas Hold'em where the product is the *feeling of
sitting at a table with friends*. Players sit in fixed seats around a stylized
3D casino table as low-poly avatars with their live webcam face on the avatar's
head, talking over live voice.

- Requirements: `virtual_poker_night_developer_spec.pdf`
- Build order: `plan.md`
- Pinned versions and the reasoning behind each: `docs/TECH-DECISIONS.md`
- Working agreements for day-to-day changes: `CLAUDE.md`

**Phases 0 (technical spike), 2 (poker prototype) and 3 (multiplayer) are
complete.** The server runs a full authoritative Hold'em game for two to six
players, holds a dropped player's seat while they reconnect, and keeps the hand
moving on a clock when nobody answers. The client renders it through a
deliberately plain HUD; cards and chips become physical objects in phase 4 and
get their art in phase 5, so ugly is still correct here.

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

`npm run verify:phase3` needs only `npm run dev`, and takes about a minute.
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
  src/ui/      lobby and table (phase 0 placeholder for the 3D scene)
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
- No rate limiting on room creation, room-code lookup or actions, and the room
  code is ~29 bits. It is the only thing guarding a room, and a room is a live
  webcam and voice call — see the security pass in phase 6.
- Nothing enforces `wss:`/`https:` in production builds. Over plaintext the
  per-client `StateView` buys nothing, so this gates any real deployment.

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
      folds only when staying in would cost chips
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
- An all-in seat whose player leaves for good still reaches the showdown in the
  engine but has no seat to publish it against, so its winnings leave with it.

Next: **phase 4, physical interaction** — cards you pick up and peek at, a deal
animation, chips as one `InstancedMesh`, and sound. See `plan.md`.
