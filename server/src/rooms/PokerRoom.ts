import { Room, type Client } from "colyseus";
import {
  BIG_BLIND,
  ClientMessage,
  HAND_START_DELAY_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PAYOUT_DISPLAY_MS,
  PokerAction,
  Player,
  PokerState,
  ROOM_EMPTY_GRACE_MS,
  SMALL_BLIND,
  STARTING_STACK,
  SeatStatus,
  ServerMessage,
  TablePhase,
  type JoinOptions,
  type PlayerInstance,
  type PokerActionIntent,
  type PokerStateInstance,
} from "@facecards/shared";
import {
  applyAction,
  forfeit,
  nextButton,
  startHand,
  type Action,
  type HandState,
} from "../poker/index.js";
import { secureRandomInt } from "../rng.js";
import {
  NO_SEAT,
  clearHand,
  clearResult,
  mirrorHand,
  mirrorHoleCards,
  mirrorResult,
} from "../state/mirror.js";
import { grantOwnPlayerView } from "../state/view.js";
import { mintMediaToken } from "../livekit/token.js";
import { normaliseRoomCode } from "./roomCodes.js";
import { sanitiseDisplayName } from "./names.js";

/** WebSocket close code Colyseus uses for a clean, intentional leave. */
const CONSENTED_LEAVE_CODE = 4000;

/**
 * The authoritative room.
 *
 * It owns three things and delegates everything else:
 *
 *  - **Seats and identity.** Server-assigned, both of them. A client cannot
 *    pick a seat, a name it has not been given, or a media identity.
 *  - **The hand lifecycle.** When to deal, when to pay out, when to deal
 *    again. The clock lives here because the engine has none.
 *  - **The boundary.** Client intents come in, get checked against the engine,
 *    and become engine calls. Engine state goes out through `state/mirror.ts`
 *    and nowhere else.
 *
 * Poker rules are not here. Every question of legality is answered by
 * `poker/`, which is pure and tested without a server. When this file wants to
 * know whether a raise is allowed it asks; it never decides.
 */
export class PokerRoom extends Room<{ state: PokerStateInstance }> {
  override maxClients = MAX_PLAYERS;

  /**
   * The room outlives its last occupant briefly. Without this, refreshing the
   * only open tab disposes the room mid-reload and the code stops resolving.
   * Phase 3 replaces the grace window with real `allowReconnection()` seat
   * restoration; this is the cheap version that makes dev bearable.
   */
  override autoDispose = false;
  private disposeTimer: NodeJS.Timeout | undefined;
  private dealTimer: NodeJS.Timeout | undefined;

  /** Seat indices currently taken. Seats are fixed for a session. */
  private readonly takenSeats = new Set<number>();

  /**
   * The hand in flight, or null between hands. This object holds the undealt
   * deck and every player's cards, and it is never serialised, never sent, and
   * never reachable from `this.state`.
   */
  private hand: HandState | null = null;
  private handNumber = 0;
  /**
   * Identifies the decision currently on the clock.
   *
   * Bumped every time an action is accepted, and published as `state.turn`. A
   * client echoes back the token it was looking at when it clicked, so an
   * intent that was in flight while the table moved on is refused instead of
   * being applied to a decision nobody was asked. Without it, double-clicking
   * Check checks the flop as well as the preflop.
   */
  private turnToken = 0;
  private buttonSeat = NO_SEAT;
  /** Session ids that asked to be dealt out. */
  private readonly sittingOut = new Set<string>();

