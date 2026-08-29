import { describe, expect, it } from "vitest";
import { createFaceBoxStore } from "./faceBoxStore.js";
import type { FaceBox } from "./faceBox.js";

const box: FaceBox = { cx: 0.5, cy: 0.4, h: 0.3 };
const moved: FaceBox = { cx: 0.7, cy: 0.4, h: 0.3 };

/** A store on a clock the test drives, so staleness is testable without waiting. */
function storeWithClock() {
  let now = 0;
  const store = createFaceBoxStore(() => now);
  return { store, advance: (ms: number) => (now += ms) };
}

describe("faceBoxStore", () => {
  it("has nothing for a peer that has never sent", () => {
    const { store } = storeWithClock();
    expect(store.get("nobody")).toBeNull();
  });

  it("returns the latest box for a peer", () => {
    const { store } = storeWithClock();
    store.receive("a", box);
    store.receive("a", moved);
    expect(store.get("a")).toEqual(moved);
  });

  it("keeps the last framing while a peer's face is out of shot", () => {
    // Someone leans out of frame to pick something up. Their avatar should
    // hold the framing they left, so they return to where they were rather
    // than sliding back into place.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(100);
    store.receive("a", null);
    expect(store.get("a")).toEqual(box);
  });

  it("keeps holding across a long absence, as long as the tracker is alive", () => {
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    for (let i = 0; i < 100; i += 1) {
      advance(100);
      store.receive("a", null);
    }
    expect(store.get("a")).toEqual(box);
  });

  it("holds the framing of a peer who has gone silent, rather than expiring it", () => {
    // A browser stops rAF and rVFC in a tab that is not visible, so any player
    // who switches tabs stops publishing immediately. Expiring here meant
    // everyone watched their face snap off-centre a couple of seconds after
    // they looked away. The held box was measured against a real face; the
    // fixed crop it would fall back to is a guess that was never right for
    // anyone, so falling back is a downgrade, and a visible one.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(60 * 60 * 1000);
    expect(store.get("a")).toEqual(box);
  });

  it("tolerates a few dropped datagrams without falling back", () => {
    // The channel is lossy by design, so a gap of several publish intervals
    // must not read as a dead tracker.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(600);
    expect(store.get("a")).toEqual(box);
  });

  it("picks straight back up when a silent peer starts publishing again", () => {
    // Coming back from another tab. The framing they left is still on screen,
    // so the new box eases in from there rather than snapping in from a
    // fallback crop.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(9000);
    expect(store.get("a")).toEqual(box);
    store.receive("a", moved);
    expect(store.get("a")).toEqual(moved);
  });

  it("keeps peers apart", () => {
    const { store } = storeWithClock();
    store.receive("a", box);
    store.receive("b", moved);
    expect(store.get("a")).toEqual(box);
    expect(store.get("b")).toEqual(moved);
  });

  it("forgets a peer who left, so a rejoin does not inherit old framing", () => {
    const { store } = storeWithClock();
    store.receive("a", box);
    store.forget("a");
    expect(store.get("a")).toBeNull();
  });

  it("clears everything on disconnect", () => {
    const { store } = storeWithClock();
    store.receive("a", box);
    store.receive("b", box);
    store.clear();
    expect(store.get("a")).toBeNull();
    expect(store.get("b")).toBeNull();
  });
});
