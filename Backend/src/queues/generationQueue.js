import { Queue } from "bullmq";
import { env } from "../env.js";
import { withTimeout } from "../lib/async.js";
import { logger } from "../lib/logger.js";
import { getRedisClient } from "../redis/connection.js";

const log = logger.child({ component: "generation-queue", queue: env.generationQueueName });
let generationQueue;

export function getGenerationQueue() {
  if (!generationQueue) {
    generationQueue = new Queue(env.generationQueueName, {
      connection: getRedisClient(),
      prefix: env.redisKeyPrefix,
      defaultJobOptions: {
        attempts: env.jobMaxAttempts,
        backoff: {
          type: "exponential",
          delay: env.jobBackoffDelayMs,
        },
        removeOnComplete: {
          age: env.jobCompletedRetentionAgeSeconds,
          count: env.jobCompletedRetentionCount,
        },
        removeOnFail: {
          age: env.jobFailedRetentionAgeSeconds,
          count: env.jobFailedRetentionCount,
        },
      },
    });

    generationQueue.on("error", (error) => {
      log.error("Queue error", { error });
    });
  }

  return generationQueue;
}

export function enqueueGenerationRecord(record) {
  const delay = Math.max(0, record.createdAt.getTime() + record.delayMs - Date.now());
  return withTimeout(
    getGenerationQueue().add("generate", { jobId: record.id }, {
      jobId: record.id,
      priority: record.priority,
      ...(delay > 0 ? { delay } : {}),
    }),
    env.queueOperationTimeoutMs,
    "Generation queue operation timed out",
  );
}

export async function closeGenerationQueue() {
  const queue = generationQueue;
  generationQueue = null;
  if (queue && !queue.closed) await queue.close();
}
