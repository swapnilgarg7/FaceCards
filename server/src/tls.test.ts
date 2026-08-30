import { describe, expect, it } from "vitest";
import { assertSecureOrigins, checkOrigins, isLoopbackOrigin } from "./tls.js";

describe("isLoopbackOrigin", () => {
  it("knows the hostnames that are a secure context without TLS", () => {
    expect(isLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isLoopbackOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:5173")).toBe(true);
  });

  it("does not extend that to a LAN address", () => {
    // The trap this whole area exists around: a bare LAN IP is *not* a secure
    // context, so `getUserMedia` is absent there even though it works on
    // localhost. It must not be treated as loopback.
    expect(isLoopbackOrigin("http://192.168.1.10:5173")).toBe(false);
    expect(isLoopbackOrigin("http://10.0.0.4:5173")).toBe(false);
  });

  it("does not match a hostname that merely contains localhost", () => {
    expect(isLoopbackOrigin("http://localhost.evil.example")).toBe(false);
    expect(isLoopbackOrigin("http://notlocalhost")).toBe(false);
  });

  it("says no rather than throwing on nonsense", () => {
    expect(isLoopbackOrigin("not a url")).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
  });
});

describe("checkOrigins", () => {
  it("passes a real production deploy", () => {
    expect(
      checkOrigins(["https://facecards.pages.dev", "https://facecards.example"]),
    ).toEqual([]);
  });

  it("catches the plaintext origin that made this file necessary", () => {
    const problems = checkOrigins(["http://facecards.pages.dev"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.origin).toBe("http://facecards.pages.dev");
    expect(problems[0]?.reason).toContain("hole cards");
  });

  it("lets a production build run against loopback", () => {
    // Reproducing something locally with NODE_ENV=production is a real thing
    // people do, and refusing would push them into unsetting it, which turns
    // off more than this check.
    expect(checkOrigins(["http://localhost:5173"])).toEqual([]);
    expect(checkOrigins(["http://127.0.0.1:5173"])).toEqual([]);
  });

  it("rejects a wildcard whatever its scheme", () => {
    expect(checkOrigins(["*"])[0]?.reason).toContain("wildcard");
  });

  it("rejects something that is not an origin at all", () => {
    // A comma-separated list typed with a stray space, or a bare hostname.
    expect(checkOrigins(["facecards.pages.dev"])[0]?.reason).toContain(
      "not a valid origin",
    );
  });

  it("reports every problem at once", () => {
    // One error per restart against a platform whose deploys take minutes is a
    // genuinely miserable half hour.
    const problems = checkOrigins([
      "https://good.example",
      "http://bad.example",
      "ws://worse.example",
      "nonsense",
    ]);
    expect(problems.map((p) => p.origin)).toEqual([
      "http://bad.example",
      "ws://worse.example",
      "nonsense",
    ]);
  });

  it("catches a socket scheme dropped into the origin list", () => {
    expect(checkOrigins(["ws://facecards.example"])[0]?.reason).toContain("ws:");
  });
});

describe("assertSecureOrigins", () => {
  it("says nothing outside production", () => {
    // The dev stack is http://localhost, and requiring certificates to run it
    // would be a tax paid daily against a mistake made once, in a dashboard.
    expect(() =>
      assertSecureOrigins(["http://192.168.1.10:5173"], false),
    ).not.toThrow();
  });

  it("throws in production, and names what is wrong", () => {
    expect(() =>
      assertSecureOrigins(["http://facecards.pages.dev"], true),
    ).toThrow(/CORS_ORIGINS/);
    expect(() =>
      assertSecureOrigins(["http://facecards.pages.dev"], true),
    ).toThrow(/facecards\.pages\.dev/);
  });

  it("is quiet on a correct production config", () => {
    expect(() =>
      assertSecureOrigins(["https://facecards.pages.dev"], true),
    ).not.toThrow();
  });

  it("is quiet on an empty list rather than inventing a failure", () => {
    // An empty list is a server nobody can reach, which is a different problem
    // and not this file's to report.
    expect(() => assertSecureOrigins([], true)).not.toThrow();
  });
});
