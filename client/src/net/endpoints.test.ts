import { describe, expect, it } from "vitest";
import { checkEndpoints } from "./endpoints.js";

/**
 * Only the pure half is exercised. Importing this module runs the assertion
 * against whatever Vite baked in, which under vitest is a development build
 * pointed at localhost - so the import itself is also the "does not throw in
 * development" case, and it has already happened by the time this file runs.
 */
describe("checkEndpoints", () => {
  it("says nothing in a development build", () => {
    // `npm run dev` is http://localhost, and it has to stay that way.
    expect(
      checkEndpoints("http://localhost:2567", "ws://localhost:2567", false),
    ).toBeNull();
  });

  it("says nothing about a correct production deploy", () => {
    expect(
      checkEndpoints(
        "https://facecards-server.onrender.com",
        "wss://facecards-server.onrender.com",
        true,
      ),
    ).toBeNull();
  });

  it("catches a production build shipped with the dev defaults", () => {
    // The realistic version of this bug: a Cloudflare Pages build with the
    // VITE_ variables unset, so both fall through to localhost - except
    // localhost is exempt, so the *actual* realistic version is the one below.
    const message = checkEndpoints(
      "http://facecards-server.onrender.com",
      "ws://facecards-server.onrender.com",
      true,
    );
    expect(message).toContain("not encrypted");
    expect(message).toContain("Hole cards");
  });

  it("catches either half on its own", () => {
    // The half that matters most is the socket: the HTTP API only carries room
    // codes, and the WebSocket carries the cards.
    expect(
      checkEndpoints(
        "https://facecards.example",
        "ws://facecards.example",
        true,
      ),
    ).toContain("ws://facecards.example");
    expect(
      checkEndpoints(
        "http://facecards.example",
        "wss://facecards.example",
        true,
      ),
    ).toContain("http://facecards.example");
  });

  it("names both when both are wrong, rather than one per rebuild", () => {
    const message = checkEndpoints(
      "http://a.example",
      "ws://b.example",
      true,
    );
    expect(message).toContain("a.example");
    expect(message).toContain("b.example");
  });

  it("lets a production build run against loopback", () => {
    expect(
      checkEndpoints("http://localhost:2567", "ws://127.0.0.1:2567", true),
    ).toBeNull();
  });

  it("does not treat a LAN address as loopback", () => {
    // A bare LAN IP is not a secure context, which is the trap this whole
    // area exists around.
    expect(
      checkEndpoints("http://192.168.1.10:2567", "ws://192.168.1.10:2567", true),
    ).not.toBeNull();
  });

  it("does not accept a hostname that merely starts with localhost", () => {
    expect(
      checkEndpoints(
        "http://localhost.evil.example",
        "ws://localhost.evil.example",
        true,
      ),
    ).not.toBeNull();
  });
});
