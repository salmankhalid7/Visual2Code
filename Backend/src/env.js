import dotenv from "dotenv";

// Loads .env into process.env. Values already present in the environment win,
// which lets tests, Docker and CI override any setting without editing files.
dotenv.config({ quiet: true });

const LEVELS = new Set(["error", "warn", "info", "debug"]);

function readInt(source, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = source[name];

  if (raw === undefined || raw === "") return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < min || value > max) {
    return { error: `${name} must be an integer between ${min} and ${max} (received "${raw}")` };
  }

  return value;
}

function readString(source, name, fallback) {
  const raw = source[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

/**
 * Pure env reader: no side effects, so it can be unit tested with a fake
 * source object. Returns the resolved config plus a list of problems.
 */
export function readEnv(source = process.env) {
  const problems = [];
  const nodeEnv = readString(source, "NODE_ENV", "development");

  const int = (name, fallback, bounds) => {
    const value = readInt(source, name, fallback, bounds);
    if (typeof value === "object" && value?.error) {
      problems.push(value.error);
      return fallback;
    }
    return value;
  };

  const redisUrl = readString(
    source,
    "REDIS_URL",
    nodeEnv === "development" ? "redis://127.0.0.1:6379/0" : undefined,
  );

  if (!redisUrl) {
    problems.push("REDIS_URL is required (e.g. redis://127.0.0.1:6379/0 or rediss://user:pass@host:6379)");
  } else if (!/^rediss?:\/\//.test(redisUrl)) {
    problems.push("REDIS_URL must start with redis:// (plain) or rediss:// (TLS)");
  }
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      if (!["redis:", "rediss:"].includes(parsed.protocol) || !parsed.hostname) {
        problems.push("REDIS_URL must include a valid Redis hostname");
      }
    } catch {
      problems.push("REDIS_URL must be a valid redis:// or rediss:// URL");
    }
  }

  const logLevel = readString(source, "LOG_LEVEL", "info").toLowerCase();
  if (!LEVELS.has(logLevel)) {
    problems.push(`LOG_LEVEL must be one of ${[...LEVELS].join(", ")} (received "${logLevel}")`);
  }

  const queueName = readString(source, "GENERATION_QUEUE_NAME", "generation");
  if (!queueName || /[:\s]/.test(queueName)) {
    problems.push("GENERATION_QUEUE_NAME must be a non-empty name without ':' or whitespace");
  }
  const redisKeyPrefix = readString(source, "REDIS_KEY_PREFIX", "v2c");
  if (!/^[A-Za-z0-9._-]+$/.test(redisKeyPrefix)) {
    problems.push("REDIS_KEY_PREFIX may contain only letters, digits, '.', '_' and '-'");
  }

  const port = int("PORT", 3000, { min: 1, max: 65_535 });

  const values = Object.freeze({
    nodeEnv,
    port,
    logLevel,

    redisUrl,
    // BullMQ prefixes every key it owns. Keeps queues from different apps in
    // the same Redis instance from colliding.
    redisKeyPrefix,
    redisConnectTimeoutMs: int("REDIS_CONNECT_TIMEOUT_MS", 10_000, { min: 1_000, max: 120_000 }),
    queueOperationTimeoutMs: int("QUEUE_OPERATION_TIMEOUT_MS", 10_000, { min: 1_000, max: 120_000 }),

    generationQueueName: queueName,
    jobDefaultPriority: int("JOB_DEFAULT_PRIORITY", 10, { min: 1, max: 2_147_483_647 }),

    workerConcurrency: int("WORKER_CONCURRENCY", 4, { min: 1, max: 1000 }),
    workerLockDurationMs: int("WORKER_LOCK_DURATION_MS", 30_000, { min: 1_000, max: 600_000 }),
    workerStalledIntervalMs: int("WORKER_STALLED_INTERVAL_MS", 30_000, { min: 1_000, max: 600_000 }),
    workerMaxStalledCount: int("WORKER_MAX_STALLED_COUNT", 1, { min: 0, max: 100 }),

    jobMaxAttempts: int("JOB_MAX_ATTEMPTS", 3, { min: 1, max: 20 }),
    jobBackoffDelayMs: int("JOB_BACKOFF_DELAY_MS", 2_000, { min: 100, max: 600_000 }),
    jobCompletedRetentionCount: int("JOB_REMOVE_ON_COMPLETE_COUNT", 500, { min: 0 }),
    jobCompletedRetentionAgeSeconds: int("JOB_REMOVE_ON_COMPLETE_AGE_SECONDS", 86_400, { min: 0 }),
    jobFailedRetentionCount: int("JOB_REMOVE_ON_FAIL_COUNT", 1_000, { min: 0 }),
    jobFailedRetentionAgeSeconds: int("JOB_REMOVE_ON_FAIL_AGE_SECONDS", 604_800, { min: 0 }),
    jobMaxInputBytes: int("JOB_MAX_INPUT_BYTES", 16_384, { min: 256, max: 1_048_576 }),
    // Pause inside the mock processor so progress is observable in tests.
    mockGenerationDelayMs: int("MOCK_GENERATION_DELAY_MS", 250, { min: 0, max: 60_000 }),

    shutdownTimeoutMs: int("SHUTDOWN_TIMEOUT_MS", 10_000, { min: 1_000, max: 120_000 }),
  });

  return { values, problems, ok: problems.length === 0 };
}

const resolved = readEnv();

export const env = resolved.values;
export const envProblems = resolved.problems;

/**
 * Fail fast on bad configuration instead of surfacing it as a confusing
 * runtime error deep inside ioredis or BullMQ.
 */
export function assertValidEnv() {
  if (envProblems.length > 0) {
    const error = new Error(`Invalid environment configuration:\n- ${envProblems.join("\n- ")}`);
    error.code = "INVALID_ENV";
    throw error;
  }
}
