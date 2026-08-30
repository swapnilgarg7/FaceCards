import { describe, expect, it, vi } from "vitest";
import {
  CLAIM_TIMEOUT_MS,
  claimTable,
  isTabMessage,
  type TabChannel,
  type TabMessage,
} from "./tabLock.js";

/**
 * A `BroadcastChannel` bus that never touches a real one.
 *
 * Delivery is synchronous, which is stricter than the platform: a real channel
 * delivers as a task on the other tab's loop. Anything that passes here with
 * synchronous delivery also passes with a delay, because the only thing the
 * protocol does with time is wait longer.
 */
function makeBus() {
  const ports: FakeChannel[] = [];

  class FakeChannel implements TabChannel {
    readonly sent: TabMessage[] = [];
    private listeners = new Set<(event: { data: unknown }) => void>();
    closed = false;

    postMessage(message: TabMessage): void {
      this.sent.push(message);
      // A real channel never echoes to the sender.
      for (const port of ports) {
        if (port !== this && !port.closed) port.deliver(message);
      }
    }

    /** Deliver something a hand-written test wants seen, malformed included. */
    deliver(data: unknown): void {
      for (const listener of [...this.listeners]) listener({ data });
    }

    addEventListener(
      _type: "message",
      listener: (event: { data: unknown }) => void,
    ): void {
      this.listeners.add(listener);
    }

    removeEventListener(
      _type: "message",
      listener: (event: { data: unknown }) => void,
    ): void {
      this.listeners.delete(listener);
    }

    close(): void {
      this.closed = true;
      this.listeners.clear();
    }
  }

  return {
    open(): FakeChannel {
      const channel = new FakeChannel();
      ports.push(channel);
      return channel;
    },
  };
}

/** A timer that fires only when a test says so. */
function manualTimers() {
  const pending: (() => void)[] = [];
  return {
    setTimer(fn: () => void) {
      pending.push(fn);
      return pending.length - 1;
    },
    clearTimer(handle: unknown) {
      pending[handle as number] = () => {};
    },
    /** Run every timer that is still armed. */
    flush() {
      const queued = [...pending];
      pending.length = 0;
      for (const fn of queued) fn();
    },
  };
}

describe("isTabMessage", () => {
  it("accepts the three kinds and nothing else", () => {
    expect(isTabMessage({ kind: "claim", code: "ABCDEF" })).toBe(true);
    expect(isTabMessage({ kind: "here", code: "ABCDEF" })).toBe(true);
    expect(isTabMessage({ kind: "release", code: "ABCDEF" })).toBe(true);
    expect(isTabMessage({ kind: "hello", code: "ABCDEF" })).toBe(false);
    expect(isTabMessage({ kind: "claim" })).toBe(false);
    expect(isTabMessage({ kind: "claim", code: "" })).toBe(false);
    expect(isTabMessage(null)).toBe(false);
    expect(isTabMessage("claim")).toBe(false);
  });
});

