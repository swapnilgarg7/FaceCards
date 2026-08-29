/**
 * Where the game server lives.
 *
 * Its own file so that `wake.ts` can reach the HTTP origin without importing
 * `client.ts`, which imports `wake.ts` back.
 *
 * Both are baked in at build time by Vite. Changing where a deployed client
 * points is a rebuild, not a restart. In production both must be TLS
 * (`https:`/`wss:`): see docs/DEPLOYMENT.md.
 */
export const httpUrl =
  import.meta.env.VITE_SERVER_HTTP_URL ?? "http://localhost:2567";

export const wsUrl = import.meta.env.VITE_SERVER_WS_URL ?? "ws://localhost:2567";
