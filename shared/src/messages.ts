/**
 * Wire protocol. Every message crossing the socket is named here and typed
 * here, and both ends import these types. Change the type first, then both
 * ends.
 *
 * Rule that outlives every phase: client messages are *intents*, never
 * outcomes. A client asks to raise to an amount; it does not tell the server
 * what the pot now is, who won, or what its stack became. The server owns the
 * deck, the turn order, the legality of every bet, the pot maths and the
 * winner, and it re-derives all of them from its own state.
 */

/** Messages the client sends to the server. */
export const ClientMessage = {
  /** "I want to fold / check / call / raise." Payload: `PokerActionIntent`. */
  Action: "action",
  /**
   * "I am ready - deal me in."
   *
   * The gate on the first hand. A table does not start dealing because two
   * browsers happened to connect: it starts when the people in it say they
   * are ready, which at a poker night is somebody saying "right, let's play"
   * rather than a countdown nobody asked for. Idempotent, and never sent
   * back to false - "deal me out again" is what `SitOut` is for.
   */
  Ready: "ready",
  /** "Deal me out of the next hand." */
  SitOut: "sit-out",
  /** "Deal me back in." */
  SitIn: "sit-in",
  /** "Put this many chips behind my seat." Payload: `BuyInIntent`. */
  BuyIn: "buy-in",
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
  /**
   * "That action was not legal, and here is why." Sent only to the client that
   * tried it. Carries no state: the authoritative state is already on its way
   * through the normal patch, so this is a message for a human, not a
   * correction the client applies.
   */
  ActionRejected: "action-rejected",
} as const;

export type ServerMessageType =
  (typeof ServerMessage)[keyof typeof ServerMessage];

/** The four things a player can do on their turn. */
export const PokerAction = {
  Fold: "fold",
  Check: "check",
  Call: "call",
  Raise: "raise",
} as const;

export type PokerActionType = (typeof PokerAction)[keyof typeof PokerAction];

/**
 * A player's intent for their turn.
 *
 * `amount` is the *total* this seat will have committed for the round, not the
 * increment, which is what a poker UI shows and what removes the "raise by or
 * raise to" ambiguity. It is a request: the server checks it against the
 * min-raise, the stack and the turn order, and rejects anything else. Nothing
 * about a call or a check is carried, because the server already knows what
 * those cost.
 */
export interface PokerActionIntent {
  type: PokerActionType;
  amount?: number;
  /**
   * The `PokerState.turn` the player was looking at when they chose this.
   *
   * Copied back verbatim, never invented. It is what makes an intent an answer
   * to a specific question rather than a standing instruction: the server
   * refuses it if the table has moved on since, so a double-click or a resend
   * that arrives a street late cannot act for you a second time.
   */
  turn: number;
}

/**
 * A request to put more chips behind a seat.
 *
 * An intent like every other. The client names an amount; the server checks it
 * against the buy-in band, the stack ceiling and whether the seat is currently
 * in a hand, and it is the server that decides both the number and *when* it
 * lands. A seat in a live hand plays it out with the chips it was dealt with,
 * so a mid-hand buy-in is held and applied before the next deal.
 */
export interface BuyInIntent {
  /** Chips to add. Whole chips, inside the server's buy-in band. */
  amount: number;
}

/** Body of `ServerMessage.ActionRejected`. */
export interface ActionRejectedPayload {
  reason: string;
}

/** Options a client passes when joining a room. */
export interface JoinOptions {
  /** Room code, uppercase. Rooms are matched on this. */
  code: string;
  /** Requested display name. The server sanitises and may alter it. */
  displayName?: string;
  /**
   * Requested avatar archetype id, from `AVATARS`. A request, like everything
   * else a client sends: the server validates it against the list it ships and
   * substitutes one of its own if it does not recognise it.
   */
  avatar?: string;
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