describe("claimTable", () => {
  it("does nothing at all without a channel", () => {
    // A browser with no BroadcastChannel must still be able to play poker.
    const conflict = vi.fn();
    const lock = claimTable({ code: "ABCDEF", onConflict: conflict, channel: null });
    expect(() => lock.release()).not.toThrow();
    expect(conflict).not.toHaveBeenCalled();
  });

  it("announces itself on open", () => {
    const bus = makeBus();
    const channel = bus.open();
    claimTable({ code: "ABCDEF", onConflict: vi.fn(), channel });
    expect(channel.sent).toEqual([{ kind: "claim", code: "ABCDEF" }]);
  });

  it("leaves a lone tab alone", () => {
    const bus = makeBus();
    const timers = manualTimers();
    const conflict = vi.fn();
    claimTable({
      code: "ABCDEF",
      onConflict: conflict,
      channel: bus.open(),
      ...timers,
    });
    timers.flush();
    expect(conflict).not.toHaveBeenCalled();
  });

  it("tells the second tab it is second, and not the first", () => {
    const bus = makeBus();
    const firstTimers = manualTimers();
    const secondTimers = manualTimers();
    const firstConflict = vi.fn();
    const secondConflict = vi.fn();

    claimTable({
      code: "ABCDEF",
      onConflict: firstConflict,
      channel: bus.open(),
      ...firstTimers,
    });
    // The first tab settles into holding the table.
    firstTimers.flush();

    claimTable({
      code: "ABCDEF",
      onConflict: secondConflict,
      channel: bus.open(),
      ...secondTimers,
    });
    secondTimers.flush();

    expect(secondConflict).toHaveBeenCalledTimes(1);
    // The asymmetry is the whole protocol: the tab that was already there must
    // not also be told it is a duplicate.
    expect(firstConflict).not.toHaveBeenCalled();
  });

  it("does not make two tabs opened in the same instant both complain", () => {
    // Neither has settled, so neither answers. Restoring a session with two
    // pinned tabs is exactly this race.
    const bus = makeBus();
    const a = manualTimers();
    const b = manualTimers();
    const aConflict = vi.fn();
    const bConflict = vi.fn();

    claimTable({ code: "ABCDEF", onConflict: aConflict, channel: bus.open(), ...a });
    claimTable({ code: "ABCDEF", onConflict: bConflict, channel: bus.open(), ...b });

    expect(aConflict).not.toHaveBeenCalled();
    expect(bConflict).not.toHaveBeenCalled();
  });

  it("ignores a tab at a different table", () => {
    const bus = makeBus();
    const timers = manualTimers();
    const conflict = vi.fn();
    claimTable({
      code: "ABCDEF",
      onConflict: conflict,
      channel: bus.open(),
      ...timers,
    });
    timers.flush();

    const otherTimers = manualTimers();
    claimTable({
      code: "ZZZZZZ",
      onConflict: vi.fn(),
      channel: bus.open(),
      ...otherTimers,
    });
    otherTimers.flush();
    expect(conflict).not.toHaveBeenCalled();
  });

  it("reports a conflict once however many tabs are open", () => {
    const bus = makeBus();
    const held = manualTimers();
    claimTable({ code: "ABCDEF", onConflict: vi.fn(), channel: bus.open(), ...held });
    held.flush();

    const second = manualTimers();
    const conflict = vi.fn();
    const channel = bus.open();
    claimTable({ code: "ABCDEF", onConflict: conflict, channel, ...second });
    second.flush();
    // A third tab arrives; the second one hears its claim but must not raise a
    // second warning about a situation it is already showing.
    const third = manualTimers();
    claimTable({ code: "ABCDEF", onConflict: vi.fn(), channel: bus.open(), ...third });
    third.flush();

    expect(conflict).toHaveBeenCalledTimes(1);
  });

  it("stands the warning down when the other tab closes", () => {
    const bus = makeBus();
    const firstTimers = manualTimers();
    const first = claimTable({
      code: "ABCDEF",
      onConflict: vi.fn(),
      channel: bus.open(),
      ...firstTimers,
    });
    firstTimers.flush();

    const resolved = vi.fn();
    const secondTimers = manualTimers();
    const conflict = vi.fn();
    claimTable({
      code: "ABCDEF",
      onConflict: conflict,
      onResolved: resolved,
      channel: bus.open(),
      ...secondTimers,
    });
    secondTimers.flush();
    expect(conflict).toHaveBeenCalledTimes(1);

    // The common ending: somebody sees the warning and closes the duplicate.
    first.release();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it("does not announce a release it never held", () => {
    // A duplicate tab closing has freed nothing, and saying otherwise hands
    // the table to a tab that is still showing a warning about it.
    const bus = makeBus();
    const firstTimers = manualTimers();
    claimTable({
      code: "ABCDEF",
      onConflict: vi.fn(),
      channel: bus.open(),
      ...firstTimers,
    });
    firstTimers.flush();

    const channel = bus.open();
    const secondTimers = manualTimers();
    const second = claimTable({
      code: "ABCDEF",
      onConflict: vi.fn(),
      channel,
      ...secondTimers,
    });
    secondTimers.flush();
    second.release();

    expect(channel.sent).toEqual([{ kind: "claim", code: "ABCDEF" }]);
  });

  it("stops answering once released, so a rejoin does not conflict with itself", () => {
    const bus = makeBus();
    const timers = manualTimers();
    const lock = claimTable({
      code: "ABCDEF",
      onConflict: vi.fn(),
      channel: bus.open(),
      ...timers,
    });
    timers.flush();
    lock.release();

    const rejoinTimers = manualTimers();
    const conflict = vi.fn();
    claimTable({
      code: "ABCDEF",
      onConflict: conflict,
      channel: bus.open(),
      ...rejoinTimers,
    });
    rejoinTimers.flush();
    expect(conflict).not.toHaveBeenCalled();
  });

  it("survives a malformed message from a tab on another build", () => {
    const bus = makeBus();
    const channel = bus.open();
    const timers = manualTimers();
    const conflict = vi.fn();
    claimTable({
      code: "ABCDEF",
      onConflict: conflict,
      channel,
      ...timers,
    });
    for (const junk of [null, "here", { kind: "here" }, { code: "ABCDEF" }]) {
      expect(() => channel.deliver(junk)).not.toThrow();
    }
    expect(conflict).not.toHaveBeenCalled();
  });

  it("closes the channel on release", () => {
    const bus = makeBus();
    const channel = bus.open();
    claimTable({ code: "ABCDEF", onConflict: vi.fn(), channel }).release();
    expect(channel.closed).toBe(true);
  });

  it("waits long enough for a busy tab to answer", () => {
    // Set by how long a tab decoding eight video streams takes to service its
    // event loop, not by how long a quiet one does.
    expect(CLAIM_TIMEOUT_MS).toBeGreaterThanOrEqual(200);
    // And short enough that the warning arrives while somebody is still
    // looking at the screen they just opened.
    expect(CLAIM_TIMEOUT_MS).toBeLessThanOrEqual(1_000);
  });
});
