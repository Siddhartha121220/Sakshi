// The repo is public, so the anonymous endpoints are easy to script against. These pin the per-IP limits,
// including behind a proxy (Render), where every request arrives from the proxy's address and the real
// client is in X-Forwarded-For.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppContext } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";

function appWith(overrides: Record<string, string>): FastifyInstance {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://unused",
    CHAIN_ID: "31337",
    RPC_URL: "http://127.0.0.1:1",
    SAKSHI_ANCHOR_CONTRACT: "0x" + "00".repeat(20),
    SERVER_CHALLENGE_SECRET: "test-secret-at-least-16-bytes",
    LOG_LEVEL: "silent",
    ...overrides,
  });
  // Only routes that never touch the DB or chain are exercised here, so those can be inert stand-ins.
  const ctx = { config, logger: createLogger(config), sql: {}, chainReader: {}, publicClient: {} } as unknown as AppContext;
  return buildApp(ctx);
}

const challenge = (app: FastifyInstance, ip?: string) =>
  app.inject({ method: "POST", url: "/v1/devices/challenge", headers: ip ? { "x-forwarded-for": ip } : {} });

describe("rate limiting", () => {
  let direct: FastifyInstance;
  let proxied: FastifyInstance;
  beforeAll(async () => {
    direct = appWith({ RATE_LIMIT_PER_MINUTE: "3" });
    proxied = appWith({ RATE_LIMIT_PER_MINUTE: "3", TRUST_PROXY: "1" });
    await Promise.all([direct.ready(), proxied.ready()]);
  });
  afterAll(async () => {
    await Promise.all([direct.close(), proxied.close()]);
  });

  it("answers 429 RATE_LIMITED once a client goes over the per-minute limit", async () => {
    for (let i = 0; i < 3; i++) expect((await challenge(direct)).statusCode).toBe(200);
    const over = await challenge(direct);
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe("RATE_LIMITED");
  });

  it("a forged X-Forwarded-For can't buy a fresh limit: only the address the proxy appended counts", async () => {
    // The client sends "fake-N, <real ip>"; the proxy appends the real address last. With one trusted hop,
    // only that rightmost entry is used, so rotating the forged part changes nothing.
    for (let i = 0; i < 3; i++) expect((await challenge(proxied, `10.9.9.${i}, 192.0.2.50`)).statusCode).toBe(200);
    expect((await challenge(proxied, "10.9.9.99, 192.0.2.50")).statusCode).toBe(429);
  });

  it("behind a proxy, limits each real client separately instead of everyone sharing the proxy's IP", async () => {
    for (let i = 0; i < 3; i++) expect((await challenge(proxied, "203.0.113.7")).statusCode).toBe(200);
    expect((await challenge(proxied, "203.0.113.7")).statusCode).toBe(429);
    expect((await challenge(proxied, "198.51.100.9")).statusCode).toBe(200); // a different visitor is unaffected
  });
});

describe("malformed requests are client errors, not 500s", () => {
  it("invalid JSON body -> 400", async () => {
    const app = appWith({});
    const res = await app.inject({ method: "POST", url: "/v1/verification-events", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("root", () => {
  it("GET / describes the service instead of 404ing", async () => {
    const app = appWith({});
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ service: "Sakshi API", health: "/healthz", chainId: 31337 });
    await app.close();
  });
});

describe("capture ids", () => {
  it("a non-UUID id is a 404, not a 500 from the database's uuid cast", async () => {
    const app = appWith({});
    for (const url of ["/v1/captures/not-a-uuid", "/v1/captures/not-a-uuid/status", "/v1/captures/1;drop/status"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    }
    await app.close();
  });
});
