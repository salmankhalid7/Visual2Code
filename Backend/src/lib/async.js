/**
 * Rejects if `promise` does not settle within `timeoutMs`. Used to keep API
 * requests bounded when Redis is unreachable (ioredis may otherwise queue
 * commands indefinitely while it reconnects).
 */
export function withTimeout(promise, timeoutMs, message = "Operation timed out") {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = "TIMEOUT";
      reject(error);
    }, timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
