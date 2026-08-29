import { DEFAULT_CLIENT_PORT, DEFAULT_SERVER_PORT } from "@facecards/shared";

/**
 * Environment, read once and validated once, so no other module has to guess
 * whether `process.env.X` is set, a string, or an empty string.
 */

function str(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be a valid port, got "${raw}"`);
  }
  return parsed;
}

function list(name: string, fallback: string[]): string[] {
  const raw = str(name);
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const livekitApiKey = str("LIVEKIT_API_KEY");
const livekitApiSecret = str("LIVEKIT_API_SECRET");
const livekitUrl = str("LIVEKIT_URL");

/**
 * Media config is present only when all three values are set. Partially
 * configured is treated as unconfigured on purpose: a half-set env is the
 * state that produces a confusing runtime failure three layers down.
 */
export const livekit =
  livekitApiKey && livekitApiSecret && livekitUrl
    ? {
        configured: true as const,
        apiKey: livekitApiKey,
        apiSecret: livekitApiSecret,
        url: livekitUrl,
      }
    : { configured: false as const };

export const config = {
  port: int("PORT", DEFAULT_SERVER_PORT),
  nodeEnv: str("NODE_ENV") ?? "development",
  /** Browser origins allowed to reach the HTTP API and the WebSocket. */
  corsOrigins: list("CORS_ORIGINS", [
    `http://localhost:${DEFAULT_CLIENT_PORT}`,
    `http://127.0.0.1:${DEFAULT_CLIENT_PORT}`,
  ]),
  livekit,
} as const;

export const isProduction = config.nodeEnv === "production";
