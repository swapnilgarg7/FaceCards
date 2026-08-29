# FaceCards (Virtual Poker Night)

Browser-based multiplayer Texas Hold'em where the product is the *feeling of sitting at a table with friends*, not the poker. Players sit in fixed seats around a stylized 3D casino table as low-poly avatars with their **live webcam face** rendered onto the avatar's head, talking over live voice.

Source of truth for requirements: `virtual_poker_night_developer_spec.pdf`. Phase-by-phase build order: `plan.md`.

## Product principle
Every decision serves one outcome: *"it feels like we're actually sitting at the table together."* When a tradeoff is unclear, pick the option that strengthens presence (faces, voice, eye-line, physicality of cards and chips) over the one that adds poker features.

## Hard rules

**All 3D models, textures, HDRIs, fonts and sound effects must be absolutely free for commercial use.** CC0 preferred; CC-BY acceptable only with the attribution recorded in `docs/ASSET-CREDITS.md`. No paid assets, no CC-BY-NC, no asset-store EULAs that forbid shipping the mesh to a browser client. Every accepted asset gets a row in `docs/ASSET-CREDITS.md` with its source URL and exact license, at the time it is added. Use the `asset-scout` agent to source and verify.

**The server is authoritative.** Clients send intents, never outcomes. The server owns the deck, shuffle, turn order, bet legality, pot math and winners. Never trust a client-supplied amount, seat, balance, card or result.

**Hole cards are private server state.** No other client may ever receive them, in any message, including debug and error payloads. Anything that could leak a card is a critical bug. Use `netcode-security` before merging protocol changes.

**No real money.** Virtual chips only. No deposits, withdrawals, or wagering. No recording or persistence of webcam, microphone or voice data.

## Stack
- Client: React + TypeScript + Vite, Three.js via React Three Fiber (+ drei)
- Voice/video: LiveKit (WebRTC); remote tracks become `THREE.VideoTexture` on avatar face planes
- Networking: authoritative Node + TypeScript game server over WebSocket
- Persistence: Supabase/Postgres for room metadata only
- Target: desktop Chrome/Safari/Edge on Mac + Windows. No native app. 60 FPS on a MacBook Air.

## Conventions
- Poker rules live only in `server/src/poker/` and must be pure and unit-testable with no network or I/O imports. The client never re-implements a rule.
- Shared message types live in `shared/` and are imported by both sides. Change the type first, then both ends.
- 3D scene code mutates refs inside `useFrame`; it does not set React state per frame.
- Chips render as a single `InstancedMesh`. Cards are textured planes from one atlas, not individual meshes with individual textures.
- Every GLB is Draco/Meshopt compressed and its tri-count checked before it enters `public/models/`.

## Verify before saying done
- `npm run typecheck` and `npm test` pass.
- Poker engine changes: run `poker-auditor`, and assert sum of all pots equals sum of all contributions.
- Protocol changes: run `netcode-security`.
- Scene changes: run `scene-perf`, and confirm frame time on a 6-avatar room.
