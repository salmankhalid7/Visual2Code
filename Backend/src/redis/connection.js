import { Redis } from "ioredis";
import { env, assertValidEnv } from "../env.js";
import { logger } from "../lib/logger.js";
import { redactUrl } from "../lib/redact.js";
import { withTimeout } from "../lib/async.js";

const log = logger.child({ component: "redis" });

/**
 * Options shared by every Redis connection in the app.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ: blocking commands
 * (BRPOPLPUSH, XREADGROUP BLOCK) stay open far longer than a normal request,
 * so ioredis must not abandon them after a fixed number of retries.
 */
function connectionOptions(overrides = {}) {
  return {
    maxRetriesPerRequest: null,
    // Reconnect forever with a capped backoff instead of giving up; a Redis
    // restart must not permanently break a long-lived API or worker process.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    connectTimeout: env.redisConnectTimeoutMs,
    keepAlive: 15_000,
    // Connections are opened explicitly (lazyConnect) so startup can decide
    // when to fail fast and tests never open sockets at import time.
    lazyConnect: true,
    ...overrides,
  };
}

function attachDiagnostics(client, label) {
  client.on("connect", () => {
    log.info("Redis connecting", { connection: label, url: redactUrl(env.redisUrl) });
  });

  client.on("ready", () => {
    log.info("Redis ready", { connection: label, url: redactUrl(env.redisUrl) });
  });

  client.on("reconnecting", (delay) => {
    log.warn("Redis reconnecting", { connection: label, retryInMs: delay });
  });

  client.on("close", () => {
    log.warn("Redis connection closed", { connection: label });
  });

  client.on("end", () => {
    log.warn("Redis connection ended", { connection: label });
  });

  // Without a listener ioredis crashes the process on connection errors.
  client.on("error", (error) => {
    log.error("Redis connection error", {
      connection: label,
      error,
      // Never log the raw URL: it may contain a password.
      url: redactUrl(env.redisUrl),
    });
  });

  return client;
}

/**
 * Creates a new, independent Redis connection. Use this for anything that
 * needs its own socket (BullMQ workers duplicate it internally for blocking
 * commands, so a stalled job can never starve the shared client).
 */
export function createRedisConnection(overrides = {}) {
  assertValidEnv();

  const { connectionName, ...options } = overrides;
  const client = new Redis(env.redisUrl, connectionOptions(options));
  return attachDiagnostics(client, connectionName ?? "redis");
}

let sharedClient = null;

/**
 * The single connection reused by the HTTP process (BullMQ Queue, health
 * checks, startup probe). Reusing one socket keeps connection count flat and
 * makes shutdown deterministic.
 */
export function getRedisClient() {
  if (sharedClient) return sharedClient;

  sharedClient = createRedisConnection({
    connectionName: `${env.redisKeyPrefix}:api`,
  });

  // A closed/ended client must never be handed out again.
  sharedClient.on("end", () => {
    sharedClient = null;
  });

  return sharedClient;
}

function waitForReady(client, timeoutMs) {
  if (client.status === "ready") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("error", onError);
    };

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for Redis to become ready`));
    }, timeoutMs);

    client.once("ready", onReady);
    client.once("error", onError);

    if (client.status === "wait") {
      client.connect().catch(onError);
    }
  });
}

/**
 * Opens the shared connection and proves it works with a PING. Called by the
 * API and worker entry points so a bad REDIS_URL fails fast at boot instead of
 * on the first job.
 */
export async function connectRedis({ timeoutMs = env.redisConnectTimeoutMs } = {}) {
  const client = getRedisClient();

  return verifyRedisConnection(client, { timeoutMs });
}

export async function verifyRedisConnection(client, { timeoutMs = env.redisConnectTimeoutMs } = {}) {
  await waitForReady(client, timeoutMs);

  const startedAt = Date.now();
  await withTimeout(client.ping(), timeoutMs, "Redis PING timed out");

  log.info("Redis connection verified", {
    url: redactUrl(env.redisUrl),
    latencyMs: Date.now() - startedAt,
  });

  return client;
}

/**
 * Closes the shared connection. `quit()` flushes pending commands; if the
 * socket is already broken we fall back to `disconnect()` so shutdown never
 * hangs.
 */
export async function closeRedis() {
  const client = sharedClient;

  if (!client) return;

  sharedClient = null;

  if (client.status === "end") return;

  try {
    await withTimeout(client.quit(), env.shutdownTimeoutMs, "Redis shutdown timed out");
    log.info("Redis connection closed gracefully");
  } catch (error) {
    log.warn("Redis quit failed, forcing disconnect", { error });
    client.disconnect();
  }
}
