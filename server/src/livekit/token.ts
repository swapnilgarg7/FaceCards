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
 * worth one seat at one table and nothing else. `canPublishData` stays off:
 * game data travels the authoritative Colyseus socket, never the media
 * channel, or the server stops being the only source of truth.
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
      canPublishData: false,
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
