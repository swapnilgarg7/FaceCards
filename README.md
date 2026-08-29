# FaceCards

Browser-based multiplayer Texas Hold'em where the product is the *feeling of
sitting at a table with friends*. Players sit in fixed seats around a stylized
3D casino table as low-poly avatars with their live webcam face on the avatar's
head, talking over live voice.

- Requirements: `virtual_poker_night_developer_spec.pdf`
- Build order: `plan.md`
- Pinned versions and the reasoning behind each: `docs/TECH-DECISIONS.md`
- Working agreements for day-to-day changes: `CLAUDE.md`

**Current phase: 0 (technical spike) — complete.** There is no 3D and no poker
yet, on purpose. Phase 0 proves the plumbing; ugly is correct here.

---

## Quick start

```bash
npm install
npm run livekit:up     # local SFU in Docker; needs Docker running
npm run dev            # game server on :2567, client on :5173
```

Open http://localhost:5173, click **Create room**, then open the invite link in
a second tab. You should see both faces, hear both mics, and watch one shared
counter update in both.

`.env` is created from `.env.example` on first setup. The committed LiveKit dev
credentials match `docker/livekit/livekit.yaml` and are not secret; production
values come from LiveKit Cloud or your own host and live only in the server's
environment.

## Commands

| | |
| --- | --- |
| `npm run dev` | Game server and client together |
| `npm run typecheck` | `tsc -b` across all three workspaces |
| `npm test` | Unit tests (vitest) |
| `npm run verify:phase0` | Integration check against a running stack |
| `npm run build` | Production client bundle |
| `npm run livekit:up` / `:down` / `:logs` | Local SFU |

`npm run verify:phase0` needs `npm run dev` and `npm run livekit:up` already
running. It drives two headless clients through every phase-0 exit criterion,
including asserting that one client's private state is absent from the other's
payload and that the real SFU accepts the minted token and rejects a tampered
one. **Run it after any version bump** — it is what caught the Colyseus client
and server being wire-incompatible before anything was built on top.

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
(`server/src/state/view.ts`). When phase 2 adds `holeCards`, it goes through
that function and no other. Asserted by `npm run verify:phase0`.

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
- [x] Shared counter syncing to both tabs, driven by a payload-free intent
- [x] LiveKit token minted server-side against the session id, accepted by a
      real SFU and rejected when tampered with
- [x] Two tabs with mutual video and audio; own preview mirrors, remote does not
- [x] Autoplay handled (`muted` + `playsInline`, plus a click-to-enable-sound path)
- [x] Refreshing a tab rejoins cleanly by code without wedging the server
- [x] Media provider behind a vendor-neutral interface
- [x] Local LiveKit in Docker so the cloud free tier is saved for real playtests

Not covered here, by design: eye-line, face crop and "does it feel like sitting
together" are phase 1, and need a person rather than a test.

Next: **phase 1, the social prototype** — the make-or-break phase. See
`plan.md`.
