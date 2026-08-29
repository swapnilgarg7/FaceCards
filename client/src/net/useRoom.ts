import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClientMessage,
  PokerAction,
  ServerMessage,
  TablePhase,
  type ActionRejectedPayload,
  type MediaTokenPayload,
  type PokerActionType,
  type SeatStatusValue,
  type TablePhaseValue,
} from "@facecards/shared";
import { createRoom, joinRoom, type PokerRoom } from "./client.js";
import { describeDisconnect, explainDisconnect } from "./disconnectReason.js";

/**
 * Room lifecycle as a hook.
 *
 * State here is a *mirror of a mirror*: the server projects its poker engine
 * into the schema, and this copies the schema into a plain object for React.
 * Nothing in this file computes a game value. It does not know what a
 * min-raise is, whether you may check, or who won; it reads what the server
 * said. That is the same rule the server enforces from the other side, and it
 * is why there is no poker logic anywhere under `client/`.
 *
 * Reading a plain snapshot (rather than rendering Colyseus proxies directly)
 * also keeps the 3D scene honest: it mutates refs inside `useFrame` and must
 * not re-render on every patch.
 */

export interface SeatSnapshot {
  sessionId: string;
  displayName: string;
  /** Archetype id. Validated server-side; resolved by `avatars/archetypes.ts`. */
  avatar: string;
  seat: number;
  /** False while this seat is being held open through a reconnection window. */
  connected: boolean;
  /**
   * This player has pressed Play. Nothing is dealt to a seat that has not.
   *
   * The gate is on starting, not on every hand: once it is true it stays
   * true, and a running table deals itself.
   */
  ready: boolean;
  /** Asked to be dealt out. Takes effect at the next deal, never mid-hand. */
  sittingOut: boolean;
  stack: number;
  bet: number;
  /** Every chip this seat has brought to the table, the opening stake first. */
  totalBuyIn: number;
  /** Chips bought mid-hand, landing at the next deal. */
  pendingBuyIn: number;
  handsPlayed: number;
  handsWon: number;
  /** Dealt out until the big blind reaches this seat. */
  owesBlind: boolean;
  status: SeatStatusValue;
  /** Face-down cards in front of this seat. */
  cardCount: number;
  /**
   * Present only for the local player. For every other seat the field is not
   * in this client's payload at all, so there is nothing here to leak.
   */
  holeCards?: string[];
}

export interface RevealSnapshot {
  sessionId: string;
  seat: number;
  cards: string[];
  best: string[];
  description: string;
  won: number;
}

export interface PotSnapshot {
  amount: number;
  eligible: string[];
}

export interface RoomSnapshot {
  code: string;
  phase: TablePhaseValue;
  board: string[];
  pot: number;
  pots: PotSnapshot[];
  currentBet: number;
  canCheck: boolean;
  canRaise: boolean;
  callAmount: number;
  minRaiseTo: number;
  maxRaiseTo: number;
  actingSeat: number;
  /**
   * How long the seat on the clock has, in milliseconds, or 0 for nobody.
   *
   * A budget, not a deadline: the countdown starts when `turn` changes, which
   * is when this client learned about the decision. See the note on the field
   * in `shared/src/state.ts` for why it is not a timestamp.
   */
  actingMs: number;
  /** Opaque token for the decision on the clock. Echoed back with an intent. */
  turn: number;
  buttonSeat: number;
  /** Seat that posted the small blind, or -1 when it was dead. */
  smallBlindSeat: number;
  bigBlindSeat: number;
  smallBlind: number;
  bigBlind: number;
  handNumber: number;
  reveals: RevealSnapshot[];
  lastResult: string;
  players: SeatSnapshot[];
}

export type RoomStatus =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  /**
   * The socket dropped and the SDK is retrying. Deliberately *not* an error
   * and deliberately not "idle": the seat, the stack and the cards are all
   * still ours on the server for the length of its reconnection window, so
   * the table stays on screen with a banner over it rather than collapsing
   * back to a lobby that would take a new seat and a fresh 1000 chips.
   */
  | { kind: "reconnecting" }
  | { kind: "error"; message: string };

export interface UseRoom {
  status: RoomStatus;
  snapshot: RoomSnapshot | null;
  sessionId: string | null;
  mediaToken: MediaTokenPayload | null;
  /** Last illegal action the server bounced, for a one-line explanation. */
  rejection: string | null;
  create(displayName: string, avatar: string): Promise<void>;
  join(code: string, displayName: string, avatar: string): Promise<void>;
  act(turn: number, type: PokerActionType, amount?: number): void;
  /** "I am ready to play." What holds the first deal until somebody says it. */
  setReady(): void;
  /** Deal me out from the next hand, or back in. Never affects a live hand. */
  setSittingOut(sittingOut: boolean): void;
  /**
   * Ask to put `amount` more chips behind this seat.
   *
   * A request like any other: the server checks it against the buy-in band and
   * the stack ceiling, and decides whether the chips land now or at the end of
   * the hand being played. A refusal comes back as an `ActionRejected`.
   */
  buyIn(amount: number): void;
  leave(): Promise<void>;
}

