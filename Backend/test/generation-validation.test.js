import test from "node:test";
import assert from "node:assert/strict";
import { readEnv } from "../src/env.js";
import { redactSecrets, redactUrl } from "../src/lib/redact.js";
import { isValidJobId, validateGenerationRequest } from "../src/jobs/generationValidation.js";

test("validates and normalizes generation request options", () => {
  const request = validateGenerationRequest(
    { prompt: "  Draw a tree  ", metadata: { style: "ink" }, priority: 2, delayMs: 100 },
    "request-123",
  );

  assert.deepEqual(request, {
    input: { prompt: "Draw a tree", metadata: { style: "ink" } },
    priority: 2,
    delayMs: 100,
    idempotencyKey: "request-123",
  });
});

test("rejects malformed, oversized, and secret-bearing generation requests", () => {
  assert.throws(() => validateGenerationRequest(null), { status: 400 });
  assert.throws(() => validateGenerationRequest({ prompt: " " }), { status: 400 });
  assert.throws(() => validateGenerationRequest({ prompt: "valid", metadata: { apiKey: "secret" } }), {
    status: 400,
    message: /must not contain credentials/,
  });
  assert.throws(() => validateGenerationRequest({ prompt: "include password=supersecretvalue" }), {
    status: 400,
    message: /must not contain credentials/,
  });
  assert.throws(() => validateGenerationRequest({ prompt: "valid", unexpected: true }), { status: 400 });
  assert.throws(() => validateGenerationRequest({ prompt: "valid" }, "not allowed!"), { status: 400 });
});

test("validates job IDs and Redis environment URLs", () => {
  assert.equal(isValidJobId("8f14e45f-ea12-4e00-b4d5-4c7a6d8e9f01"), true);
  assert.equal(isValidJobId("not-a-uuid"), false);

  const invalidRedis = readEnv({ REDIS_URL: "redis://", LOG_LEVEL: "info" });
  assert.equal(invalidRedis.ok, false);
  assert.match(invalidRedis.problems.join(" "), /REDIS_URL/);

  const developmentDefault = readEnv({ NODE_ENV: "development" });
  assert.equal(developmentDefault.values.redisUrl, "redis://127.0.0.1:6379/0");
  assert.equal(developmentDefault.ok, true);

  const productionRequiresRedis = readEnv({ NODE_ENV: "production" });
  assert.equal(productionRequiresRedis.ok, false);
  assert.match(productionRequiresRedis.problems.join(" "), /REDIS_URL is required/);
});

test("redacts credentials and query parameters from URLs and errors", () => {
  assert.equal(redactUrl("rediss://user:password@cache.example:6379/0?token=hidden"), "rediss://cache.example:6379/0");
  assert.equal(redactSecrets("connection to redis://user:password@cache.example?token=hidden failed"), "connection to redis://cache.example failed");
  assert.equal(redactSecrets("token=very-secret"), "token=***");
});
