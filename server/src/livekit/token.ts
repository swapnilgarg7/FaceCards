import { AccessToken } from "livekit-server-sdk";
import type { MediaTokenPayload } from "@facecards/shared";
import { livekit } from "../config.js";

/**
 * The only vendor-coupled file on the server (`docs/TECH-DECISIONS.md`,
 * "Media provider: exit strategy and portability"). Everything else on this
 * side speaks `MediaTokenPayload`, which names no SFU.
 *
 * Note who calls this: the room, on join, using the client's *session id* as
 * the identity. There is no HTTP route where a caller states who they are.
 * An identity a client can choose is an identity a client can impersonate,
 * and that is a seat-stealing bug waiting for phase 3.
 */

/** Media-room name derived from the game room code. */
export function mediaRoomName(roomCode: string): string {
  return `facecards-${roomCode}`;
}

export interface MintOptions {
  roomCode: string;
  /** Server-assigned. Never taken from client input. */
  identity: string;
  /** Shown by the SFU to other participants. Sanitised by the caller. */
  displayName?: string;
  /** Seconds. Kept short-ish; the client can ask for a fresh one. */
  ttlSeconds?: number;
}

/**
 * Mint a join token scoped to exactly one room and one identity.
 *
 * Grants are deliberately narrow: join, publish and subscribe inside this one
 * room. No `roomCreate`, no `roomAdmin`, no `roomList`, so a leaked token is
 * worth one seat at one table and nothing else.
 *
 * `canPublishData` is on, and it is the one grant here that deserves an
 * argument rather than a line. It carries where each player's face sits inside
 * their own camera frame, twelve times a second, so that the avatar everyone
 * else is looking at frames a face instead of a wall. That is presentation,
 * not game state.
 *
 * The rule it appears to bend is `CLAUDE.md`'s "the server is authoritative",
 * and it does not: LiveKit datagrams travel client to client through the SFU
 * and never reach this server, so nothing on that channel can move a chip,
 * deal a card or claim a seat. The server is exactly as authoritative with
 * this on as with it off. What it costs is that "only media crosses the media
 * channel" stops being enforced by a boolean here and becomes an invariant the
 * client has to keep. It keeps it two ways: `DatagramTopic` in
 * `client/src/media/MediaProvider.ts` is a closed union, so adding a second
 * kind of datagram is a deliberate type change rather than a one-line
 * temptation, and the receiving end drops every topic it does not know.
 *
 * The thing to guard on review is not this flag. It is any future pull request
 * that widens that union.
 */
export async function mintMediaToken(
  opts: MintOptions,
): Promise<MediaTokenPayload> {
  if (!livekit.configured) {
    return {
      ok: false,
      reason: "not-configured",
      message:
        "Media server not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and " +
        "LIVEKIT_API_SECRET (see .env.example, or run `npm run livekit:up`).",
    };
  }

  const room = mediaRoomName(opts.roomCode);

  try {
    const at = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: opts.identity,
      name: opts.displayName,
      ttl: opts.ttlSeconds ?? 6 * 60 * 60,
    });

    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      // Face framing only. See the note above before widening what rides here.
      canPublishData: true,
    });

    return {
      ok: true,
      url: livekit.url,
      token: await at.toJwt(),
      identity: opts.identity,
      room,
    };
  } catch (err) {
    // Never surface the exception text: it can contain the API key.
    console.error("[livekit] token mint failed:", err);
    return {
      ok: false,
      reason: "mint-failed",
      message: "Could not mint a media token. See server logs.",
    };
  }
}
