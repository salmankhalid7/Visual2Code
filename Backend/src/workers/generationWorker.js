import { Worker } from "bullmq";
import { GenerationJobStatus } from "../generated/prisma/client.ts";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import { withTimeout } from "../lib/async.js";
import { createRedisConnection, verifyRedisConnection } from "../redis/connection.js";
import { safeJobFailureMessage, processGenerationJob } from "../jobs/generationProcessor.js";

const log = logger.child({ component: "generation-worker" });

export async function createGenerationWorker(processor = processGenerationJob) {
  const connection = createRedisConnection({
    connectionName: `${env.redisKeyPrefix}:worker:${process.pid}`,
  });
  let worker;

  try {
    await verifyRedisConnection(connection);

    worker = new Worker(env.generationQueueName, processor, {
      connection,
      prefix: env.redisKeyPrefix,
      concurrency: env.workerConcurrency,
      lockDuration: env.workerLockDurationMs,
      stalledInterval: env.workerStalledIntervalMs,
      maxStalledCount: env.workerMaxStalledCount,
    });

    worker.on("active", (job) => log.info("Job active", { jobId: job.id }));
    worker.on("completed", (job) => log.info("Job completed", { jobId: job.id }));
    worker.on("stalled", (jobId) => log.warn("Job stalled", { jobId }));
    worker.on("error", (error) => log.error("Worker error", { error }));
    worker.on("failed", (job, error) => {
      if (!job) {
        log.error("Worker reported a failure without a job", { error });
        return;
      }

      const terminal = job.attemptsMade >= (job.opts.attempts ?? 1);
      prisma.generationJob.updateMany({
        where: {
          id: job.data.jobId,
          status: { notIn: [GenerationJobStatus.COMPLETED, GenerationJobStatus.CANCELLED] },
        },
        data: {
          status: terminal ? GenerationJobStatus.FAILED : GenerationJobStatus.RETRYING,
          error: safeJobFailureMessage(error),
          ...(terminal ? { completedAt: new Date() } : {}),
        },
      }).catch((databaseError) => {
        log.error("Failed to persist job failure", {
          jobId: job.id,
          error: databaseError,
        });
      });
      log.warn(terminal ? "Job failed after retries" : "Job will retry", {
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        attempts: job.opts.attempts ?? 1,
        error,
      });
    });

    await withTimeout(
      worker.waitUntilReady(),
      env.redisConnectTimeoutMs,
      "Generation worker startup timed out",
    );
    return { worker, connection };
  } catch (error) {
    await worker?.close(true).catch((closeError) => {
      log.error("Failed to close worker after startup error", { error: closeError });
    });
    connection.disconnect();
    throw error;
  }
}
