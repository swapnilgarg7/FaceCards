// Must stay first: it populates process.env before config.ts is evaluated.
import "./env.js";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import {
  ROOM_NAME,
  type ApiErrorResponse,
  type CreateRoomResponse,
} from "@facecards/shared";
import { config, isProduction } from "./config.js";
import { PokerRoom } from "./rooms/PokerRoom.js";
import { generateUniqueRoomCode, normaliseRoomCode } from "./rooms/roomCodes.js";
import { RateLimiter, clientKey } from "./rateLimit.js";

const app = express();

/**
 * Exactly one proxy hop, because Render puts exactly one in front of us.
 *
 * Without this `req.ip` is the proxy's address and every visitor on earth
 * shares a single rate-limit bucket, so the first abusive client locks out the
 * rest. With a larger number - or `true` - a client can prepend anything it
 * likes to `X-Forwarded-For` and mint a fresh identity per request, which is a
 * limiter that does nothing while looking like it works. See `rateLimit.ts`.
 */
app.set("trust proxy", 1);

app.use(express.json({ limit: "16kb" }));
app.use(
  cors({
    origin: config.corsOrigins,
    credentials: false,
  }),
);

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

/**
 * Rooms are matched on the `code` option, which is what makes "join by code"
 * work at all: `client.join(ROOM_NAME, { code })` only ever lands in a room
 * created with that same code.
 */
gameServer.define(ROOM_NAME, PokerRoom).filterBy(["code"]);

/**
 * Take `create` and `joinOrCreate` off the matchmaking API.
 *
 * Colyseus exposes `joinOrCreate`, `create`, `join`, `joinById` and `reconnect`
 * over `POST /matchmake/:method/:room` by default, with no auth and with CORS
 * headers it sets itself. `create` reaches `PokerRoom.onCreate` with whatever
 * options the caller sends, so anyone could `POST /matchmake/create/poker`
 * with `{"code":"ABCDEF"}` and stand up a room on a code they chose - which is
 * precisely the squatting attack the `/api/rooms` two-step exists to prevent.
 * The two-step was decorative until this line: nothing obliged a client to use
 * it.
 *
 * What survives is what the product needs. `join` matches an existing room by
 * code and never creates one, `joinById` and `reconnect` are what phase 3's
 * `allowReconnection()` needs, and the only way a room comes into existence is
 * `matchMaker.createRoom` below, called by this server with a code it drew
 * itself.
 */
matchMaker.controller.exposedMethods = ["join", "joinById", "reconnect"];

/**
 * Creating a room is the expensive one: it allocates a Colyseus room that sits
 * in memory for `ROOM_EMPTY_GRACE_MS` whether or not anybody joins. Six a
 * minute is more tables than a person opens by hand and far fewer than a
 * script opens by accident.
 */
const createLimiter = new RateLimiter({ limit: 6, windowMs: 60_000 });

/**
 * Looking a code up is cheap per call but walks every live room, so its cost
 * grows with exactly the thing a flood is inflating. Generous, because the
 * lobby probes on mount and an invite link shared in a group chat produces a
 * genuine burst of honest lookups from one office or one phone network.
 */
const lookupLimiter = new RateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * Ceiling on live rooms, and the reason the per-address limiter is not enough
 * on its own.
 *
 * A limiter keyed on address is defeated by having more addresses, and a
 * Reddit link is a cheap way to acquire some. This is the backstop that keeps
 * the 512 MB instance from being filled by rooms nobody is sitting at, and it
 * is deliberately checked against *live* rooms rather than a request rate:
 * tables that people are actually playing at are the thing worth protecting,
 * and empty ones drain themselves after `ROOM_EMPTY_GRACE_MS`.
 *
 * Sized for the free instance. 200 tables is 1,600 seats, which is well past
 * anything 0.1 CPU will serve happily; the point is that the failure is a
 * clear 503 to the 201st creator rather than an out-of-memory kill that ends
 * every hand in progress.
 */
const MAX_LIVE_ROOMS = 200;

/** Every live room, which is also the room count the ceiling above reads. */
async function liveRooms() {
  return matchMaker.query({ name: ROOM_NAME });
}

/** Is a room with this code currently live? */
async function roomExists(code: string): Promise<boolean> {
  const rooms = await liveRooms();
  return rooms.some((room) => room.metadata?.code === code);
}

/**
 * Apply a limiter, and answer the caller if it says no.
 *
 * Returns whether the handler should carry on, so a route reads as a guard
 * clause rather than as middleware assembled somewhere else.
 */
function limited(
  limiter: RateLimiter,
  req: express.Request,
  res: express.Response,
): boolean {
  const result = limiter.check(clientKey(req.ip));
  if (result.allowed) return false;
  res
    .status(429)
    .set("Retry-After", String(result.retryAfterSeconds))
    .json({
      error: "Too many requests. Wait a moment and try again.",
    } satisfies ApiErrorResponse);
  return true;
}

/**
 * Create a room.
 *
 * Deliberately the only way a room comes into existence: the server draws the
 * code and calls `createRoom` itself, so a client can never pick its own code.
 * If clients could, they could squat on a code and intercept the friends
 * arriving at that link, which is the whole security model of a private table.
 */
app.post("/api/rooms", async (req, res) => {
  if (limited(createLimiter, req, res)) return;
  try {
    if ((await liveRooms()).length >= MAX_LIVE_ROOMS) {
      console.warn(`[api] room ceiling reached (${MAX_LIVE_ROOMS})`);
      res.status(503).json({
        error: "Too many tables are open right now. Try again in a minute.",
      } satisfies ApiErrorResponse);
      return;
    }
    const code = await generateUniqueRoomCode(roomExists);
    await matchMaker.createRoom(ROOM_NAME, { code });
    console.log(`[api] created room ${code}`);
    res.status(201).json({ code } satisfies CreateRoomResponse);
  } catch (err) {
    console.error("[api] room creation failed:", err);
    res
      .status(500)
      .json({ error: "Could not create a room" } satisfies ApiErrorResponse);
  }
});

/** Does this code point at a live room? Lets the lobby fail fast and kindly. */
app.get("/api/rooms/:code", async (req, res) => {
  if (limited(lookupLimiter, req, res)) return;
  const code = normaliseRoomCode(req.params.code);
  if (!code) {
    res
      .status(400)
      .json({ error: "Malformed room code" } satisfies ApiErrorResponse);
    return;
  }
  if (!(await roomExists(code))) {
    res
      .status(404)
      .json({ error: "No room with that code" } satisfies ApiErrorResponse);
    return;
  }
  res.json({ code } satisfies CreateRoomResponse);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    // Whether media is wired up, never the key or secret that wires it.
    media: config.livekit.configured ? "configured" : "not-configured",
  });
});

await gameServer.listen(config.port);

console.log(
  [
    ``,
    `  FaceCards server`,
    `  http  http://localhost:${config.port}`,
    `  ws    ws://localhost:${config.port}`,
    `  media ${config.livekit.configured ? config.livekit.url : "NOT CONFIGURED (run `npm run livekit:up`, see .env.example)"}`,
    `  cors  ${config.corsOrigins.join(", ")}`,
    `  env   ${config.nodeEnv}`,
    ``,
  ].join("\n"),
);

if (isProduction && !config.livekit.configured) {
  console.warn("[startup] production build with no media server configured");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`\n[shutdown] ${signal}`);
    void gameServer.gracefullyShutdown();
  });
}