  override onCreate(options: { code?: unknown }): void {
    const code = normaliseRoomCode(options?.code);
    if (!code) {
      // Only `createRoom` on the server side supplies this, and it always
      // supplies a generated code. Reaching here means a bug, not a bad user.
      throw new Error("PokerRoom created without a valid room code");
    }

    this.state = new PokerState();
    this.state.code = code;
    this.state.phase = TablePhase.Waiting;
    this.state.smallBlind = SMALL_BLIND;
    this.state.bigBlind = BIG_BLIND;
    this.state.actingSeat = NO_SEAT;
    this.state.buttonSeat = NO_SEAT;
    this.state.lastResult = "";

    // Matchmaking joins by code, so the code must be queryable metadata.
    void this.setMetadata({ code });

    this.onMessage<PokerActionIntent>(ClientMessage.Action, (client, intent) => {
      this.handleAction(client, intent);
    });

    this.onMessage(ClientMessage.SitOut, (client) => {
      if (!this.state.players.has(client.sessionId)) return;
      this.sittingOut.add(client.sessionId);
      // Sitting out never yanks a player out of the hand they are already in;
      // it takes effect at the next deal. Leaving mid-hand is a fold, and
      // that is a different, explicit thing.
    });

    this.onMessage(ClientMessage.SitIn, (client) => {
      if (!this.state.players.has(client.sessionId)) return;
      this.sittingOut.delete(client.sessionId);
      this.considerDealing();
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
    player.stack = STARTING_STACK;
    player.bet = 0;
    player.status = SeatStatus.Waiting;
    player.cardCount = 0;
    player.holeCard0 = "";
    player.holeCard1 = "";

    this.state.players.set(client.sessionId, player);

    // This client's view contains its own player instance and nothing else.
    // Every `{ view: true }` field on any other player is absent from this
    // client's payload, not merely unrendered. This is the only place a view
    // is granted, and `holeCard0`/`holeCard1` ride on it.
    grantOwnPlayerView(client, player);

    this.cancelPendingDispose();
    console.log(
      `[room ${this.state.code}] + ${player.displayName} (seat ${seat}, ${this.clients.length}/${MAX_PLAYERS})`,
    );

    await this.sendMediaToken(client);
    // A player who arrives mid-hand waits for the next deal. Dealing them in
    // now would mean a hand where the blinds were posted by a different set of
    // players than the one contesting the pot.
    this.considerDealing();
  }

  /**
   * `code` is the WebSocket close code; 4000 is a consented leave. Phase 3
   * splits the unclean case out into `onDrop` and calls `allowReconnection`
   * there so a dropped player keeps their seat, stack and own hole cards.
   */
  override onLeave(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // Their chips are already in the pot and stay there. What they cannot do
      // is hold up the table, so the seat folds and play moves on.
      if (this.hand) forfeit(this.hand, player.seat);

      this.takenSeats.delete(player.seat);
      this.state.players.delete(client.sessionId);
      this.sittingOut.delete(client.sessionId);

      const reason = code === CONSENTED_LEAVE_CODE ? "left" : `dropped (${code})`;
      console.log(`[room ${this.state.code}] - ${player.displayName} ${reason}`);
    }

    if (this.hand) {
      this.turnToken += 1;
      this.syncHand();
    }
    this.scheduleDisposeIfEmpty();
  }

  override onDispose(): void {
    this.cancelPendingDispose();
    if (this.dealTimer) clearTimeout(this.dealTimer);
    console.log(`[room ${this.state.code}] disposed`);
  }

  // ------------------------------------------------------------- actions

  private handleAction(client: Client, intent: PokerActionIntent): void {
    const player = this.state.players.get(client.sessionId);
    const hand = this.hand;
    if (!player || !hand) {
      this.reject(client, "no hand in progress");
      return;
    }

    // The seat comes from the session, never from the payload. A client that
    // sends a seat number is sending a field this server does not read.
    const seat = hand.seats.get(player.seat);
    if (!seat || seat.playerId !== client.sessionId) {
      this.reject(client, "you are not in this hand");
      return;
    }

    const type = intent?.type;
    if (
      type !== PokerAction.Fold &&
      type !== PokerAction.Check &&
      type !== PokerAction.Call &&
      type !== PokerAction.Raise
    ) {
      this.reject(client, "unknown action");
      return;
    }

    // Only a raise carries a number, and only after the engine has checked it
    // against the min-raise, the stack and the reopening rule.
    const action: Action =
      type === PokerAction.Raise
        ? { type, amount: Math.trunc(Number(intent.amount)) }
        : { type };

    // Only meaningful while it really is this player's turn; out of turn,
    // `applyAction` gives the more useful answer.
    if (hand.actingSeat === player.seat && intent?.turn !== this.turnToken) {
      this.reject(client, "that decision has already been made");
      return;
    }

    // The engine asserts its own accounting and throws rather than paying out
    // a pot it cannot balance. That is the right call inside a pure module,
    // but an exception escaping here would take the room's message handler
    // with it and leave the table frozen mid-hand with no explanation.
    let outcome;
    try {
      outcome = applyAction(hand, player.seat, action);
    } catch (err) {
      console.error(
        `[room ${this.state.code}] hand ${hand.handNumber} threw on ${action.type} from seat ${player.seat}:`,
        err,
      );
      this.reject(client, "the table hit an internal error on that action");
      return;
    }

    if (!outcome.ok) {
      this.reject(client, outcome.reason);
      return;
    }

    this.turnToken += 1;
    this.syncHand();
  }

  private reject(client: Client, reason: string): void {
    client.send(ServerMessage.ActionRejected, { reason });
  }

  // ------------------------------------------------------- hand lifecycle

  /** Seat index to player, for the mirror. */
  private playersBySeat(): Map<number, PlayerInstance> {
    const bySeat = new Map<number, PlayerInstance>();
    this.state.players.forEach((player) => bySeat.set(player.seat, player));
    return bySeat;
  }

  /** Push the current hand out to every client, and close it out if decided. */
  private syncHand(): void {
    const hand = this.hand;
    if (!hand) return;

    const bySeat = this.playersBySeat();
    mirrorHand(this.state, hand, bySeat);
    this.state.turn = this.turnToken;

    if (!hand.result) return;

    mirrorResult(this.state, hand, bySeat);
    this.hand = null;

    const summary = this.state.lastResult || "hand over";
    console.log(`[room ${this.state.code}] hand ${hand.handNumber}: ${summary}`);

    // The result stays up long enough to talk about, which is the point of the
    // product. Then the next hand deals itself with no lobby round-trip.
    this.scheduleDeal(PAYOUT_DISPLAY_MS);
  }

  /** Deal if a hand can start and one is not already running or scheduled. */
  private considerDealing(): void {
    if (this.hand || this.dealTimer) return;
    if (this.eligiblePlayers().length < MIN_PLAYERS) return;
    this.scheduleDeal(HAND_START_DELAY_MS);
  }

  private eligiblePlayers(): PlayerInstance[] {
    const out: PlayerInstance[] = [];
    this.state.players.forEach((player) => {
      if (player.stack <= 0) return;
      if (this.sittingOut.has(player.sessionId)) return;
      // Inert until phase 3: nothing sets `connected` false yet, because a
      // dropped player is currently removed outright rather than held through
      // a reconnection window. The check is here so that when `onDrop` starts
      // marking seats instead of deleting them, they stop being dealt in.
      if (!player.connected) return;
      out.push(player);
    });
    return out.sort((a, b) => a.seat - b.seat);
  }

  private scheduleDeal(delayMs: number): void {
    if (this.dealTimer) clearTimeout(this.dealTimer);
    this.dealTimer = setTimeout(() => {
      this.dealTimer = undefined;
      this.deal();
    }, delayMs);
  }

  private deal(): void {
    if (this.hand) return;

    const eligible = this.eligiblePlayers();
    const bySeat = this.playersBySeat();

    if (eligible.length < MIN_PLAYERS) {
      // Back to waiting. Everything from the last hand is cleared, including
      // the cards, so nothing survives into a hand it does not belong to.
      clearHand(this.state, bySeat);
      clearResult(this.state);
      return;
    }

    const seats = eligible.map((p) => p.seat);
    // First hand of the table starts the button on the lowest seat; after that
    // it walks. A button on a seat that has since emptied moves on rather than
    // wedging the deal.
    this.buttonSeat =
      this.buttonSeat === NO_SEAT ? seats[0]! : nextButton(seats, this.buttonSeat);
    this.handNumber += 1;

    clearHand(this.state, bySeat);
    clearResult(this.state);
    this.turnToken += 1;

    this.hand = startHand({
      players: eligible.map((p) => ({
        seat: p.seat,
        playerId: p.sessionId,
        stack: p.stack,
      })),
      button: this.buttonSeat,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      handNumber: this.handNumber,
      randomInt: secureRandomInt,
    });

    mirrorHoleCards(this.hand, bySeat);
    console.log(
      `[room ${this.state.code}] hand ${this.handNumber} dealt to ${eligible.length} (button seat ${this.buttonSeat})`,
    );

    // A hand can be over before anyone acts: two players all-in on the blinds
    // runs the board out inside `startHand`.
    this.syncHand();
  }

  // ---------------------------------------------------------- plumbing

  /**
   * Lowest free seat index. Fixed seating, so a seat is held until leave.
   *
   * A seat the running hand still holds is not free, even after its occupant
   * left. Their chips are in the pot and, if they were all-in, they are still
   * entitled to win it; handing the index to someone else would make the
   * engine's seat and the room's seat two different people. `mirror.ts` guards
   * against that on the write side, but not creating the collision is better
   * than detecting it, and at a real table you cannot sit down into a hand
   * that is still being played either.
   */
  private claimSeat(): number | null {
    for (let seat = 0; seat < MAX_PLAYERS; seat++) {
      if (this.takenSeats.has(seat)) continue;
      if (this.hand?.seats.has(seat)) continue;
      this.takenSeats.add(seat);
      return seat;
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
