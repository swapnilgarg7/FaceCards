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
  seat: number;
  connected: boolean;
  stack: number;
  bet: number;
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
  /** Opaque token for the decision on the clock. Echoed back with an intent. */
  turn: number;
  buttonSeat: number;
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
  | { kind: "error"; message: string };

export interface UseRoom {
  status: RoomStatus;
  snapshot: RoomSnapshot | null;
  sessionId: string | null;
  mediaToken: MediaTokenPayload | null;
  /** Last illegal action the server bounced, for a one-line explanation. */
  rejection: string | null;
  create(displayName: string): Promise<void>;
  join(code: string, displayName: string): Promise<void>;
  act(turn: number, type: PokerActionType, amount?: number): void;
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
      seat: player.seat,
      connected: player.connected,
      stack: player.stack,
      bet: player.bet,
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
    turn: state.turn,
    buttonSeat: state.buttonSeat,
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

  const attach = useCallback((room: PokerRoom) => {
    roomRef.current = room;
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

    room.onError((code, message) => {
      setStatus({ kind: "error", message: `${message ?? "Room error"} (${code})` });
    });

    room.onLeave(() => {
      roomRef.current = null;
      setStatus({ kind: "idle" });
      setSnapshot(null);
      setSessionId(null);
      setMediaToken(null);
      setRejection(null);
    });

    setStatus({ kind: "connected" });
  }, []);

  const join = useCallback(
    async (code: string, displayName: string) => {
      setStatus({ kind: "connecting" });
      try {
        attach(await joinRoom({ code, displayName }));
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
    async (displayName: string) => {
      setStatus({ kind: "connecting" });
      try {
        // Two steps on purpose: the server mints the code, then we join it
        // like any other guest would. There is no privileged create path.
        const code = await createRoom();
        attach(await joinRoom({ code, displayName }));
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
    leave,
  };
}
