import { redactSecrets } from "./redact.js";

const LEVEL_WEIGHT = { error: 0, warn: 1, info: 2, debug: 3 };

function resolveThreshold() {
  const configured = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVEL_WEIGHT[configured] ?? LEVEL_WEIGHT.info;
}

/**
 * Converts an Error into a loggable object. Stacks are only included when
 * explicitly asked for, so production logs stay compact.
 */
export function serializeError(error, { includeStack = false } = {}) {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const serialized = {
    name: error.name,
    message: redactSecrets(error.message),
    ...(error.code ? { code: error.code } : {}),
  };

  if (includeStack && error.stack) {
    serialized.stack = error.stack;
  }

  return serialized;
}

function emit(level, message, meta = {}) {
  if (LEVEL_WEIGHT[level] > resolveThreshold()) return;

  const entry = { time: new Date().toISOString(), level, message, ...meta };

  if (meta.error !== undefined) {
    entry.error = serializeError(meta.error);
  }

  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(JSON.stringify(entry));
}

function createLogger(base = {}) {
  return {
    error: (message, meta) => emit("error", message, { ...base, ...meta }),
    warn: (message, meta) => emit("warn", message, { ...base, ...meta }),
    info: (message, meta) => emit("info", message, { ...base, ...meta }),
    debug: (message, meta) => emit("debug", message, { ...base, ...meta }),
    child: (context) => createLogger({ ...base, ...context }),
  };
}

export const logger = createLogger();