/**
 * Copy the decoded state into a plain object, or null if it has not arrived.
 *
 * `join()` resolves before the first state patch is decoded, so `room.state`
 * is real but empty for the first few milliseconds. Reading through it
 * unguarded throws, and the throw lands in the join handler where it reads as
 * a connection failure rather than a race.
 */
function snapshotOf(room: PokerRoom): RoomSnapshot | null {
  const state = room.state;
  if (!state?.players) return null;

  const players: SeatSnapshot[] = [];
  state.players.forEach((player) => {
    // Empty strings for everyone else, because the fields are absent from
    // this client's payload rather than blanked out.
    const cards = [player.holeCard0, player.holeCard1].filter(Boolean);
    players.push({
      sessionId: player.sessionId,
      displayName: player.displayName,
      avatar: player.avatar,
      seat: player.seat,
      connected: player.connected,
      ready: player.ready,
      sittingOut: player.sittingOut,
      stack: player.stack,
      bet: player.bet,
      totalBuyIn: player.totalBuyIn,
      pendingBuyIn: player.pendingBuyIn,
      handsPlayed: player.handsPlayed,
      handsWon: player.handsWon,
      owesBlind: player.owesBlind,
      status: player.status as SeatStatusValue,
      cardCount: player.cardCount,
      ...(cards.length > 0 ? { holeCards: cards } : {}),
    });
  });
  players.sort((a, b) => a.seat - b.seat);

  const reveals: RevealSnapshot[] = [];
  state.reveals?.forEach((reveal) => {
    reveals.push({
      sessionId: reveal.sessionId,
      seat: reveal.seat,
      cards: [...reveal.cards],
      best: [...reveal.best],
      description: reveal.description,
      won: reveal.won,
    });
  });

  const pots: PotSnapshot[] = [];
  state.pots?.forEach((pot) => {
    pots.push({ amount: pot.amount, eligible: [...pot.eligible] });
  });

  return {
    code: state.code,
    phase: (state.phase || TablePhase.Waiting) as TablePhaseValue,
    board: [...(state.board ?? [])],
    pot: state.pot,
    pots,
    currentBet: state.currentBet,
    canCheck: state.canCheck,
    canRaise: state.canRaise,
    callAmount: state.callAmount,
    minRaiseTo: state.minRaiseTo,
    maxRaiseTo: state.maxRaiseTo,
    actingSeat: state.actingSeat,
    actingMs: state.actingMs,
    turn: state.turn,
    buttonSeat: state.buttonSeat,
    smallBlindSeat: state.smallBlindSeat,
    bigBlindSeat: state.bigBlindSeat,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
    handNumber: state.handNumber,
    reveals,
    lastResult: state.lastResult,
    players,
  };
}

