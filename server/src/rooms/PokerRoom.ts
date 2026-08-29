import { Room, type Client } from "colyseus";
import {
  BIG_BLIND,
  ClientMessage,
  DISCONNECTED_TURN_TIMEOUT_MS,
  HAND_START_DELAY_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PAYOUT_DISPLAY_MS,
  PokerAction,
  Player,
  PokerState,
  RECONNECT_GRACE_MS,
  ROOM_EMPTY_GRACE_MS,
  SMALL_BLIND,
  STARTING_STACK,
  SeatStatus,
  ServerMessage,
  TURN_TIMEOUT_MS,
  TablePhase,
  type JoinOptions,
  type PlayerInstance,
  type PokerActionIntent,
  type PokerStateInstance,
} from "@facecards/shared";
import {
  applyAction,
  forfeit,
  legalActions,
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
import { pickAvatar } from "./avatars.js";
import { normaliseRoomCode } from "./roomCodes.js";
import { sanitiseDisplayName } from "./names.js";

/**
 * The authoritative room.
 *
 * It owns four things and delegates everything else:
 *
 *  - **Seats and identity.** Server-assigned, both of them. A client cannot
 *    pick a seat, a name it has not been given, an avatar this build does not
 *    ship, or a media identity.
 *  - **The hand lifecycle.** When to deal, when to pay out, when to deal
 *    again. The clock lives here because the engine has none.
 *  - **The action clock.** How long a seat may hold the table, and what
 *    happens when it does not answer. A disconnect during a betting round is a
 *    state-machine case, not an exception handler, so it is modelled here as
 *    "the same seat on a much shorter clock" rather than as a failure.
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
   * The room outlives its last occupant briefly, so refreshing the only open
   * tab returns to the same code instead of 404ing.
   *
   * This is *not* the reconnection window. A dropped player keeps their seat
   * through `onDrop`/`allowReconnection` below, which holds the whole table
   * open for them, not just the code.
   */
  override autoDispose = false;
  private disposeTimer: NodeJS.Timeout | undefined;
  private dealTimer: NodeJS.Timeout | undefined;
  private turnTimer: NodeJS.Timeout | undefined;

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
   *
   * The action clock keys off the same token: a timeout that fires after the
   * seat already acted is answering a question nobody is still asking.
   */
  private turnToken = 0;
  /**
   * When the decision currently on the clock was put there.
   *
   * The clock is a *deadline* derived from this, not a countdown restarted by
   * whatever last happened. Re-arming a fresh budget on every connection
   * change - which is what this used to do - meant any player at the table
   * could hand the acting seat another thirty seconds by dropping and
   * reconnecting on a loop, without ever being in the hand. The whole point of
   * the clock is that it cannot be stopped by someone who is not there.
   */
  private turnStartedAt = 0;
  /**
   * sessionId -> when they dropped, for players inside their reconnection
   * window. Combined with `turnStartedAt`, this is what lets the deadline be
   * computed from state rather than accumulated from events.
   */
  private readonly disconnectedSince = new Map<string, number>();
  private buttonSeat = NO_SEAT;

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
    this.state.actingMs = 0;
    this.state.buttonSeat = NO_SEAT;
    this.state.lastResult = "";

    // Matchmaking joins by code, so the code must be queryable metadata.
    void this.setMetadata({ code });

    this.onMessage<PokerActionIntent>(ClientMessage.Action, (client, intent) => {
      this.handleAction(client, intent);
    });

    this.onMessage(ClientMessage.SitOut, (client) => {
      const player = this.state.players.get(client.sessionId);
      // Unchanged is a no-op. `sittingOut` is a public field, so writing it
      // unconditionally would turn one inbound byte into a patch fanned out to
      // every client at the table, as fast as a client cared to send it.
      if (!player || player.sittingOut) return;
      player.sittingOut = true;
      // Sitting out never yanks a player out of the hand they are already in;
      // it takes effect at the next deal. Leaving mid-hand is a fold, and
      // that is a different, explicit thing.
    });

    this.onMessage(ClientMessage.SitIn, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.sittingOut) return;
      player.sittingOut = false;
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
    player.avatar = pickAvatar(options?.avatar, this.avatarsInUse(), seat);
    player.connected = true;
    player.sittingOut = false;
    player.stack = STARTING_STACK;
    player.bet = 0;
    player.status = SeatStatus.Waiting;
    player.cardCount = 0;
    player.holeCard0 = "";
    player.holeCard1 = "";

    this.state.players.set(client.sessionId, player);

    // This client's view contains its own player instance and nothing else.
    // Every `{ view: true }` field on any other player is absent from this
    // client's payload, not merely unrendered. This and `onReconnect` are the
    // only places a view is granted, and `holeCard0`/`holeCard1` ride on it.
    grantOwnPlayerView(client, player);

    this.cancelPendingDispose();
    console.log(
      `[room ${this.state.code}] + ${player.displayName} as ${player.avatar}` +
        ` (seat ${seat}, ${this.clients.length}/${MAX_PLAYERS})`,
    );

    await this.sendMediaToken(client);
    // A player who arrives mid-hand waits for the next deal. Dealing them in
    // now would mean a hand where the blinds were posted by a different set of
    // players than the one contesting the pot.
    this.considerDealing();
  }

  /**
   * A connection died without saying goodbye: a closed laptop, a dropped
   * network, a crashed tab.
   *
   * The seat is *held*, not freed. Their chips stay in the pot, their stack
   * stays on the table, and their two cards stay in a view only they can
   * decode, for `RECONNECT_GRACE_MS`. What they lose is the benefit of the
   * doubt on the clock: the budget drops to a few seconds for a chair nobody
   * is sitting in, because a player who is not there cannot be thinking.
   *
   * If they come back, `onReconnect` runs. If they do not, Colyseus calls
   * `onLeave` for real, which is the single place a player is removed.
   */
  override async onDrop(client: Client, code?: number): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.connected = false;
    // Remembered rather than acted on: `turnDeadline` reads it, so the clock
    // shortens without any event being allowed to restart it.
    this.disconnectedSince.set(client.sessionId, Date.now());
    console.log(
      `[room ${this.state.code}] ~ ${player.displayName} dropped (${code}),` +
        ` holding seat ${player.seat} for ${RECONNECT_GRACE_MS / 1000}s`,
    );
    // Re-arm on the short clock if they were the one holding it up. Nothing
    // else about the hand changes: an empty chair is still in the pot.
    this.armTurnClock();

    try {
      await this.allowReconnection(client, RECONNECT_GRACE_MS / 1000);
    } catch {
      // The window closed. `onLeave` runs next and does the removing.
    }
  }

  /** They came back inside the window. Seat, stack and own cards intact. */
  override onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    // Thrown, not returned. A client with no `Player` would otherwise stay
    // joined, holding the previous client's `StateView` and occupying a seat
    // slot with nothing behind it. Colyseus turns this into a clean
    // `FAILED_TO_RECONNECT` leave.
    if (!player) throw new Error("no seat to reconnect to");

    player.connected = true;
    this.disconnectedSince.delete(client.sessionId);
    // Re-granted rather than relied upon. Colyseus does carry the previous
    // client's view across a reconnection, but who may see a card is a
    // decision this codebase makes in exactly one function, and a reconnecting
    // client is a joining client as far as that decision is concerned.
    grantOwnPlayerView(client, player);

    console.log(
      `[room ${this.state.code}] ~ ${player.displayName} reconnected to seat ${player.seat}`,
    );

    this.cancelPendingDispose();
    // Back on the full clock, and back in the next deal.
    this.armTurnClock();
    this.considerDealing();
  }

  /**
   * The player is really gone: they left on purpose, or the reconnection
   * window closed behind them.
   *
   * The single removal path. Both entrances lead here, so there is one place
   * that frees a seat and one place that folds an abandoned hand.
   */
  override onLeave(client: Client, code?: number): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      // Their chips are already in the pot and stay there. What they cannot do
      // is hold up the table, so the seat folds and play moves on.
      if (this.hand) forfeit(this.hand, player.seat);

      this.takenSeats.delete(player.seat);
      this.state.players.delete(client.sessionId);
      this.disconnectedSince.delete(client.sessionId);

      console.log(
        `[room ${this.state.code}] - ${player.displayName} left (${code})`,
      );
    }

    if (this.hand) {
      this.bumpTurn();
      this.syncHand();
    }
    this.scheduleDisposeIfEmpty();
  }

  override onDispose(): void {
    this.cancelPendingDispose();
    if (this.dealTimer) clearTimeout(this.dealTimer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
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

    const outcome = this.commit(hand, player.seat, action);
    if (!outcome.ok) this.reject(client, outcome.reason);
  }

  /**
   * Put an action through the engine and publish the result.
   *
   * The only place `applyAction` is called, because a timed-out decision is
   * the same event as a clicked one as far as the rules are concerned: the
   * server decided what the seat does, and everything downstream - the turn
   * token, the clock, the mirror, the payout - must not be able to tell them
   * apart.
   */
  private commit(
    hand: HandState,
    seat: number,
    action: Action,
  ): { ok: true } | { ok: false; reason: string } {
    // The engine asserts its own accounting and throws rather than paying out
    // a pot it cannot balance. That is the right call inside a pure module,
    // but an exception escaping here would take the room's message handler
    // with it and leave the table frozen mid-hand with no explanation.
    let outcome;
    try {
      outcome = applyAction(hand, seat, action);
    } catch (err) {
      console.error(
        `[room ${this.state.code}] hand ${hand.handNumber} threw on` +
          ` ${action.type} from seat ${seat}:`,
        err,
      );
      return { ok: false, reason: "the table hit an internal error on that action" };
    }

    if (!outcome.ok) return outcome;

    this.bumpTurn();
    this.syncHand();
    return { ok: true };
  }

  private reject(client: Client, reason: string): void {
    client.send(ServerMessage.ActionRejected, { reason });
  }

  // ------------------------------------------------------- the action clock

  /** A new decision is on the clock. The one place the countdown restarts. */
  private bumpTurn(): void {
    this.turnToken += 1;
    this.turnStartedAt = Date.now();
  }

  /**
   * When this seat runs out of time, as an absolute moment.
   *
   * A deadline computed from state, never a budget accumulated from events,
   * and that distinction is the whole security property. It is a pure function
   * of three things - when the decision started, whether the acting player is
   * connected, and when they dropped - so **no sequence of connects and
   * disconnects, by anyone at the table, can push it past
   * `turnStartedAt + TURN_TIMEOUT_MS`.** Restarting a full budget on each
   * connection change instead let any player, in the hand or not, buy the
   * acting seat another thirty seconds by cycling their socket.
   *
   * Two budgets, one rule underneath: time is for thinking, and a chair with
   * nobody in it is not thinking. A dropped player keeps the seat, the stack
   * and the cards for the whole reconnection window; what they stop keeping is
   * the table's patience. Coming back inside their original thirty seconds
   * gives them the rest of it, and nothing more.
   */
  private turnDeadline(seat: number): number {
    const full = this.turnStartedAt + TURN_TIMEOUT_MS;

    let player: PlayerInstance | undefined;
    this.state.players.forEach((p) => {
      if (p.seat === seat) player = p;
    });
    // A seat the engine still holds but the room no longer does: the player
    // left and their `HandSeat` outlived them. Nobody is coming.
    if (!player) {
      return Math.min(full, this.turnStartedAt + DISCONNECTED_TURN_TIMEOUT_MS);
    }
    if (player.connected) return full;

    // Measured from the later of the drop and the start of the decision, so a
    // player who was already away when their turn came round still gets the
    // short budget rather than a deadline that has already passed.
    const since = this.disconnectedSince.get(player.sessionId) ?? this.turnStartedAt;
    return Math.min(
      full,
      Math.max(since, this.turnStartedAt) + DISCONNECTED_TURN_TIMEOUT_MS,
    );
  }

  /**
   * (Re)arm the clock for whoever is on it, and publish how long is left.
   *
   * Called after every action and every connection change. The deadline is
   * recomputed rather than restarted, so a connection change can only ever
   * shorten it back towards the ceiling the decision started with.
   */
  private armTurnClock(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = undefined;
    }

    const hand = this.hand;
    const seat = hand?.actingSeat;
    if (!hand || seat === null || seat === undefined) {
      this.state.actingMs = 0;
      return;
    }

    const remaining = Math.max(0, this.turnDeadline(seat) - Date.now());
    this.state.actingMs = remaining;

    // The token is the decision this timeout answers. If anything moves the
    // hand on before it fires - an action, a leaver, a re-arm - the timeout
    // that arrives is answering a question nobody is still asking.
    const token = this.turnToken;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = undefined;
      this.actOnTimeout(token, seat);
    }, remaining);
  }

  /**
   * Nobody answered. The server answers for them.
   *
   * Never a fold when checking is free: at a real table an absent player is
   * checked down, not folded out of a pot they still have every right to. A
   * fold only happens when staying in would cost chips the player never agreed
   * to put in.
   */
  private actOnTimeout(token: number, seat: number): void {
    const hand = this.hand;
    if (!hand || this.turnToken !== token || hand.actingSeat !== seat) return;

    // Null only if the seat is not on the clock, which the guard above has
    // already ruled out; folding is the safe reading if that ever changes.
    const action: Action = legalActions(hand, seat)?.canCheck
      ? { type: "check" }
      : { type: "fold" };

    const player = [...this.state.players.values()].find((p) => p.seat === seat);
    console.log(
      `[room ${this.state.code}] hand ${hand.handNumber}: seat ${seat}` +
        ` (${player?.displayName ?? "empty"}) timed out, ${action.type}`,
    );

    const outcome = this.commit(hand, seat, action);
    if (outcome.ok) return;

    // The clock is not allowed to be the thing that wedges a table, and
    // logging on the way out is not a recovery: nothing re-arms the timer, so
    // a refused timeout used to leave the hand frozen on a seat nobody was
    // going to answer for. `forfeit` is the abandonment path the room already
    // uses for a leaver - it folds the seat and, if the seat was holding the
    // clock, moves it on - and it is safe to call at any moment.
    console.error(
      `[room ${this.state.code}] timeout action refused: ${outcome.reason}`,
    );
    forfeit(hand, seat);
    this.bumpTurn();
    this.syncHand();

    if (this.hand?.actingSeat === seat) {
      // Unreachable: the engine only ever puts an active seat on the clock,
      // and forfeiting an active seat always settles. If it happens anyway,
      // stop rather than re-arm, because re-arming here is an infinite loop
      // that logs an error every few seconds forever.
      console.error(
        `[room ${this.state.code}] seat ${seat} would not release the clock; leaving it disarmed`,
      );
      if (this.turnTimer) {
        clearTimeout(this.turnTimer);
        this.turnTimer = undefined;
      }
      this.state.actingMs = 0;
    }
  }

  // ------------------------------------------------------- hand lifecycle

  /** Seat index to player, for the mirror. */
  private playersBySeat(): Map<number, PlayerInstance> {
    const bySeat = new Map<number, PlayerInstance>();
    this.state.players.forEach((player) => bySeat.set(player.seat, player));
    return bySeat;
  }

  /** Archetypes already at the table, so an undecided joiner gets a fresh one. */
  private avatarsInUse(): string[] {
    const taken: string[] = [];
    this.state.players.forEach((player) => taken.push(player.avatar));
    return taken;
  }

  /** Push the current hand out to every client, and close it out if decided. */
  private syncHand(): void {
    const hand = this.hand;
    if (!hand) return;

    const bySeat = this.playersBySeat();
    mirrorHand(this.state, hand, bySeat);
    this.state.turn = this.turnToken;
    this.armTurnClock();

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
      if (player.sittingOut) return;
      // A seat held open through a reconnection window is not dealt in. They
      // keep the chair and the chips; what they miss is the hands they were
      // not there for, which is also what stops the clock spending five
      // seconds a street on a laptop that is closed.
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
      this.armTurnClock();
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
    this.bumpTurn();

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
      `[room ${this.state.code}] hand ${this.handNumber} dealt to` +
        ` ${eligible.length} (button seat ${this.buttonSeat})`,
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
   *
   * A seat held open for a dropped player needs no check of its own: their
   * `Player` is still in `state.players` and their index is still in
   * `takenSeats` until `onLeave` runs.
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

  /**
   * Dispose once nobody is here and nobody is coming back.
   *
   * `clients.length` alone is not "empty" any more: a table whose last player
   * dropped has no clients but still has a seat being held open for them.
   * Disposing then would throw away the stack and the hand they are about to
   * reconnect into.
   */
  private scheduleDisposeIfEmpty(): void {
    this.cancelPendingDispose();
    if (this.clients.length > 0 || this.state.players.size > 0) return;
    this.disposeTimer = setTimeout(() => {
      if (this.clients.length === 0 && this.state.players.size === 0) {
        void this.disconnect();
      }
    }, ROOM_EMPTY_GRACE_MS);
  }

  private cancelPendingDispose(): void {
    if (this.disposeTimer) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = undefined;
    }
  }
}
