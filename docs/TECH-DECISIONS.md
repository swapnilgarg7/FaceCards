# Technical Decisions

Researched 2026-08-29 against live docs and registries. Versions are what was current that day. Re-check before scaffolding if significant time has passed.

---

## Summary

| Decision | Pick |
| --- | --- |
| 3D | `three` 0.185.1 |
| R3F | `@react-three/fiber` 9.7.0 + `@react-three/drei` 10.7.8, on React 19 |
| Animation | `@react-spring/three` 10.1.2, or manual `MathUtils.damp` |
| Physics | none, deliberately |
| Camera | constrained look, **no pointer lock** |
| Voice/video | LiveKit Cloud free tier for dev/beta, self-hosted Docker for daily work |
| Video as texture | `track.attach()` then `THREE.VideoTexture`, `SRGBColorSpace` |
| Adaptive quality | `adaptiveStream: true` baseline, `setVideoQuality()` on focus |
| Networking | Colyseus 0.17.10, `@colyseus/schema` 4.0.30, client `@colyseus/sdk` 0.17.43 |
| TypeScript | 5.9.3, deliberately not 7.x |
| Private state | `StateView` (`@filter()` is removed) |
| Hand evaluation | `poker-evaluator` |
| Betting logic | hand-rolled, pure, exhaustively tested |
| Shuffle | `crypto.randomInt` + Fisher-Yates, server only |
| Client hosting | Cloudflare Pages |
| Server hosting | Render free tier, evaluate Cloudflare Durable Objects later |
| Room metadata | Supabase free tier |

---

## Front end

**React 19 + R3F 9.7.0 + drei 10.7.8 + three 0.185.1** is the stable production combination. R3F 8 pairs with React 18, R3F 9 pairs with React 19. R3F 10 exists in alpha alongside drei 11 alpha, adding React 19.2 `Activity` support. Do not adopt the alpha for real work.

### TypeScript 5.9.3, not 7.x

`typescript@latest` is **7.0.2** (the native Go port) and 6.0 is in beta. We are
on 5.9.3 anyway, and that is a decision rather than staleness — do not "fix" it
by bumping.

TS 7 is a full compiler rewrite that landed recently. `tsc` here is only a
typechecker (Vite transpiles via esbuild, `tsx` runs the server), so the upside
of the rewrite is faster `npm run typecheck` and nothing else. The downside is
being an early adopter of a new compiler across three workspaces, project
references, and `@types` packages built against the 5.x line, during the phase
whose entire job is a trustworthy foundation.

Revisit once the ecosystem has settled. The move is cheap when it happens:
change one devDependency and run `npm run typecheck`. If it is clean, take it.

### No physics engine

`@react-three/rapier` 2.2.0 exists and supports this stack, and we are still not using it.

Card deals, chip pushes and pot collection are **scripted, server-triggered events**, not emergent simulation. The server says "deal to seat 3" and every client must show the same thing. Rigid-body physics buys nondeterminism across clients, collider tuning, and a WASM bundle, in exchange for nothing the spec asks for. The spec asks for *satisfying motion*.

Use `@react-spring/three` (spring-*styled* animation, not a physics engine) or hand-rolled `Vector3.lerp` / `MathUtils.damp` in `useFrame`. Explicit start, end and duration means identical motion everywhere. `maath` is a good lightweight companion for easing curves.

Revisit only if a specific moment genuinely demands simulation.

### No pointer lock

Pointer Lock is the standard FPS answer and the wrong one here.

This is a **seated** view with a limited head-turn arc, not a walk-around FPS. Pointer lock hides the cursor, so bet-size buttons, fold/call/raise and chat all become a mode switch. The browser also shows a "press ESC to exit" overlay on lock, which looks wrong in a poker UI.

Use a non-locked, constrained look (bounded yaw and pitch via drag or edge-hover). The cursor stays visible, UI stays natively clickable, and R3F's default `onPointerOver` / `onClick` raycasting works with zero special-casing.

If a walk-around mode ever appears and reintroduces pointer lock, the fix for raycasting is a custom `computeOffsets` on the Canvas `raycaster` prop forcing the ray through screen center while locked:

