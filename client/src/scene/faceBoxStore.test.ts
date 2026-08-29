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

  it("expires a peer whose tracker has gone silent", () => {
    // Not the same thing as seeing no face. Silence means no tracker at all,
    // and the right answer is the fixed crop, not a frozen box from a minute
    // ago that no longer describes where they are sitting.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(1000);
    expect(store.get("a")).toEqual(box);
    advance(5000);
    expect(store.get("a")).toBeNull();
  });

  it("tolerates a few dropped datagrams without falling back", () => {
    // The channel is lossy by design, so a gap of several publish intervals
    // must not read as a dead tracker.
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(600);
    expect(store.get("a")).toEqual(box);
  });

  it("recovers after expiring, once the peer speaks again", () => {
    const { store, advance } = storeWithClock();
    store.receive("a", box);
    advance(9000);
    expect(store.get("a")).toBeNull();
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
