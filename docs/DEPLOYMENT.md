# Deployment: LiveKit Cloud + Render

Three moving parts, deployed separately:

| Piece | Where | What it owns |
| --- | --- | --- |
| Game server (`server/`) | Render web service | Deck, turn order, pot math, room codes, LiveKit token minting |
| Media SFU | LiveKit Cloud | Webcam and mic streams, face-framing datagrams |
| Client (`client/`) | Cloudflare Pages (per `plan.md`), or any static host | The 3D table |

Media never flows through Render. The browser talks to LiveKit directly; Render
only mints the token that lets it in.

---

## Part 1: LiveKit Cloud

1. Sign up at <https://cloud.livekit.io> and create a project. Name it
   `facecards`. Pick the region closest to your players (India: Asia South /
   Singapore).
2. The project's **Server URL** is shown on the project home page. It looks like
   `wss://facecards-xxxxxxx.livekit.cloud`. That is `LIVEKIT_URL`.
3. Go to **Settings -> Keys -> Create Key**. Copy the **API Key**
   (`API...`) and the **API Secret**. The secret is shown once. If you lose it,
   delete the key and make a new one.
4. Keep all three out of git. `.env` is already gitignored, and
   `docker/livekit/livekit.yaml` holds the local dev keys only.

Nothing else needs configuring on LiveKit. Rooms are created implicitly the
first time a token holder joins one, and `server/src/livekit/token.ts` scopes
every token to one room and one server-assigned identity.

Free tier note: the free plan is metered in participant-minutes, which a
six-player table burns quickly. Daily development should stay on
`npm run livekit:up` (local Docker SFU) and save the cloud project for real
playtests.

---

## Part 2: Render

`render.yaml` at the repo root is a Blueprint that defines the service, so you
do not hand-configure the build and start commands.

1. Push `main` to GitHub (`swapnilgarg7/FaceCards`).
2. In Render, **New -> Blueprint**, connect the repo, select `main`. Render
   reads `render.yaml` and proposes one service, `facecards-server`.
3. It will prompt for the four values marked `sync: false`. Fill in:

   | Variable | Value |
   | --- | --- |
   | `LIVEKIT_URL` | `wss://facecards-xxxxxxx.livekit.cloud` from Part 1 |
   | `LIVEKIT_API_KEY` | from Part 1 |
   | `LIVEKIT_API_SECRET` | from Part 1 |
   | `CORS_ORIGINS` | your client origin, e.g. `https://facecards.pages.dev`. Comma-separated for more than one. No trailing slash. |

   `CORS_ORIGINS` is a chicken-and-egg with Part 3: if the client is not
   deployed yet, put a placeholder in, deploy the client, then come back and
   correct it. A wrong value here is the single most likely reason a deployed
   client cannot create a room.

   Do **not** set `PORT`. Render injects it and `server/src/config.ts` reads it.

4. Deploy. First build is a few minutes (`npm ci` pulls the client's Three.js
   tree too). When it is live you get
   `https://facecards-server.onrender.com`.

### Why the build command has `--include=dev`

Render sets `NODE_ENV=production`, which makes a bare `npm ci` skip
devDependencies. The server has no compile step: `npm start -w
@facecards/server` runs `tsx src/index.ts`, and `tsx` is a devDependency. Drop
the flag and the deploy fails at start with `tsx: not found`.

This is also why the server is not compiled with `tsc` first:
`@facecards/shared` resolves through its `exports` map to TypeScript source, so
compiled output would still need a TypeScript-aware loader at runtime.

---

## Part 3: Point the client at Render

The client reads two build-time variables (`client/src/net/client.ts`). Set
them in your static host's build environment, not in a committed file:

```
VITE_SERVER_HTTP_URL=https://facecards-server.onrender.com
VITE_SERVER_WS_URL=wss://facecards-server.onrender.com
```

`wss:` and `https:`, not `ws:`/`http:`. Vite substitutes these at build time, so
changing them requires a rebuild, not a restart.

Cloudflare Pages settings for reference: build command
`npm ci && npm run build -w @facecards/client`, output directory `client/dist`,
Node version from `.node-version`.

Then set Render's `CORS_ORIGINS` to the client's real origin and redeploy the
server.

---

## Verify

```bash
curl https://facecards-server.onrender.com/api/health
# {"ok":true,"media":"configured"}
```

`"media":"not-configured"` means at least one of the three LiveKit variables is
missing or empty. `server/src/config.ts` treats a partially set trio as
unconfigured on purpose.

Then, from the deployed client: create a room, open the invite link in a second
browser, and confirm both faces appear. If the table loads but nobody can hear
anyone, the game server is fine and the LiveKit credentials are wrong.

---

## Caveats to expect

- **Free tier spins down after 15 minutes idle**, with a cold start around a
  minute. Rooms live in memory, so a spin-down ends every table. A keep-alive
  ping while a session is active is on the phase list in `plan.md`.
- **One instance only.** Colyseus matchmaking here is in-process
  (`matchMaker.query`). Scaling past one instance needs a Redis presence and
  driver, or rooms on different instances will not see each other.
- **Rotate the LiveKit key** if it ever reaches a client bundle or a log. The
  server never returns it: token mint failures deliberately log the exception
  server-side and return a generic message.
