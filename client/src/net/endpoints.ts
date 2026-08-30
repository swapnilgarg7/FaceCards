/**
 * Where the game server lives.
 *
 * Its own file so that `wake.ts` can reach the HTTP origin without importing
 * `client.ts`, which imports `wake.ts` back.
 *
 * Both are baked in at build time by Vite. Changing where a deployed client
 * points is a rebuild, not a restart. In production both must be TLS
 * (`https:`/`wss:`), and that is now checked here rather than only asked for
 * in docs/DEPLOYMENT.md - see `assertSecureEndpoints` below.
 */

/**
 * Vite's build-time environment, or nothing.
 *
 * Optional because this module is also imported outside a bundle: the
 * `verify:phase6` script runs `checkEndpoints` under plain Node through tsx,
 * where `import.meta.env` does not exist and reading a property off it throws
 * before the file has finished loading. A verification script that cannot
 * import the thing it verifies is not much of a verification script.
 */
const env = import.meta.env as ImportMetaEnv | undefined;

/** True when this bundle was built for production. */
const PRODUCTION = env?.PROD ?? false;

export const httpUrl = env?.VITE_SERVER_HTTP_URL ?? "http://localhost:2567";

export const wsUrl = env?.VITE_SERVER_WS_URL ?? "ws://localhost:2567";

/** Hostnames that are a secure context without TLS, per the platform's rules. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLoopback(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * A production bundle pointed at a plaintext server fails at module load.
 *
 * The server half of this lives in `server/src/tls.ts` and checks
 * `CORS_ORIGINS`. Both halves are needed, because they catch different
 * mistakes: the server cannot see what scheme a browser used to reach it
 * through Render's proxy, and the client cannot see what the server was
 * configured with. The one thing they agree on is why it matters - **hole
 * cards are private server state and they ride this socket** - so a
 * misconfigured deploy silently removes the guarantee the whole architecture
 * is built around, with no visible symptom.
 *
 * The failure is deliberately at load and deliberately loud. The alternative
 * is a table that works perfectly in testing and is transparent to anyone on
 * the network, which is the worst shape a security bug can take.
 *
 * Two things this does *not* do. It does not run outside a production build,
 * because the dev stack is `http://localhost` and has to stay that way -
 * `localhost` is a secure context by definition and requiring certificates to
 * run `npm run dev` would be a daily tax against a mistake that can only be
 * made once, in a dashboard. And it exempts loopback even in production, so a
 * production build can still be run locally to reproduce something.
 */
export function checkEndpoints(
  http: string,
  ws: string,
  production: boolean,
): string | null {
  if (!production) return null;
  const bad: string[] = [];
  if (!http.startsWith("https:") && !isLoopback(http)) bad.push(http);
  if (!ws.startsWith("wss:") && !isLoopback(ws)) bad.push(ws);
  if (bad.length === 0) return null;
  return (
    `This build points at ${bad.join(" and ")}, which is not encrypted.` +
    ` Hole cards travel over this connection. Rebuild with https:// and` +
    ` wss:// in VITE_SERVER_HTTP_URL and VITE_SERVER_WS_URL` +
    ` (see docs/DEPLOYMENT.md).`
  );
}

const problem = checkEndpoints(httpUrl, wsUrl, PRODUCTION);
if (problem) throw new Error(problem);