```jsx
<Canvas raycaster={{
  computeOffsets: (_, { size: { width, height } }) =>
    isLocked.current ? { offsetX: width / 2, offsetY: height / 2 } : null
}} />
```

Reference: https://github.com/pmndrs/react-three-fiber/discussions/1158

---

## LiveKit

- `livekit-client` 2.22.0, https://www.npmjs.com/package/livekit-client
- `@livekit/components-react` 2.9.24
- `livekit-server-sdk` for token minting

### Free tier

5,000 WebRTC participant-minutes/month, 50GB downstream, 100 concurrent connections, no credit card. https://livekit.com/pricing

At 6 players for an hour that is roughly 14 full sessions per month. Fine for dev and a small private beta. Not fine for traffic. Ship tier is $50/month.

**Therefore: run `livekit-server` locally in Docker for daily development** so the free minutes are saved for real testing. `docker run --rm -it -v$PWD:/output livekit/generate` scaffolds a compose setup. It is a single stateless Go binary needing a YAML config and an open UDP range; Redis only enters once you run more than one instance.

### Webcam track to Three.js texture (the core trick)

```ts
const videoEl = track.attach();               // HTMLVideoElement, muted + playsInline preset
const texture = new THREE.VideoTexture(videoEl);
texture.colorSpace = THREE.SRGBColorSpace;    // or skin tones wash out
```

Gotchas, all of which will cost an afternoon if discovered late:

- **`attach()` is mandatory.** Reading the raw `MediaStream` directly bypasses LiveKit's visibility-based quality negotiation, which silently kills adaptive stream. The element may be off-screen or zero-opacity, but it must exist and be attached.
- **Autoplay**: the element needs `muted` and `playsInline`. `attach()` sets these; a hand-built element must set them explicitly.
- **`VideoTexture` self-updates** each frame by default. With a custom render loop, confirm the update path is still running (three.js r170+ moved some paths to an explicit `.update()`).
- **flipY / mirroring**: verify empirically on the face plane. Your own preview should mirror, other people's should not. UV orientation is the most common face-plane bug.
- **Dispose** the texture and detach the element on unsubscribe. Leaked video textures eat VRAM fast at six players cycling in and out.

Docs: https://docs.livekit.io/transport/media/subscribe/

### Adaptive quality (spec sections 6 and 12)

1. Publish with `simulcast: true` so the browser encodes multiple layers.
2. Set `adaptiveStream: true` on the room. LiveKit then watches the size and visibility of each attached `<video>` element and requests the matching layer automatically. Shrink an unfocused player's element and it downgrades itself.
3. For explicit control, call `RemoteTrackPublication.setVideoQuality(VideoQuality.HIGH | MEDIUM | LOW)` driven by camera yaw, so the player being looked at upgrades.

Use 2 as the baseline and layer 3 on top. Reference: https://kb.livekit.io/articles/3859313029-configuring-the-client-sdk-for-optimal-video-quality

### Token minting

`new AccessToken(apiKey, apiSecret, { identity })`, `.addGrant({ roomJoin: true, room })`, `await at.toJwt()`. Default TTL 6h, overridable. https://docs.livekit.io/home/server/generating-tokens/

### Alternatives considered

- **PeerJS / plain mesh WebRTC.** For 6 or fewer peers a mesh is genuinely viable and costs nothing: the commonly cited sweet spot is 6 to 8 peers. It is a legitimate zero-infra fallback **for the launch scope only**. It does not reach the spec's 10-player target, and per-peer upload scales O(n), which punishes weak connections. LiveKit is the better long-term bet for exactly that reason.
- **mediasoup**: an engine, not a product. Full control, much heavier lift.
- **Janus**: SFU plus SIP/RTSP gateway. Overkill.
- **Daily.co**: good managed alternative, roughly 2x the free tier, same raw-track access so the texture trick still works.

---

## Media provider: exit strategy and portability

### The free tier is not the binding constraint

`livekit-server` is **Apache 2.0 open source and self-hostable**. The 5,000-minute cap applies only to LiveKit *Cloud*, their managed SFU. Running out of free tier does not mean switching vendors, it means changing a URL to point at your own box. Same SDK, same client code, same `adaptiveStream`, unchanged everywhere else.

