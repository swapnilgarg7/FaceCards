import { describe, expect, it } from "vitest";
import { describeDisconnect, explainDisconnect } from "./disconnectReason.js";

describe("the failure a player actually hit", () => {
  it("explains a seat reservation that expired instead of quoting Colyseus", () => {
    // The reported bug, verbatim: two people in a room, and one of them was
    // shown "seat reservation expired. (524)" and dropped back to the lobby.
    // 524 is MATCHMAKE_EXPIRED, sent as a Protocol.ERROR frame when a
    // reconnecting socket finds no room and no reserved seat.
    const said = explainDisconnect(524, "seat reservation expired.");
    expect(said).not.toBeNull();
    expect(said).not.toMatch(/reservation/i);
    expect(said).not.toMatch(/524/);
    // The part that matters and that the old message never said: the chips
    // are gone too, so rejoining is a new seat rather than a resumed one.
    expect(said).toMatch(/fresh/i);
  });

  it("says the same thing when the retry ladder runs out", () => {
    // Close code 4003. Different callback, different number space, same
    // situation for the person reading it.
    expect(explainDisconnect(4003, "No more retries. Reconnection failed.")).toBe(
      explainDisconnect(524, "seat reservation expired."),
    );
  });
});

describe("disconnections that are not incidents", () => {
  it("says nothing when the player left on purpose", () => {
    // `leave()` closes with CONSENTED. Explaining it would put an error on
    // screen every time somebody used the Leave button.
    expect(explainDisconnect(4000)).toBeNull();
    expect(explainDisconnect(1000)).toBeNull();
  });
});

describe("the rest of the table", () => {
  it("points a stale invite link at getting a new one", () => {
    for (const code of [521, 522]) {
      expect(explainDisconnect(code)).toMatch(/invite/i);
    }
  });

  it("passes an application error through, because it is already a sentence", () => {
    // This is how "Table is full" reaches a player.
    expect(explainDisconnect(526, "Table is full")).toBe("Table is full");
  });

  it("falls back to its own words when the server sent none", () => {
    expect(explainDisconnect(526, "   ")).toMatch(/refused the seat/i);
    expect(explainDisconnect(526)).toMatch(/refused the seat/i);
  });

  it("distinguishes a drop before the session was established", () => {
    // 1006 with no reconnection attempted: the SDK's `minUptime` means a
    // socket that dies in the first five seconds is never retried.
    expect(explainDisconnect(1006)).toMatch(/before the table finished/i);
  });

  it("still says something for a code it has never seen", () => {
    const said = explainDisconnect(4999);
    expect(said).not.toBeNull();
    expect(said).toMatch(/closed unexpectedly/i);
  });
});

describe("evidence for the console", () => {
  it("keeps the raw pair a diagnosis needs", () => {
    // The whole reason this exists: the first report of this bug arrived as a
    // screenshot of a string the client had already discarded the code from.
    const line = describeDisconnect("error", 524, "seat reservation expired.");
    expect(line).toContain("code=524");
    expect(line).toContain("seat reservation expired.");
    expect(line).toContain("error");
  });

  it("survives a missing reason", () => {
    expect(describeDisconnect("leave", 4003)).toContain('reason=""');
  });
});
