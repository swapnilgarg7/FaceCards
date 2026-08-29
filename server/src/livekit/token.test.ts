import { beforeAll, describe, expect, it } from "vitest";

const API_KEY = "test-api-key";
const API_SECRET = "test-api-secret-that-is-long-enough-to-sign";

// config.ts snapshots process.env at import time, so the environment has to be
// in place before the module graph is loaded.
process.env["LIVEKIT_API_KEY"] = API_KEY;
process.env["LIVEKIT_API_SECRET"] = API_SECRET;
process.env["LIVEKIT_URL"] = "ws://localhost:7880";

type TokenModule = typeof import("./token.js");
let mintMediaToken: TokenModule["mintMediaToken"];
let mediaRoomName: TokenModule["mediaRoomName"];

beforeAll(async () => {
  ({ mintMediaToken, mediaRoomName } = await import("./token.js"));
});

/** Decode a JWT payload without verifying. Enough to inspect the grants. */
function payloadOf(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("mintMediaToken", () => {
  it("mints a token scoped to one room and one identity", async () => {
    const result = await mintMediaToken({
      roomCode: "ABC234",
      identity: "session-xyz",
      displayName: "Swapnil",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.identity).toBe("session-xyz");
    expect(result.room).toBe(mediaRoomName("ABC234"));

    const payload = payloadOf(result.token);
    expect(payload["sub"]).toBe("session-xyz");

    const video = payload["video"] as Record<string, unknown>;
    expect(video["roomJoin"]).toBe(true);
    expect(video["room"]).toBe("facecards-ABC234");
    expect(video["canPublish"]).toBe(true);
    expect(video["canSubscribe"]).toBe(true);
  });

  it("grants nothing beyond joining that one room", async () => {
    const result = await mintMediaToken({
      roomCode: "ABC234",
      identity: "session-xyz",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const video = payloadOf(result.token)["video"] as Record<string, unknown>;
    // A leaked token should be worth one seat at one table and nothing else.
    for (const admin of ["roomCreate", "roomList", "roomAdmin", "roomRecord"]) {
      expect(video[admin]).toBeFalsy();
    }
    // Game data travels the authoritative socket. If the media channel could
    // carry it, the server would stop being the only source of truth.
    expect(video["canPublishData"]).toBe(false);
  });

  it("never puts the API secret in the token", async () => {
    const result = await mintMediaToken({
      roomCode: "ABC234",
      identity: "session-xyz",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.token).not.toContain(API_SECRET);
    expect(JSON.stringify(result)).not.toContain(API_SECRET);
    // The key names the credential rather than proving it, but it has no
    // business reaching the browser either.
    expect(JSON.stringify(payloadOf(result.token))).not.toContain(API_SECRET);
  });

  it("uses the identity it was given, not the display name", async () => {
    // The room passes client.sessionId here. If display name ever leaked into
    // identity, two players could claim the same media participant.
    const result = await mintMediaToken({
      roomCode: "ABC234",
      identity: "session-1",
      displayName: "session-2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(payloadOf(result.token)["sub"]).toBe("session-1");
  });

  it("separates rooms by code", () => {
    expect(mediaRoomName("ABC234")).not.toBe(mediaRoomName("ABC235"));
  });
});
