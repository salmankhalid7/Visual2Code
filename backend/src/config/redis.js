import Redis from "ioredis";
import { env } from "./env.js";

export const connection = new Redis(env.redisUrl, {
  // Required by BullMQ: do not throw on retryable Redis commands.
  maxRetriesPerRequest: null,
  // Enable TLS for Upstash (rediss://). ioredis handles this from the URL scheme.
  enableReadyCheck: true,
  lazyConnect: false,
});

connection.on("connect", () => {
  console.log("Redis connected");
});

connection.on("error", (error) => {
  console.error("Redis connection error:", error);
});
