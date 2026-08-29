import { schema } from "@colyseus/schema";

/**
 * Authoritative room state, and therefore protocol: both ends import this one
 * definition so the shape can never drift between them.
 *
 * Sharing the *shape* of a private field is not the same as sharing its value.
 * `{ view: true }` fields are delivered only to clients whose `StateView`
 * includes that instance (see `server/src/state/view.ts`), and the server is
 * the only side that ever assigns one.
 *
 * Phase 0 carries a `counter` and nothing more: it exists to prove state flows
 * server -> both tabs. It gets deleted the moment real poker state arrives in
 * phase 2.
 *
 * `@filter()` / `@filterChildren()` were removed in Colyseus 0.16. If you find
 * a tutorial using them, it predates this.
 */

export const Player = schema(
  {
    /** Server-assigned session id. Doubles as the media identity. */
    sessionId: "string",
    /** Sanitised server-side. Never rendered straight from client input. */
    displayName: "string",
    /** Ordered seat index. Fixed for the session (spec section 2). */
    seat: "uint8",
    /** True between a drop and the end of the reconnection window. */
    connected: "boolean",

    /**
     * Private to this player. Phase 0 placeholder holding the shape that
     * `holeCards` will take in phase 2. Never widen the StateView that
     * carries it.
     */
    privateNote: { type: "string", view: true },
  },
  "Player",
);

export const PokerState = schema(
  {
    /** Human-facing room code. Server-generated, never client-chosen. */
    code: "string",
    /** Seated players, keyed by session id. */
    players: { map: Player },
    /** Phase-0 plumbing proof. Removed in phase 2. */
    counter: "uint32",
    /** Display name of whoever last bumped, so both tabs can see who acted. */
    lastBumpBy: "string",
  },
  "PokerState",
);

export type PlayerInstance = InstanceType<typeof Player>;
export type PokerStateInstance = InstanceType<typeof PokerState>;
