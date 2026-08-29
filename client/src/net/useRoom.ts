import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClientMessage,
  ServerMessage,
  type MediaTokenPayload,
} from "@facecards/shared";
import { createRoom, joinRoom, type PokerRoom } from "./client.js";

/**
 * Room lifecycle as a hook.
 *
 * State here is a *mirror* of server state, refreshed from `onStateChange`.
 * Nothing in this file computes a game value; it copies what the server said.
 * Reading a plain snapshot into React (rather than rendering the Colyseus
 * proxies directly) also keeps phase 1 honest: the 3D scene will mutate refs
 * inside `useFrame` and must not be re-rendering on every patch.
 */

export interface SeatSnapshot {
  sessionId: string;
  displayName: string;
  seat: number;
  connected: boolean;
  /** Present only for the local player. Absent for everyone else, by design. */
  privateNote?: string;
}

export interface RoomSnapshot {
  code: string;
  counter: number;
  lastBumpBy: string;
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
  create(displayName: string): Promise<void>;
  join(code: string, displayName: string): Promise<void>;
  bump(): void;
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
  if (!room.state?.players) return null;

  const players: SeatSnapshot[] = [];
  room.state.players.forEach((player) => {
    players.push({
      sessionId: player.sessionId,
      displayName: player.displayName,
      seat: player.seat,
      connected: player.connected,
      // Undefined for every player but the local one: the field is not in
      // this client's payload at all, so there is nothing to read.
      privateNote: player.privateNote || undefined,
    });
  });
  players.sort((a, b) => a.seat - b.seat);

  return {
    code: room.state.code,
    counter: room.state.counter,
    lastBumpBy: room.state.lastBumpBy,
    players,
  };
}

export function useRoom(): UseRoom {
  const roomRef = useRef<PokerRoom | null>(null);
  const [status, setStatus] = useState<RoomStatus>({ kind: "idle" });
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mediaToken, setMediaToken] = useState<MediaTokenPayload | null>(null);

  const attach = useCallback((room: PokerRoom) => {
    roomRef.current = room;
    setSessionId(room.sessionId);
    setSnapshot(snapshotOf(room));

    room.onStateChange(() => setSnapshot(snapshotOf(room)));

    room.onMessage<MediaTokenPayload>(ServerMessage.MediaToken, (payload) => {
      setMediaToken(payload);
    });

    room.onError((code, message) => {
      setStatus({ kind: "error", message: `${message ?? "Room error"} (${code})` });
    });

    room.onLeave(() => {
      roomRef.current = null;
      setStatus({ kind: "idle" });
      setSnapshot(null);
      setSessionId(null);
      setMediaToken(null);
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

  const bump = useCallback(() => {
    // An intent with no payload. The server owns the number.
    roomRef.current?.send(ClientMessage.Bump);
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

  return { status, snapshot, sessionId, mediaToken, create, join, bump, leave };
}