**So the first escalation is always: self-host LiveKit. Not: migrate to a competitor.** A small VPS handles a handful of 6-player tables comfortably, since an SFU forwards packets rather than transcoding them.

### What the free tiers actually buy, in this app's units

Assumption: face-crop video at roughly 300 kbps per stream, which is what we want anyway since it renders as a small oval on an avatar head. Six players, each receiving five remote streams, works out to about **4 GB of egress per table-hour**.

| Option | Free tier | 6-player hours/month | Notes |
| --- | --- | --- | --- |
| **LiveKit Cloud** | 5,000 participant-min, 50 GB, 100 concurrent | **~13** | Both limits land in the same place, which cross-checks the estimate |
| **Daily.co** | 10,000 participant-min/mo | **~28** | Then $0.004/participant-min |
| **Cloudflare Realtime SFU** | 1,000 GB egress/mo | **~250** | Billed purely on egress at $0.05/GB after. Raw SFU, see caveat below |
| **Jitsi JaaS** | 25 monthly active users | **effectively unlimited** | MAU-based, so a fixed friend group never hits it. $99/mo at 300 MAU |
| **Self-hosted LiveKit / Jitsi / mediasoup** | n/a | **unlimited** | Cost is the VPS. Apache 2.0 |
| **PeerJS mesh** | n/a | **unlimited** | No server at all. Caps out around 6 to 8 peers |

Cloudflare RealtimeKit (the higher-level SDK built on their SFU) is free during beta but has **no free tier at general availability**, so it is not a durable free answer.

### The one thing that does not port cleanly

`adaptiveStream`. LiveKit watches the size and visibility of each attached `<video>` element and automatically negotiates the right simulcast layer from the SFU. That is precisely the spec's "lower resolution for players who are not the visual focus" requirement, delivered by a single boolean.

A raw SFU (Cloudflare Realtime, mediasoup, Janus) gives you the transport and nothing else. You would rebuild layer selection, active-speaker detection, participant metadata and room bookkeeping by hand. **That is the real cost of leaving LiveKit, and it is much larger than the free-tier difference.** Daily and Jitsi keep more of this, but neither exposes it as cleanly.

### Keep the option open: the media adapter

Everything provider-specific lives behind `client/src/media/` and the rest of the app never imports the vendor SDK. The port surface is genuinely small:

```ts
export interface MediaProvider {
  connect(roomId: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  publishLocal(opts: { camera: boolean; mic: boolean }): Promise<void>;
  setMuted(kind: "audio" | "video", muted: boolean): void;

  // the only two the 3D scene cares about
  onRemoteVideo(cb: (peerId: string, el: HTMLVideoElement) => void): void;
  onRemoteGone(cb: (peerId: string) => void): void;

  // spec section 6/12: focus-driven quality
  setQuality(peerId: string, q: "high" | "medium" | "low"): void;
  onSpeaking(cb: (peerId: string, speaking: boolean) => void): void;
}
```

The scene consumes `HTMLVideoElement`, not a LiveKit type. Every WebRTC provider can hand one over, so `avatars/` never changes regardless of what happens underneath. Server-side, token minting is the only other vendor-coupled file (`server/src/livekit/`).

Build this boundary in phase 0. It costs an afternoon then, and it is expensive to retrofit once six modules import `livekit-client` directly.

### Recommendation

Ship on LiveKit Cloud. If cost bites, **self-host LiveKit first**: it keeps `adaptiveStream` and costs a VPS. Only evaluate Cloudflare Realtime SFU or Jitsi JaaS if self-hosting operationally fails, and price that migration as rebuilding adaptive streaming, not as swapping an SDK.

---

## Networking: Colyseus

`colyseus` 0.17.10 (server), `@colyseus/schema` 4.0.30, `@colyseus/sdk` 0.17.43 (client). MIT.

### The client package is `@colyseus/sdk`, not `colyseus.js`

Corrected during the phase 0 spike, after `colyseus.js` was pinned here on the
strength of it being the package every tutorial names.

