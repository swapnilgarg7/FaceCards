/**
 * One seat per browser, per table.
 *
 * The phase-6 list names "same room in two tabs" as a network edge case, and
 * it is a nastier one than it sounds. Nothing on the server is wrong: two tabs
 * are two Colyseus sessions, so they get two seats, two stacks and two sets of
 * hole cards, all correctly private from each other. The damage is entirely on
 * this side of the wire, and it is severe:
 *
 *  - Both tabs publish a camera and a microphone from the *same devices*, so
 *    the table hears the person twice, half a second apart, and their own
 *    speakers feed one of their microphones. This is the loudest failure in
 *    the product and the hardest to diagnose from inside it.
 *  - Two seats out of the six or eight are held by one person, who can only
 *    act in one of them, so the other times out every hand and eventually gets
 *    sat out by the server.
 *  - The background tab is throttled by the browser - `requestAnimationFrame`
 *    and `requestVideoFrameCallback` both stop - so it looks like the app has
 *    frozen, which is what people report rather than what actually happened.
 *
 * The fix cannot live on the server, because the server has no way to tell two
 * tabs of one browser from two laptops in one room, and *that* case is the
 * product working exactly as intended. What the browser does have is
 * `BroadcastChannel`, which is same-origin and reaches every tab of this site
 * and nothing else. So the tabs settle it among themselves.
 *
 * The protocol is deliberately the smallest thing that works, and it is
 * **advisory**: it reports a conflict and lets the UI say so. It does not
 * close the socket or force anybody out, because a stale claim from a tab that
 * crashed must never be able to lock a person out of their own table, and a
 * heartbeat-with-expiry scheme that could avoid that is a great deal of
 * machinery for a warning.
 *
 *   claim  -> "I am at table ABCDEF"      (broadcast on join)
 *   here   -> "so am I, and I was first"  (the answer any existing holder sends)
 *   release-> "I have left"               (broadcast on leave)
 *
 * A joining tab broadcasts `claim` and waits. If any other tab answers `here`,
 * this one is the duplicate. Silence means it is alone. The asymmetry is what
 * makes it correct without timestamps: only a tab that is *already* in the
 * room answers, so the second tab to arrive is always the one that learns it
 * is second.
 *
 * `BroadcastChannel` is injected rather than constructed, which is what lets
 * the whole handshake be tested against a pair of fake channels. It is also
 * absent in some browsers and in every test DOM, and a missing channel simply
 * means the check does not run - a product that refuses to start a poker game
 * because it could not open a diagnostic channel would be a worse bug than the
 * one this file is about.
 */

/** The wire format. Kept to two fields so it can never need a version. */
export interface TabMessage {
  kind: "claim" | "here" | "release";
  /** The room code being claimed. Claims for other tables are ignored. */
  code: string;
}

export function isTabMessage(value: unknown): value is TabMessage {
  if (!value || typeof value !== "object") return false;
  const { kind, code } = value as Partial<TabMessage>;
  return (
    (kind === "claim" || kind === "here" || kind === "release") &&
    typeof code === "string" &&
    code.length > 0
  );
}

/**
 * The part of `BroadcastChannel` this uses. Narrow on purpose: it is the whole
 * of the seam, and a fake that implements three members is a fake nobody has
 * to maintain.
 */
export interface TabChannel {
  postMessage(message: TabMessage): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  close(): void;
}

/**
 * How long a joining tab waits for an existing one to answer.
 *
 * `BroadcastChannel` delivery is a task on the other tab's event loop, so this
 * has to outlast one turn of a loop that may be busy decoding video - but it
 * is also dead time before a warning can appear, and the warning is only
 * useful while somebody is still looking at the screen they just opened. A
 * quarter of a second is several event-loop turns and is imperceptible.
 *
 * Overshooting is safe in one direction only: too short reports "alone" for a
 * tab that is not, which is the failure this file exists to prevent, so the
 * value is set by how long a *busy* tab takes to answer rather than by how
 * long a quiet one does.
 */
export const CLAIM_TIMEOUT_MS = 250;

export interface TabLock {
  /** Stop answering, and tell the other tabs the seat is free. */
  release(): void;
}

export interface TabLockOptions {
  code: string;
  /** Called if another tab of this browser is already at this table. */
  onConflict(): void;
  /**
   * Called when the *other* tab lets go, so a warning can be taken down
   * without a reload. The common ending: somebody sees the warning and closes
   * the duplicate.
   */
  onResolved?(): void;
  /** The channel. Null disables the check entirely. */
  channel: TabChannel | null;
  /** Injected so a test does not sleep. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

/**
 * Claim `code` for this tab, and watch for anyone else claiming it.
 *
 * Returns a lock whose `release()` must be called on leaving the room -
 * otherwise this tab goes on answering `here` to its own next join and reports
 * a conflict with itself, which is a genuinely confusing thing to debug.
 */
export function claimTable(options: TabLockOptions): TabLock {
  const {
    code,
    onConflict,
    onResolved,
    channel,
    setTimer = (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer = (handle: unknown) => clearTimeout(handle as number),
  } = options;

  if (!channel) return { release() {} };

  let released = false;
  /** Whether this tab believes it is the one holding the table. */
  let holding = false;
  let conflicted = false;

  const listener = (event: { data: unknown }): void => {
    const message = event.data;
    // Anything malformed is a tab on a different build, and the answer to that
    // is to carry on rather than to guess at what it meant.
    if (released || !isTabMessage(message) || message.code !== code) return;

    switch (message.kind) {
      case "claim":
        // Only answer if we actually hold the table. A tab that is itself
        // still waiting for its own claim to time out must stay quiet, or two
        // tabs opened in the same instant each tell the other it was second
        // and both show a warning.
        if (holding) channel.postMessage({ kind: "here", code });
        return;

      case "here":
        // Somebody was here first. Report it once: a table with three tabs
        // open would otherwise fire this twice for one arrival.
        if (!conflicted) {
          conflicted = true;
          onConflict();
        }
        return;

      case "release":
        // The other tab has gone. Take over the claim, so a third tab opened
        // later still meets a holder, and tell the UI it can stand down.
        if (conflicted) {
          conflicted = false;
          holding = true;
          onResolved?.();
        }
        return;
    }
  };

  channel.addEventListener("message", listener);
  channel.postMessage({ kind: "claim", code });

  // Nobody answered, so this tab holds the table. Set *after* the wait rather
  // than optimistically, which is the asymmetry the whole protocol rests on.
  const timer = setTimer(() => {
    if (!released && !conflicted) holding = true;
  }, CLAIM_TIMEOUT_MS);

  return {
    release() {
      if (released) return;
      released = true;
      clearTimer(timer);
      channel.removeEventListener("message", listener);
      // Only a holder announces a release. A duplicate tab closing has not
      // freed anything, and saying so would hand the table to a tab that is
      // still showing a warning about it.
      if (holding) channel.postMessage({ kind: "release", code });
      channel.close();
    },
  };
}

/**
 * The real channel, or null where the browser has no `BroadcastChannel` and in
 * any environment without a window.
 */
export function openTabChannel(name: string): TabChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(name) as unknown as TabChannel;
  } catch {
    // Thrown in at least one browser when site data is blocked entirely. A
    // failed diagnostic must never stop a game from starting.
    return null;
  }
}
