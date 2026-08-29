import { httpUrl } from "./endpoints.js";

/**
 * Waking a sleeping server, and saying so.
 *
 * The free Render instance the game server runs on spins down after 15 minutes
 * without traffic and takes roughly a minute to come back (docs/DEPLOYMENT.md).
 * From the browser that minute is indistinguishable from a broken site: the
 * fetch simply does not answer. Render holds the request open while the
 * instance boots rather than refusing it, so there is no error to show and no
 * event to react to - just silence, for about as long as a person is willing
 * to wait before deciding an app is dead.
 *
 * So the client says what is happening. Not because the wait can be made
 * shorter, but because a narrated wait is a wait and an unexplained one is a
 * bug.
 *
 * Two decisions shape everything here:
 *
 * The probe runs when the lobby *mounts*, not when someone clicks. Booting the
 * server costs a minute either way, and the lobby is where a person spends
 * thirty seconds typing a name, picking an avatar and answering the camera
 * prompt. Spending the boot behind that is most of the wait for free.
 *
 * Nothing is torn down or blocked while it runs. This module never rejects a
 * click, cancels media, or unmounts anything: the lobby stays fully usable and
 * `ensureAwake()` simply resolves late. A create or join issued during a wake
 * queues behind it and then proceeds.
 */

/** What Render's docs promise for a spin-up. An estimate, never a deadline. */
export const WAKE_ESTIMATE_MS = 60_000;

/**
 * Say nothing below this. An awake server answers in tens of milliseconds, and
 * a progress bar that flashes up on every page load would be its own bug.
 */
const QUIET_MS = 1_200;

/** Longer than a cold start, so a held-open request is not abandoned early. */
const PROBE_TIMEOUT_MS = 30_000;
const RETRY_MS = 1_500;
/** Past the estimate, stop hammering: something other than a cold start is up. */
const SLOW_RETRY_MS = 4_000;
const GIVE_UP_MS = 4 * 60_000;
/** How long a successful probe is believed before probing again. */
const TRUST_AWAKE_MS = 2 * 60_000;
const TICK_MS = 200;

export type WakeStatus =
  | { kind: "idle" }
  | {
      kind: "waking";
      elapsedMs: number;
      estimateMs: number;
      /** 0..1 for the bar. Never reaches 1 while still waiting. */
      fraction: number;
      /** Past the estimate and still going. */
      overdue: boolean;
    }
  | { kind: "failed"; message: string };

/**
 * How full the bar is after `elapsedMs`.
 *
 * Pure, and the only part of this file worth a test.
 *
 * It reaches 0.9 at the estimate and then creeps asymptotically, so it is
 * always moving and never arrives. A bar that hits 100% and sits there is a
 * lie that reads as a freeze, which is the exact impression this whole module
 * exists to prevent.
 */
export function wakeFraction(
  elapsedMs: number,
  estimateMs: number = WAKE_ESTIMATE_MS,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (!Number.isFinite(estimateMs) || estimateMs <= 0) return 0;
  if (elapsedMs < estimateMs) return (elapsedMs / estimateMs) * 0.9;
  const over = (elapsedMs - estimateMs) / estimateMs;
  return 0.9 + 0.099 * (1 - Math.exp(-over));
}

/** Whole seconds still expected, floored at zero. For the "~40s" label. */
export function wakeSecondsLeft(
  elapsedMs: number,
  estimateMs: number = WAKE_ESTIMATE_MS,
): number {
  return Math.max(0, Math.ceil((estimateMs - elapsedMs) / 1000));
}

type Listener = (status: WakeStatus) => void;

const listeners = new Set<Listener>();
let current: WakeStatus = { kind: "idle" };
let inFlight: Promise<void> | null = null;
let trustedUntil = 0;

function set(next: WakeStatus): void {
  current = next;
  for (const listener of [...listeners]) listener(next);
}

export function wakeStatus(): WakeStatus {
  return current;
}

export function subscribeWake(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One probe. Every failure mode of a cold start looks the same from here - a
 * refused connection, a 502 from Render's router, or a request held open past
 * the timeout - and all of them mean the same thing: not yet, ask again.
 */
async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${httpUrl}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  const startedAt = Date.now();
  set({ kind: "idle" });

  const ticker = setInterval(() => {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < QUIET_MS) return;
    set({
      kind: "waking",
      elapsedMs,
      estimateMs: WAKE_ESTIMATE_MS,
      fraction: wakeFraction(elapsedMs),
      overdue: elapsedMs > WAKE_ESTIMATE_MS,
    });
  }, TICK_MS);

  try {
    for (;;) {
      if (await probe()) {
        trustedUntil = Date.now() + TRUST_AWAKE_MS;
        set({ kind: "idle" });
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed > GIVE_UP_MS) {
        const message =
          "The table server is not answering. It may be restarting - " +
          "try again in a moment.";
        set({ kind: "failed", message });
        throw new Error(message);
      }
      await sleep(elapsed > WAKE_ESTIMATE_MS ? SLOW_RETRY_MS : RETRY_MS);
    }
  } finally {
    clearInterval(ticker);
  }
}

/**
 * Resolve once the server has answered, however long that takes.
 *
 * Concurrent callers share one wake: the lobby's probe on mount and the click
 * that follows it are the same wait, not two.
 */
export function ensureAwake(): Promise<void> {
  if (Date.now() < trustedUntil) return Promise.resolve();
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