`colyseus.js` was renamed to `@colyseus/sdk` at 0.17. `colyseus.js` still
resolves and still installs, but its last release is 0.16.22 (October 2025),
which depends on `@colyseus/schema` ^3.0.0 while a 0.17 server encodes with
schema 4. The two do not interoperate, and the failure is not a subtle decode
bug you would catch in review:

```
TypeError: Cannot read properties of undefined (reading 'name')
    at Client.consumeSeatReservation (colyseus.js/build/esm/Client.mjs:106)
```

It fails at seat reservation, before state encoding is even reached. Verified
empirically against a live 0.17.10 server before anything was built on it.

**Client and server versions must track each other.** `@colyseus/sdk` 0.17.x
pairs with server 0.17.x (peer dependency `@colyseus/core: 0.17.x`, schema ^4);
0.18.x pairs with server 0.18.x and schema ^5. Upgrading one half alone breaks
the wire. The 0.18 line was current at scaffold time and deliberately not
taken: 0.18.5 shipped the previous day, and phase 0 is the wrong place to be
the first to find its bugs.

### Why not hand-rolled `ws`

Hand-rolling means reimplementing exactly the two hardest parts of this server
yourself: **per-client filtered state** and **reconnection**. Colyseus does both
natively, and its filtered-state feature is essentially built for card games.

### Private hole cards: `StateView`, not `@filter()`

**`@filter()` and `@filterChildren()` are removed as of 0.16.** They are
replaced by `StateView`, introduced specifically for per-instance private
fields. https://docs.colyseus.io/state/view

With the functional `schema()` API, a private field is declared with
`view: true` inside the field definition. The exported `view()` helper is a
property *decorator* for the class-based API and does not work as a definition
wrapper; `secret: view("string")` type-checks and then silently never delivers
the field to anyone.

```ts
const Player = schema({
  displayName: "string",                      // public
  holeCards:   { type: "string", view: true } // only to clients whose view has this instance
}, "Player");

// server-side, in onJoin:
const view = new StateView();
view.add(player);
client.view = view;
```

Verified with two live clients before the poker engine was scheduled: the other
client's payload does **not contain the field at all**, rather than containing
it and trusting the client not to render it. That distinction is the whole
reason this feature was chosen, so it is asserted by `npm run verify:phase0`
rather than resting on a memory of having once seen it work.

Each `StateView` costs an extra encoding pass per client. Worth it, but keep
the set of private fields minimal.

### API changes in 0.17 that the docs and tutorials predate

- `Room` takes an options bag, not a bare state type:
  `class R extends Room<{ state: MyState, metadata: M, client: C }>`.
- `onLeave(client, code?: number)` receives a WebSocket close code, not the old
  `consented: boolean`. 4000 is a consented leave.
- `onDrop(client, code)` is the hook for *unclean* disconnects and is where
  `allowReconnection()` belongs (phase 3).
- `WebSocketTransport` needs `{ server: httpServer }`; passing `{ port }`
  throws inside `ws` rather than starting a listener.

### Reconnection

`client.allowReconnection()` inside `onDrop()` (unclean disconnect) or
`onLeave()`. Returns a `Deferred<Client>` you can `.reject()` on custom logic,
for example refusing reconnects after showdown. `onReconnect()` fires on
success; `onLeave()` finalizes if the window lapses.
https://docs.colyseus.io/room/reconnection

### Hosting

Self-host free (MIT) on any Node host. Colyseus Cloud is managed at $15/month
with no free tier. Self-host for MVP; buy the managed tier only if ops becomes
the bottleneck.

---

## Poker engine

### Hand evaluation: `poker-evaluator`

| Package | License | Status | Note |
| --- | --- | --- | --- |
| **`poker-evaluator`** | ISC | published 2025-08-18, maintained | Two-Plus-Two lookup tables, O(1). `poker-evaluator-ts` is a TS port; `@types/poker-evaluator` exists. **Pick this.** |
| `@xpressit/winning-poker-hand-rank` | MIT | published ~1 month ago | Native TypeScript, Hold'em/Omaha/short-deck. Reasonable alternative. |
| `pokersolver` | MIT | v2.1.4, 2022 | Most tutorial-cited, 4 years stale. |
| `phe` | MIT | v0.6.0 | Fast, no first-party TS types. |

