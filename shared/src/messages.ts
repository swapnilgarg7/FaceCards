/**
 * Wire protocol. Every message crossing the socket is named here and typed
 * here, and both ends import these types. Change the type first, then both
 * ends.
 *
 * Rule that outlives phase 0: client messages are *intents*, never outcomes.
 * The client asks to bump the counter; it does not tell the server what the
 * counter now is.
 */

/** Messages the client sends to the server. */
export const ClientMessage = {
  /** Phase-0 plumbing proof: "please increment the shared counter." */
  Bump: "bump",
  /** Ask the server to re-issue a media token, e.g. after a token expiry. */
  RequestMediaToken: "request-media-token",
} as const;

export type ClientMessageType =
  (typeof ClientMessage)[keyof typeof ClientMessage];

/** Messages the server sends to a client. */
export const ServerMessage = {
  /**
   * Credentials for the realtime media provider, minted server-side for this
   * client's session identity. Sent once on join, and again on request.
   */
  MediaToken: "media-token",
} as const;

export type ServerMessageType =
  (typeof ServerMessage)[keyof typeof ServerMessage];

/** Options a client passes when joining a room. */
export interface JoinOptions {
  /** Room code, uppercase. Rooms are matched on this. */
  code: string;
  /** Requested display name. The server sanitises and may alter it. */
  displayName?: string;
}

/**
 * Media credentials. `identity` is assigned by the server from the session id;
 * a client cannot choose who it claims to be.
 *
 * Vendor-neutral on purpose: the client hands this to a `MediaProvider`
 * without knowing which SFU is behind it.
 */
export type MediaTokenPayload =
  | {
      ok: true;
      /** WebSocket URL of the media server. */
      url: string;
      /** Signed join token, scoped to this room and identity. */
      token: string;
      /** Server-assigned participant identity. */
      identity: string;
      /** Media-side room name (not necessarily the human-facing code). */
      room: string;
    }
  | {
      ok: false;
      /** Machine-readable reason, safe to show in dev UI. */
      reason: "not-configured" | "mint-failed";
      message: string;
    };

/** Body of `POST /api/rooms`. */
export interface CreateRoomResponse {
  code: string;
}

/** Any non-2xx response from the HTTP API. */
export interface ApiErrorResponse {
  error: string;
}
