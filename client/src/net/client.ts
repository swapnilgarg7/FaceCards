import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  type ApiErrorResponse,
  type CreateRoomResponse,
  type JoinOptions,
  type PokerStateInstance,
} from "@facecards/shared";

/**
 * Colyseus transport. Everything here is a request to the authoritative
 * server; nothing here decides anything about the game.
 */

const httpUrl =
  import.meta.env.VITE_SERVER_HTTP_URL ?? "http://localhost:2567";
const wsUrl = import.meta.env.VITE_SERVER_WS_URL ?? "ws://localhost:2567";

export type PokerRoom = Room<PokerStateInstance>;

const colyseus = new Client(wsUrl);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${httpUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorResponse | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/**
 * Ask the server to create a room. The code comes back from the server; the
 * client has no say in what it is, which is the only reason a private table
 * stays private.
 */
export async function createRoom(): Promise<string> {
  const { code } = await api<CreateRoomResponse>("/api/rooms", {
    method: "POST",
  });
  return code;
}

/** Join an existing room by code. Fails if no such room, never creates one. */
export async function joinRoom(options: JoinOptions): Promise<PokerRoom> {
  return colyseus.join<PokerStateInstance>(ROOM_NAME, {
    ...options,
    code: options.code.trim().toUpperCase(),
  });
}