export function useRoom(): UseRoom {
  const roomRef = useRef<PokerRoom | null>(null);
  const [status, setStatus] = useState<RoomStatus>({ kind: "idle" });
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mediaToken, setMediaToken] = useState<MediaTokenPayload | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  /**
   * Why this room ended badly, if it did.
   *
   * A ref, because `onLeave` has to read it in the same tick `onError` wrote
   * it and a state update would not have landed yet. It exists because
   * Colyseus reports one failure through *two* callbacks in order - the
   * `Protocol.ERROR` frame first, the socket close a moment later - and
   * `onLeave` used to reset the status unconditionally, so the explanation was
   * overwritten by "idle" immediately after being shown. That is what being
   * "randomly logged out" looks like from the inside: the reason existed, for
   * about one frame.
   */
  const failure = useRef<string | null>(null);

  const attach = useCallback((room: PokerRoom) => {
    roomRef.current = room;
    failure.current = null;
    setSessionId(room.sessionId);
    setSnapshot(snapshotOf(room));

    room.onStateChange(() => setSnapshot(snapshotOf(room)));

    room.onMessage<MediaTokenPayload>(ServerMessage.MediaToken, (payload) => {
      setMediaToken(payload);
    });

    // The server has already corrected itself; this is only ever an
    // explanation for a human, never a state correction to apply.
    room.onMessage<ActionRejectedPayload>(
      ServerMessage.ActionRejected,
      (payload) => setRejection(payload?.reason ?? "action rejected"),
    );

    // Colyseus sends this as a frame *before* closing the socket, so it is the
    // only place the real reason is available - by the time `onLeave` fires,
    // all that is left is a close code. Both are logged raw: the first report
    // of a 524 arrived as a screenshot of a sentence with the code already
    // formatted out of it, and there was nothing else to go on.
    room.onError((code, message) => {
      console.warn(describeDisconnect("error", code, message));
      failure.current = explainDisconnect(code, message) ?? failure.current;
      if (failure.current) setStatus({ kind: "error", message: failure.current });
    });

    // The socket died but the SDK will keep trying, and the server is holding
    // the seat open for `RECONNECT_GRACE_MS` while it does. Nothing is torn
    // down here: the last snapshot stays on screen under a banner, because it
    // is still an accurate picture of a table we are still sitting at.
    //
    // The SDK's own retry ladder is left at its defaults deliberately. Fifteen
    // attempts on a doubling backoff capped at five seconds comes to about
    // fifty-six seconds, which lands just inside the server's sixty-second
    // window - so the last attempt is made while the seat is still there, and
    // giving up means the network is gone rather than that we stopped asking
    // too early. Its `minUptime` is the one gap: a drop inside the first five
    // seconds of a session is treated as a bad join and not retried at all.
    room.onDrop(() => setStatus({ kind: "reconnecting" }));

    room.onReconnect(() => {
      setStatus({ kind: "connected" });
      // The full state arrives with the rejoin, own hole cards included: the
      // server re-grants the view before it sends it.
      setSnapshot(snapshotOf(room));
    });

    // Every exit lands here: leaving on purpose, the reconnection window
    // closing, and the server refusing a reconnection. Only the first of those
    // is a plain return to the lobby.
    room.onLeave((code, reason) => {
      console.warn(describeDisconnect("leave", code, reason));
      roomRef.current = null;
      setSnapshot(null);
      setSessionId(null);
      setMediaToken(null);
      setRejection(null);

      // An explanation already on the books wins: `onError` saw the frame that
      // said *why*, and this close code only says *that*.
      const why = failure.current ?? explainDisconnect(code, reason);
      setStatus(why ? { kind: "error", message: why } : { kind: "idle" });
    });

    setStatus({ kind: "connected" });
  }, []);

  const join = useCallback(
    async (code: string, displayName: string, avatar: string) => {
      setStatus({ kind: "connecting" });
      try {
        attach(await joinRoom({ code, displayName, avatar }));
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [attach],
  );

  const create = useCallback(
    async (displayName: string, avatar: string) => {
      setStatus({ kind: "connecting" });
      try {
        // Two steps on purpose: the server mints the code, then we join it
        // like any other guest would. There is no privileged create path.
        const code = await createRoom();
        attach(await joinRoom({ code, displayName, avatar }));
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [attach],
  );

  const act = useCallback(
    (turn: number, type: PokerActionType, amount?: number) => {
      setRejection(null);
      // An intent. The amount is a request the server checks against the
      // min-raise, the stack and whose turn it is; everything else about the
      // action the server already knows. `turn` is the decision this answers,
      // copied straight back from server state.
      roomRef.current?.send(ClientMessage.Action, {
        turn,
        type,
        ...(type === PokerAction.Raise && amount !== undefined ? { amount } : {}),
      });
    },
    [],
  );

  const setReady = useCallback(() => {
    // "I am ready", not "start the game". The server counts how many seats
    // have said it and deals when enough have; one client cannot deal a hand
    // to a table that is not ready for it.
    roomRef.current?.send(ClientMessage.Ready);
  }, []);

  const setSittingOut = useCallback((sittingOut: boolean) => {
    // An intent like any other. The server decides when it takes effect, which
    // is at the next deal and never in the middle of a hand you are already
    // contesting.
    roomRef.current?.send(
      sittingOut ? ClientMessage.SitOut : ClientMessage.SitIn,
    );
  }, []);

  const buyIn = useCallback((amount: number) => {
    setRejection(null);
    // An amount, not a stack. The server owns what the balance becomes, and
    // owns whether the chips land now or after the hand in progress.
    roomRef.current?.send(ClientMessage.BuyIn, { amount });
  }, []);

  const leave = useCallback(async () => {
    await roomRef.current?.leave();
    roomRef.current = null;
  }, []);

  // A tab that closes without leaving holds its seat until the server times it
  // out, which at six fixed seats is the difference between a friend getting
  // in and being told the table is full.
  useEffect(() => {
    const onUnload = () => {
      void roomRef.current?.leave();
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      void roomRef.current?.leave();
    };
  }, []);

  return {
    status,
    snapshot,
    sessionId,
    mediaToken,
    rejection,
    create,
    join,
    act,
    setReady,
    setSittingOut,
    buyIn,
    leave,
  };
}
