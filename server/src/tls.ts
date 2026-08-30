/**
 * TLS, asserted rather than documented.
 *
 * `docs/DEPLOYMENT.md` has always required `https:` and `wss:` in production
 * and nothing enforced it, which made it a comment rather than a constraint.
 * That gap matters more here than in most products, because of what rides the
 * socket: **hole cards are private server state, and they travel over it.** A
 * plaintext deploy does not degrade the product, it silently removes the one
 * guarantee the architecture is built around - and it does so with no visible
 * symptom at all, which is the worst possible failure shape for a security
 * property.
 *
 * `CORS_ORIGINS` is the lever this file pulls, and it is the right one because
 * it is the only place the server is *told* what scheme browsers will reach it
 * on. The server itself terminates plain HTTP behind Render's proxy and cannot
 * see the outside scheme, so it cannot check its own listener. What it can
 * check is the list of origins an operator typed, and an operator who typed
 * `http://facecards.pages.dev` has told us exactly what they have deployed.
 *
 * Two deliberate exemptions, both narrow:
 *
 *  - **Anything outside production is unchecked.** Local development is
 *    `http://localhost`, and it has to stay that way: `localhost` is a secure
 *    context by definition, `getUserMedia` works there, and requiring
 *    certificates to run the dev stack would be a tax paid every day to
 *    prevent a mistake that can only be made once, in a dashboard.
 *  - **Loopback stays legal even in production.** A production build run
 *    locally to reproduce something is a real thing people do, and refusing to
 *    start would push them into unsetting `NODE_ENV`, which turns off more
 *    than this check.
 *
 * Everything else fails at startup, loudly, before a single socket is
 * accepted. A deploy that will not start is a five-minute problem. A deploy
 * that starts and sends hole cards in the clear is not a problem anybody
 * notices.
 */

/** Hostnames that are a secure context without TLS, per the platform's rules. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK.has(new URL(origin).hostname);
  } catch {
    // Not a URL at all. Not loopback, and `checkOrigins` reports it separately.
    return false;
  }
}

export interface OriginProblem {
  origin: string;
  reason: string;
}

/**
 * Every origin that must not be in a production `CORS_ORIGINS`.
 *
 * Returns the problems rather than throwing, so the caller can report *all* of
 * them at once. An operator fixing a comma-separated list one error per
 * restart, against a platform whose deploys take minutes, is a genuinely
 * miserable half hour.
 */
export function checkOrigins(origins: readonly string[]): OriginProblem[] {
  const problems: OriginProblem[] = [];
  for (const origin of origins) {
    // Before the parse, because `new URL("*")` throws and the wildcard would
    // otherwise be reported as a typo. It is not a typo: it lets any site on
    // the internet open a socket to this server, and it is never valid here,
    // TLS or not.
    if (origin.trim() === "*") {
      problems.push({ origin, reason: "is a wildcard" });
      continue;
    }
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      problems.push({
        origin,
        reason: "is not a valid origin (expected e.g. https://example.com)",
      });
      continue;
    }
    if (url.protocol === "https:") continue;
    if (isLoopbackOrigin(origin)) continue;
    problems.push({
      origin,
      reason: `uses ${url.protocol}, and hole cards ride this socket`,
    });
  }
  return problems;
}

/**
 * Refuse to start a production server that would carry private state in the
 * clear.
 *
 * A throw at module load, before `listen`. The `isProduction && !livekit
 * .configured` warning in `index.ts` is the precedent for checking this class
 * of thing at startup; this one is an error rather than a warning because a
 * table with no media is a degraded product and a table with no TLS is a
 * broken promise.
 */
export function assertSecureOrigins(
  origins: readonly string[],
  production: boolean,
): void {
  if (!production) return;
  const problems = checkOrigins(origins);
  if (problems.length === 0) return;
  throw new Error(
    [
      "CORS_ORIGINS is not safe for production:",
      ...problems.map((p) => `  - "${p.origin}" ${p.reason}`),
      "",
      "Hole cards are private server state and they travel over this socket.",
      "Use https:// origins (see docs/DEPLOYMENT.md).",
    ].join("\n"),
  );
}
