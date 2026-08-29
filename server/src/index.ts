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

const app = express();

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

/** Is a room with this code currently live? */
async function roomExists(code: string): Promise<boolean> {
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  return rooms.some((room) => room.metadata?.code === code);
}

/**
 * Create a room.
 *
 * Deliberately the only way a room comes into existence: the server draws the
 * code and calls `createRoom` itself, so a client can never pick its own code.
 * If clients could, they could squat on a code and intercept the friends
 * arriving at that link, which is the whole security model of a private table.
 */
app.post("/api/rooms", async (_req, res) => {
  try {
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