O(1) evaluation matters more than it looks: a multi-way side pot forces repeated evaluation at showdown.

### Betting logic: hand-rolled

Candidates exist (`@chevtek/poker-engine`, `@pokertools/engine`, `@idealic/poker-engine`, `poker-holdem-engine`). None has broad verifiable production adoption. **Do not put an under-scrutinized dependency in charge of chip accounting.** The surface area (blinds, turn order, min-raise, all-ins, side pots) is small enough that hand-rolling with full test coverage is the safer path.

Do read `@chevtek/poker-engine`'s pot model as a design reference. Its pattern is the correct one: **each pot stores an amount plus the set of players eligible to win it.**

### Side pots: the known killer

Confirmed in the wild as the recurring failure point in Hold'em implementations. Write exhaustive tests for:

- Multiple players all-in at different stack sizes in a single hand.
- An all-in caller whose stack does not cover a subsequent raise. It must **not** reopen action for players who already acted at that level.
- Pot-eligibility bookkeeping when an all-in player in the main pot also has a claim on an earlier side pot.
- Heads-up all-in reducing a bet to the all-in amount.
- Odd chips on a split going to the first player left of the button.

**Invariant to assert every hand: sum of all pots equals sum of all contributions.**

### Shuffle

`crypto.randomInt(min, max)` (built into Node's `crypto` since 14.10) driving Fisher-Yates, server-side only. Never `Math.random()`, never `sort(() => Math.random() - 0.5)`, both non-uniform and predictable. No npm package: it is ten lines and belongs in auditable in-house code.

---

## Deployment

### Client: Cloudflare Pages

Unlimited bandwidth on the free tier, no card, commercial use allowed, 500 builds/month. Vercel Hobby caps at 100GB/month, pauses the project on overage, and forbids commercial use on the free tier. Cloudflare wins.

### Game server: Render (for now)

**Confirmed: Vercel serverless cannot host a persistent WebSocket server.** The model is strictly request/response and the WS handshake is rejected outright, regardless of config. The game server must live on separate always-on compute.

| Host | 2026 status |
| --- | --- |
| **Render** | Real free tier: 750 instance-hours/month, 512MB / 0.1 CPU. **Spins down after 15 min idle**, roughly 1 min cold start. Mitigate with a keep-alive ping during active sessions. The only genuinely free always-deployed Node host still standing. |
| Fly.io | **No free tier as of 2026.** 2 VM-hours over 7 days as a trial, card required. |
| Railway | Free tier removed in 2023. Hobby is ~$5/month in credits. |
| Cloudflare Durable Objects | 100k requests/day and 13k GB-s/day free. With the WebSocket Hibernation API, idle time is not billed and outgoing messages are free. Architecturally different from Colyseus, so it means adapting the transport. **Worth a spike if Render's spin-down becomes annoying.** |

### Room metadata: Supabase free tier

500MB DB, 5GB egress/month, 50k MAU, 200 concurrent realtime connections, max 2 active projects. **Free projects pause after one week of inactivity** and need a scheduled ping to stay warm. No backups or SLA on free. Comfortably sufficient for room and lobby metadata at MVP scale.

---

## Sources

https://livekit.com/pricing ·
https://docs.livekit.io/transport/media/subscribe/ ·
https://docs.livekit.io/home/server/generating-tokens/ ·
https://kb.livekit.io/articles/3859313029-configuring-the-client-sdk-for-optimal-video-quality ·
https://docs.colyseus.io/state/view ·
https://docs.colyseus.io/room/reconnection ·
https://colyseus.io/pricing/ ·
https://www.npmjs.com/package/poker-evaluator ·
https://www.npmjs.com/package/@xpressit/winning-poker-hand-rank ·
https://github.com/pmndrs/react-three-fiber/discussions/1158 ·
https://threejs.org/docs/pages/VideoTexture.html ·
https://developers.cloudflare.com/durable-objects/platform/pricing
