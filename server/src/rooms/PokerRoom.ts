import { Room, type Client } from "colyseus";
import {
  AUTO_SIT_OUT_TIMEOUTS,
  BIG_BLIND,
  ClientMessage,
  DISCONNECTED_TURN_TIMEOUT_MS,
  HAND_START_DELAY_MS,
  MAX_PLAYERS,
  MAX_STACK,
  MIN_PLAYERS,
  NEXT_HAND_BEAT_MS,
  PAYOUT_DISPLAY_MS,
  PAYOUT_MAX_MS,
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
  type BuyInIntent,
  type ClientMessageType,
  type JoinOptions,
  type PlayerInstance,
  type PokerActionIntent,
  type PokerStateInstance,
} from "@facecards/shared";
import {
  applyAction,
  forfeit,
  legalActions,
  nextBlinds,
  startHand,
  type Action,
  type BlindPositions,
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
import { decideBuyIn } from "./buyIn.js";
import { MessageLimiter } from "./messageLimits.js";
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
  /**
   * How the last hand's button and blinds were arranged, or null before a
   * table's first deal.
   *
   * The blinds are anchored to where they were, not to who is sitting where
   * now, which is the only way "the big blind moves one seat forward every
   * hand" can survive people arriving and leaving between deals. See
   * `poker/blinds.ts`.
   */
  private previousBlinds: BlindPositions | null = null;
  /**
   * Consecutive turns a seat let the clock answer for it. Reset by any action
   * the player takes themselves.
   *
   * Keyed by session id rather than seat, so a seat that changes hands does
   * not inherit the last occupant's record.
   */
  private readonly timeoutStrikes = new Map<string, number>();
  /**
   * Per-client, per-message-type budget for the socket.
   *
   * The soft target this room has is not an outsider - matchmaking is locked
   * down in `index.ts` and creating a room is rate-limited per address - it is
   * somebody who already has a seat and an open console. See
   * `messageLimits.ts` for what a loop can cost the other seven people at the
   * table, and why every handler below starts with a budget check rather than
   * with a state lookup.
   */
  private readonly messageLimits = new MessageLimiter();
  /**
   * Display names of everyone dealt into the hand in flight, captured at the
   * deal.
   *
   * A player can leave mid-hand while all-in, reach the showdown, and win it
   * with nobody left in `state.players` to name. Without this the table is
   * told a pot was won by nobody, which is worse than being told an absent
   * player won it.
   */
  private readonly handNames = new Map<number, string>();
  /**
   * When the result currently on screen was decided, or 0 between payouts.
   *
   * The showdown ceremony is played out client-side and takes a few seconds,
   * so "everyone has pressed Next round" can arrive before anyone has actually
   * watched the run-out - a spectator who folded on the flop has nothing left
   * to reveal and could be clicking within a frame of the result landing.
   * `PAYOUT_DISPLAY_MS` is measured from here, so the ceremony always gets to
   * finish.
   */
  private payoutStartedAt = 0;
  /**
   * The next deal is committed and the vote is closed.
   *
   * A latch, and it exists to close a real hole rather than to tidy anything
   * up. `considerContinuing` is reachable from `SitOut`, which any client may
   * send at any rate it likes, and it used to call `scheduleDeal`
   * unconditionally - and `scheduleDeal` *clears* the pending timer before
   * arming a new one. So once the table had voted, a client toggling sit-out
   * and sit-in faster than `NEXT_HAND_BEAT_MS` pushed the deal 450ms further
   * out on every message, having already discarded the `PAYOUT_MAX_MS`
   * backstop. The room would sit in `Payout` forever with nothing left to
   * rescue it.
   *
   * Once the deal is armed it stays armed. Anything that changes the roster
   * after that point - a seat buying in, sitting back in, or joining - is a
   * player who will be dealt into the next hand without having watched this
   * showdown, which is the same deal a player who joins mid-hand already gets.
   */
  private continuing = false;

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
    this.state.smallBlindSeat = NO_SEAT;
    this.state.bigBlindSeat = NO_SEAT;
    this.state.lastResult = "";

    // Matchmaking joins by code, so the code must be queryable metadata.
    void this.setMetadata({ code });

    this.onIntent<PokerActionIntent>(ClientMessage.Action, (client, intent) => {
      this.handleAction(client, intent);
    });

    this.onIntent(ClientMessage.Ready, (client) => {
      const player = this.state.players.get(client.sessionId);
      // Idempotent, and one-way. Re-sending it is a no-op rather than a patch
      // fanned out to the whole table, and there is no "un-ready": once the
      // game is running, being dealt out is `SitOut`, which says so on the
      // seat and has the blind rules attached to it.
      if (!player || player.ready) return;
      player.ready = true;
      console.log(
        `[room ${this.state.code}] ${player.displayName} is ready` +
          ` (${this.readyPlayers().length}/${this.state.players.size})`,
      );
      this.considerDealing();
    });

    this.onIntent(ClientMessage.NextHand, (client) => {
      this.handleNextHand(client);
    });

    this.onIntent(ClientMessage.SitOut, (client) => {
      const player = this.state.players.get(client.sessionId);
      // Unchanged is a no-op. `sittingOut` is a public field, so writing it
      // unconditionally would turn one inbound byte into a patch fanned out to
      // every client at the table, as fast as a client cared to send it.
      if (!player || player.sittingOut) return;
      player.sittingOut = true;
      // Sitting out never yanks a player out of the hand they are already in;
      // it takes effect at the next deal. Leaving mid-hand is a fold, and
      // that is a different, explicit thing.
      //
      // It does end their vote on the payout screen, though: a seat that is
      // not in the next hand cannot be the one the next hand is waiting for.
      this.considerContinuing();
    });

    this.onIntent(ClientMessage.SitIn, (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !player.sittingOut) return;
      player.sittingOut = false;
      // Nothing about `owesBlind` here on purpose. Sitting back in does not
      // itself cost a blind - *missing a deal* does, and `deal()` is what
      // records that. Someone who sits out and changes their mind before the
      // next hand has missed nothing and owes nothing.
      // Whatever put them in the corner is over; a fresh sit-in starts the
      // strike count again.
      this.timeoutStrikes.delete(client.sessionId);
      this.considerDealing();
    });

    this.onIntent<BuyInIntent>(ClientMessage.BuyIn, (client, intent) => {
      this.handleBuyIn(client, intent);
    });

    this.onIntent(ClientMessage.RequestMediaToken, (client) => {
      void this.sendMediaToken(client);
    });

    console.log(`[room ${code}] created (${this.roomId})`);
  }

  /**
   * Register a handler for a client message, behind its budget.
   *
   * Every inbound message goes through here, which is the only way it can be
   * true that nothing expensive runs before the budget is checked. A guard
   * placed inside a handler - after the `state.players.get`, after the engine
   * call - has already paid for the frame it is refusing, and `action` is
   * exactly that shape: it reaches `applyAction` and `legalActions` on every
   * out-of-turn frame and answers each one with an `ActionRejected`.
   *
   * An over-budget message is dropped in silence. Answering would hand a
   * flooder an amplifier - one inbound frame becoming one outbound frame is
   * the trade that put `action` on the list in the first place - so the
   * evidence goes to the log instead, once per client per window.
   */
  private onIntent<T = unknown>(
    type: ClientMessageType,
    handler: (client: Client, payload: T) => void,
  ): void {
    this.onMessage<T>(type, (client, payload) => {
      if (!this.messageLimits.allow(type, client.sessionId)) {
        if (this.messageLimits.shouldLog(client.sessionId)) {
          const player = this.state.players.get(client.sessionId);
          console.warn(
            `[room ${this.state.code}] rate-limited "${type}" from` +
              ` ${player?.displayName ?? client.sessionId}`,
          );
        }
        return;
      }
      handler(client, payload);
    });
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
    // Nobody is dealt in by the act of sitting down. The first hand waits for
    // `MIN_PLAYERS` people to say they are ready; see `ClientMessage.Ready`.
    player.ready = false;
    player.readyNext = false;
    player.sittingOut = false;
    player.stack = STARTING_STACK;
    player.totalBuyIn = STARTING_STACK;
    player.pendingBuyIn = 0;
    player.handsPlayed = 0;
    player.handsWon = 0;
    // Sitting down at a table already in play means waiting for the blind, the
    // same as anywhere else. The first players to arrive owe nothing, or a
    // table of two would never deal its first hand.
    player.owesBlind = this.previousBlinds !== null;
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
    // An empty chair is also not somebody the payout screen is waiting on.
    this.considerContinuing();

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
    // Read before anything moves, so "did the clock change hands" is answered
    // by comparing two facts rather than by guessing from who left.
    const actingBefore = this.hand?.actingSeat ?? null;

    if (player) {
      // Their chips are already in the pot and stay there. What they cannot do
      // is hold up the table, so the seat folds and play moves on.
      if (this.hand) forfeit(this.hand, player.seat);

      this.takenSeats.delete(player.seat);
      this.state.players.delete(client.sessionId);
      this.disconnectedSince.delete(client.sessionId);
      this.timeoutStrikes.delete(client.sessionId);
      // Their spent budget goes with them. Colyseus can hand out a session id
      // again, and a new client inheriting somebody else's exhausted window
      // would be refused its own first action.
      this.messageLimits.forget(client.sessionId);
      // A showdown row outlives the hand it belongs to by the length of the
      // payout screen, and it is keyed by seat because a departed seat has no
      // session id left to key it by. Freeing the seat in that window would
      // hand the row to whoever sits down next, who would be shown holding
      // someone else's hand and credited with someone else's pot. The row goes
      // with the player.
      this.dropRevealFor(player.seat);

      console.log(
        `[room ${this.state.code}] - ${player.displayName} left (${code})`,
      );
    }

    if (this.hand) {
      // Only a *new* decision restarts the clock. Bumping unconditionally -
      // which this used to do - handed the acting seat a fresh thirty seconds
      // every time anyone else at the table left, which is the same exploit
      // `turnDeadline` exists to close, coming in through a different door.
      if (this.hand.actingSeat !== actingBefore) this.bumpTurn();
      this.syncHand();
    }
    // They are not coming back to press Next round.
    this.considerContinuing();
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
    if (!outcome.ok) {
      this.reject(client, outcome.reason);
      return;
    }
    // They are at the keyboard after all. Deciding for yourself is the thing
    // the strike count is counting the absence of.
    this.timeoutStrikes.delete(client.sessionId);
  }

  /**
   * A request to put more chips behind a seat.
   *
   * The rule itself lives in `buyIn.ts`, which is pure and knows nothing about
   * rooms. What this owns is *when* the chips land: immediately between hands,
   * and at the end of the current one for a seat that is in it, because table
   * stakes means you play a hand with the chips you started it with.
   */
  private handleBuyIn(client: Client, intent: BuyInIntent): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      this.reject(client, "you are not seated at this table");
      return;
    }

    const seat = this.hand?.seats.get(player.seat);
    const inHand = !!seat && seat.playerId === client.sessionId;

    const decision = decideBuyIn(intent?.amount, {
      stack: player.stack,
      pending: player.pendingBuyIn,
      inHand,
    });
    if (!decision.ok) {
      this.reject(client, decision.reason);
      return;
    }

    if (!decision.immediate) {
      // Held in public view: everyone can see the chips arrive, they just
      // cannot be bet with until the hand is done.
      player.pendingBuyIn += decision.amount;
      console.log(
        `[room ${this.state.code}] ${player.displayName} bought in for` +
          ` ${decision.amount}, waiting on hand ${this.hand?.handNumber}`,
      );
      return;
    }

    player.stack += decision.amount;
    player.totalBuyIn += decision.amount;
    // Nothing about `owesBlind`: whether this seat has to wait was already
    // settled by the deals it did or did not sit out while it was broke.
    // Rebuying between two hands costs nothing; rebuying after watching four
    // go by does, and the four hands are what recorded it.

    console.log(
      `[room ${this.state.code}] ${player.displayName} bought in for` +
        ` ${decision.amount} (stack ${player.stack})`,
    );
    this.considerDealing();
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

  /**
   * Withdraw one seat's published showdown.
   *
   * Rebuilt rather than spliced: `ArraySchema` indices are what the encoder
   * diffs against, and removing from the middle of one in place is the kind of
   * thing that works until the day it does not.
   */
  private dropRevealFor(seat: number): void {
    const keep = [...this.state.reveals].filter((r) => r.seat !== seat);
    if (keep.length === this.state.reveals.length) return;
    this.state.reveals.clear();
    for (const reveal of keep) this.state.reveals.push(reveal);
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
    if (outcome.ok) {
      if (player) this.strikeForTimeout(player);
      return;
    }

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

  /**
   * Count a turn the clock had to answer, and eventually stop asking.
   *
   * A seat the server keeps deciding for is a chair nobody is in, and the
   * table can see that long before the reconnection window does. After a few
   * in a row the seat is dealt out - it keeps its stack and its place, and its
   * player only has to say they are back. Anything they do themselves clears
   * the count, so thinking slowly is never punished.
   *
   * Only connected players are struck. A dropped one is already dealt out by
   * `eligiblePlayers` and would otherwise come back from a brief outage to
   * find themselves sitting out for reasons they never saw.
   */
  private strikeForTimeout(player: PlayerInstance): void {
    if (!player.connected || player.sittingOut) return;

    const strikes = (this.timeoutStrikes.get(player.sessionId) ?? 0) + 1;
    this.timeoutStrikes.set(player.sessionId, strikes);
    if (strikes < AUTO_SIT_OUT_TIMEOUTS) return;

    player.sittingOut = true;
    this.timeoutStrikes.delete(player.sessionId);
    console.log(
      `[room ${this.state.code}] ${player.displayName} sat out after` +
        ` ${AUTO_SIT_OUT_TIMEOUTS} timed-out turns`,
    );
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

    // Credited before the mirror, so the leaderboard the payout screen renders
    // is already counting this hand.
    const wonBySeat = new Set<number>();
    for (const award of hand.result.awards) {
      if (award.amount > 0) wonBySeat.add(award.seat);
    }
    for (const seat of wonBySeat) {
      const player = bySeat.get(seat);
      const engineSeat = hand.seats.get(seat);
      if (player && engineSeat?.playerId === player.sessionId) {
        player.handsWon += 1;
      }
    }

    mirrorResult(this.state, hand, bySeat, this.handNames);
    this.hand = null;

    const summary = this.state.lastResult || "hand over";
    console.log(`[room ${this.state.code}] hand ${hand.handNumber}: ${summary}`);

    // The result stays up until the table has finished talking about it,
    // which is the point of the product. Every seat still in the game presses
    // Next round and the deal follows; `PAYOUT_MAX_MS` is only the backstop
    // for a table that walked away. Either way there is no lobby round-trip.
    this.payoutStartedAt = Date.now();
    this.continuing = false;
    this.state.players.forEach((player) => {
      player.readyNext = false;
    });
    this.scheduleDeal(PAYOUT_MAX_MS);
    // A payout nobody is left to watch - everyone busted, dropped or sat out
    // as the hand ended - should not sit on a minute-long timer.
    this.considerContinuing();
  }

  /**
   * "I have seen it, deal the next one."
   *
   * A vote, not a command. It is recorded and then `considerContinuing` decides
   * whether the table has finished looking at the hand; one client cannot deal
   * over the top of five people still reacting to a river.
   */
  private handleNextHand(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    // Only ever meaningful while a decided hand is on screen. Outside that it
    // is a stale click from a client whose payout has already cleared.
    if (this.hand || this.state.phase !== TablePhase.Payout) return;
    // Idempotent, and one inbound byte must not become a patch to every
    // client at the table as fast as somebody cares to send it.
    if (player.readyNext) return;
    player.readyNext = true;
    this.considerContinuing();
  }

  /**
   * Deal early once everybody who is in the next hand has asked to move on.
   *
   * "Everybody" is `eligiblePlayers()`, the same set that would be dealt in:
   * a seat that busted, dropped, sat out or left is not somebody the table
   * waits for. That also makes the empty case correct rather than a special
   * one - a payout with nobody eligible has nobody to wait for, and `deal()`
   * puts the table back to waiting.
   */
  private considerContinuing(): void {
    // Latched, and see the note on the field: without this, any client could
    // hold the table in `Payout` indefinitely by toggling sit-out, because
    // each call re-armed the deal timer and threw away the backstop.
    if (this.hand || this.continuing) return;
    if (this.state.phase !== TablePhase.Payout) return;
    if (this.eligiblePlayers().some((player) => !player.readyNext)) return;

    this.continuing = true;
    // The client is still turning cards over. Whatever the table clicked, the
    // showdown gets the whole of `PAYOUT_DISPLAY_MS` to play out.
    const watched = Date.now() - this.payoutStartedAt;
    const remaining = Math.max(0, PAYOUT_DISPLAY_MS - watched);
    this.scheduleDeal(Math.max(NEXT_HAND_BEAT_MS, remaining));
  }

  /** Deal if a hand can start and one is not already running or scheduled. */
  private considerDealing(): void {
    if (this.hand || this.dealTimer) return;
    if (this.eligiblePlayers().length < MIN_PLAYERS) return;
    this.scheduleDeal(HAND_START_DELAY_MS);
  }

  /** Everyone who has pressed Play, whatever else is true of them. */
  private readyPlayers(): PlayerInstance[] {
    const out: PlayerInstance[] = [];
    this.state.players.forEach((player) => {
      if (player.ready) out.push(player);
    });
    return out;
  }

  /**
   * Seats able and willing to be dealt in right now.
   *
   * Deliberately *not* the same question as "who is in the next hand": a seat
   * waiting for the big blind is ready and still sits the hand out. That
   * second decision belongs to `poker/blinds.ts`, which is where the rule
   * about waiting lives.
   */
  private eligiblePlayers(): PlayerInstance[] {
    const out: PlayerInstance[] = [];
    this.state.players.forEach((player) => {
      // Chips still waiting on the end of a hand count towards being able to
      // play the next one; `applyPendingBuyIns` pushes them across first.
      if (player.stack + player.pendingBuyIn <= 0) return;
      // Has not said they are ready yet. This is what holds the very first
      // deal until somebody presses Play, and it also means a friend who
      // joins an evening already in progress is not dealt a hand while they
      // are still saying hello.
      if (!player.ready) return;
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

  /**
   * Push chips bought during a hand across into the stacks they were bought
   * for. Called once, immediately before the next deal.
   *
   * A player can win the hand they bought in during and come out over the
   * ceiling, so the top-up is re-clipped here against the stack they actually
   * ended up with. What no longer fits is simply not charged: `totalBuyIn`
   * only ever counts chips that reached the table, which is what makes the
   * leaderboard's profit column mean anything.
   */
  private applyPendingBuyIns(): void {
    this.state.players.forEach((player) => {
      if (player.pendingBuyIn <= 0) return;

      const room = Math.max(0, MAX_STACK - player.stack);
      const added = Math.min(player.pendingBuyIn, room);

      player.pendingBuyIn = 0;
      if (added === 0) return;

      player.stack += added;
      player.totalBuyIn += added;

      console.log(
        `[room ${this.state.code}] ${player.displayName} added ${added}` +
          ` between hands (stack ${player.stack})`,
      );
    });
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
    this.payoutStartedAt = 0;
    this.continuing = false;

    // Chips bought during the last hand join their stacks now, which is also
    // what can take a busted seat back over the line into the next one.
    this.applyPendingBuyIns();

    const eligible = this.eligiblePlayers();
    const bySeat = this.playersBySeat();

    // Who is dealt in, who posts what, and where the button sits - all of it
    // decided by `poker/blinds.ts`, which is pure and tested on its own. The
    // room supplies only three facts per seat and takes the arrangement back.
    const arrangement =
      eligible.length < MIN_PLAYERS
        ? null
        : nextBlinds(
            eligible.map((player) => ({
              seat: player.seat,
              ready: true,
              owesBlind: player.owesBlind,
            })),
            this.previousBlinds,
          );

    if (!arrangement) {
      // Back to waiting. Everything from the last hand is cleared, including
      // the cards, so nothing survives into a hand it does not belong to.
      clearHand(this.state, bySeat);
      clearResult(this.state);
      this.armTurnClock();
      return;
    }

    const dealt = arrangement.dealt.flatMap((seat) => {
      const player = bySeat.get(seat);
      return player ? [player] : [];
    });
    this.handNumber += 1;

    clearHand(this.state, bySeat);
    clearResult(this.state);
    this.bumpTurn();

    // The engine validates the arrangement it is handed and throws rather than
    // dealing a hand it cannot describe. That is right inside a pure module,
    // but an exception escaping a timer callback would take the process with
    // it and leave six people looking at a frozen table. The blinds do not
    // move, the hand number is given back, and the room returns to waiting.
    //
    // Deliberately *not* rescheduled. Because the blinds correctly do not
    // advance, a retry would recompute the identical arrangement and throw
    // again, forever, a few seconds apart. The next thing a player does -
    // sitting in, buying in, joining - runs `considerDealing()` and tries
    // again with a roster that has actually changed. Unreachable today:
    // `applyPendingBuyIns()` runs before `eligiblePlayers()`, so every dealt
    // seat has chips and none of `startHand`'s three checks can fire.
    let hand: HandState;
    try {
      hand = startHand({
        players: dealt.map((p) => ({
          seat: p.seat,
          playerId: p.sessionId,
          stack: p.stack,
        })),
        button: arrangement.button,
        smallBlindSeat: arrangement.smallBlindSeat,
        bigBlindSeat: arrangement.bigBlindSeat,
        smallBlind: SMALL_BLIND,
        bigBlind: BIG_BLIND,
        handNumber: this.handNumber,
        randomInt: secureRandomInt,
      });
    } catch (err) {
      console.error(
        `[room ${this.state.code}] could not deal hand ${this.handNumber}:`,
        err,
      );
      this.handNumber -= 1;
      this.armTurnClock();
      return;
    }

    this.hand = hand;
    // Only recorded once the hand actually started, so a refused deal cannot
    // move the blinds on and cost somebody a blind they never got to play.
    this.previousBlinds = arrangement;
    this.state.smallBlindSeat = arrangement.smallBlindSeat ?? NO_SEAT;
    this.state.bigBlindSeat = arrangement.bigBlindSeat;

    this.handNames.clear();
    const seated = new Set(arrangement.dealt);
    for (const player of dealt) {
      // Whatever they were waiting for, they have been dealt in; the seat that
      // posted the blind has paid it.
      player.owesBlind = false;
      player.handsPlayed += 1;
      this.handNames.set(player.seat, player.displayName);
    }

    // Everyone else at the table just watched a blind go past without paying
    // it, and that - not sitting out, not busting, not rebuying - is what owing
    // one *is*. Recording it here means a seat that changes its mind between
    // two deals waits for nothing, and a seat that sat five hands out cannot
    // step back in one place past the blinds.
    //
    // **No exemption for a dropped player**, and that is a deliberate reversal.
    // Sparing them read as generosity - their seat, stack and cards are all
    // held for them, so why charge them a blind? - but a non-consented drop is
    // one `ws.close()` away, `state.bigBlindSeat` says exactly when the blind
    // is due, and the reconnection window is a minute long. That is the "step
    // in past the blinds, fold round, step out again" behaviour this rule
    // exists to stop, arriving through the reconnection door. Whether a blind
    // went past your empty chair is not a question about your connection.
    //
    // What a dropped player keeps is everything that matters: the seat, the
    // chips, the cards and a minute to come back. What they pay is the same
    // thing anyone else pays for missing hands, which is a wait for the blind.
    this.state.players.forEach((player) => {
      if (seated.has(player.seat)) return;
      player.owesBlind = true;
    });

    mirrorHoleCards(this.hand, bySeat);
    console.log(
      `[room ${this.state.code}] hand ${this.handNumber} dealt to` +
        ` ${dealt.length} (button ${arrangement.button},` +
        ` SB ${arrangement.smallBlindSeat ?? "dead"},` +
        ` BB ${arrangement.bigBlindSeat})`,
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
