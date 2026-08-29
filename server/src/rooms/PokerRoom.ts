import { Room, type Client } from "colyseus";
import {
  ClientMessage,
  MAX_PLAYERS,
  Player,
  PokerState,
  ROOM_EMPTY_GRACE_MS,
  ServerMessage,
  type JoinOptions,
  type PokerStateInstance,
} from "@facecards/shared";
import { grantOwnPlayerView } from "../state/view.js";

/** WebSocket close code Colyseus uses for a clean, intentional leave. */
const CONSENTED_LEAVE_CODE = 4000;
import { mintMediaToken } from "../livekit/token.js";
import { normaliseRoomCode } from "./roomCodes.js";
import { sanitiseDisplayName } from "./names.js";

/**
 * The authoritative room.
 *
 * Phase 0 scope: seats, a shared counter, and media credentials. No poker.
 * The rules that matter here are the ones that must never relax later:
 *
 *  - Clients send intents. `bump` carries no number; the server decides what
 *    the counter becomes.
 *  - Identity is server-assigned. The media token is minted against
 *    `client.sessionId`, so a client cannot ask to be someone else.
 *  - Private state is delivered through a `StateView` holding exactly one
 *    player instance, never through a message the client is trusted to ignore.
 */
// Colyseus 0.17 takes an options bag rather than a bare state type, so the
// room's client and metadata types can be named here too when they matter.
export class PokerRoom extends Room<{ state: PokerStateInstance }> {
  override maxClients = MAX_PLAYERS;

  /**
   * The room outlives its last occupant briefly. Without this, refreshing the
   * only open tab disposes the room mid-reload and the code stops resolving,
   * which is precisely the phase-0 "refreshing a tab rejoins cleanly" case.
   * Phase 3 replaces the grace window with real `allowReconnection()` seat
   * restoration; this is the cheap version that makes dev bearable.
   */
  override autoDispose = false;
  private disposeTimer: NodeJS.Timeout | undefined;

  /** Seat indices currently taken. Seats are fixed for a session. */
  private readonly takenSeats = new Set<number>();

  override onCreate(options: { code?: unknown }): void {
    const code = normaliseRoomCode(options?.code);
    if (!code) {
      // Only `createRoom` on the server side supplies this, and it always
      // supplies a generated code. Reaching here means a bug, not a bad user.
      throw new Error("PokerRoom created without a valid room code");
    }

    this.state = new PokerState();
    this.state.code = code;
    this.state.counter = 0;
    this.state.lastBumpBy = "";

    // Matchmaking joins by code, so the code must be queryable metadata.
    void this.setMetadata({ code });

    this.onMessage(ClientMessage.Bump, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // The intent carries no value. The server owns the number.
      this.state.counter += 1;
      this.state.lastBumpBy = player.displayName;
    });

    this.onMessage(ClientMessage.RequestMediaToken, (client) => {
      void this.sendMediaToken(client);
    });

    console.log(`[room ${code}] created (${this.roomId})`);
  }

  override async onJoin(client: Client, options: JoinOptions): Promise<void> {
    const seat = this.claimSeat();
    if (seat === null) throw new Error("Table is full");

    const player = new Player();
    player.sessionId = client.sessionId;
    player.seat = seat;
    player.displayName = sanitiseDisplayName(options?.displayName, seat);
    player.connected = true;
    player.privateNote = `seat ${seat} private channel ok`;

    this.state.players.set(client.sessionId, player);

    // This client's view contains its own player instance and nothing else.
    // Every `{ view: true }` field on any other player is absent from this
    // client's payload, not merely unrendered.
    grantOwnPlayerView(client, player);

    this.cancelPendingDispose();
    console.log(
      `[room ${this.state.code}] + ${player.displayName} (seat ${seat}, ${this.clients.length}/${MAX_PLAYERS})`,
    );

    await this.sendMediaToken(client);
  }

  /**
   * `code` is the WebSocket close code; 4000 is a consented leave. Phase 3
   * splits the unclean case out into `onDrop` and calls `allowReconnection`
   * there so a dropped player keeps their seat, stack and own hole cards.
   * Phase 0 only has to free the seat and not wedge the room.
   */
  override onLeave(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      this.takenSeats.delete(player.seat);
      this.state.players.delete(client.sessionId);
      const reason = code === CONSENTED_LEAVE_CODE ? "left" : `dropped (${code})`;
      console.log(`[room ${this.state.code}] - ${player.displayName} ${reason}`);
    }
    this.scheduleDisposeIfEmpty();
  }

  override onDispose(): void {
    this.cancelPendingDispose();
    console.log(`[room ${this.state.code}] disposed`);
  }

  /** Lowest free seat index. Fixed seating, so a seat is held until leave. */
  private claimSeat(): number | null {
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      if (!this.takenSeats.has(seat)) {
        this.takenSeats.add(seat);
        return seat;
      }
    }
    return null;
  }

  private async sendMediaToken(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    const payload = await mintMediaToken({
      roomCode: this.state.code,
      // Server-assigned identity. Not read from client input, ever.
      identity: client.sessionId,
      displayName: player?.displayName,
    });
    client.send(ServerMessage.MediaToken, payload);
  }

  private scheduleDisposeIfEmpty(): void {
    this.cancelPendingDispose();
    if (this.clients.length > 0) return;
    this.disposeTimer = setTimeout(() => {
      if (this.clients.length === 0) void this.disconnect();
    }, ROOM_EMPTY_GRACE_MS);
  }

  private cancelPendingDispose(): void {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = undefined;
    }
  }
}
