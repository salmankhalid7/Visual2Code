import "dotenv/config";
import { env, assertValidEnv } from "../env.js";
import { prisma } from "../prisma.js";
import { closeRedis } from "../redis/connection.js";
import { closeGenerationQueue } from "../queues/generationQueue.js";
import { createGenerationWorker } from "./generationWorker.js";
import { startGenerationJobRecovery } from "../jobs/generationOutbox.js";
import { logger } from "../lib/logger.js";

let workerResources;
let shuttingDown = false;
let stopGenerationRecovery;

async function startWorker() {
  assertValidEnv();
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  await prisma.generationJob.count();
  logger.info("Worker database connection established");
  workerResources = await createGenerationWorker();
  stopGenerationRecovery = startGenerationJobRecovery();
  logger.info("Generation worker is ready", {
    queue: env.generationQueueName,
    concurrency: env.workerConcurrency,
  });
}

export async function shutdownWorker(signal = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Worker shutdown requested", { signal });

  const timer = setTimeout(() => {
    logger.error("Worker shutdown timed out");
    process.exit(1);
  }, env.shutdownTimeoutMs);
  timer.unref();

  const errors = [];
  const cleanup = async (label, operation) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
      logger.error(`Failed to ${label}`, { error });
    }
  };

  if (workerResources) {
    if (stopGenerationRecovery) {
      await cleanup("stop generation recovery", stopGenerationRecovery);
    }
    await cleanup("close worker", () => workerResources.worker.close());
    if (workerResources.connection.status !== "end") {
      await cleanup("close worker Redis connection", () => workerResources.connection.quit());
    }
  }
  await cleanup("close generation queue", closeGenerationQueue);
  await cleanup("close shared Redis connection", closeRedis);
  await cleanup("disconnect Prisma", () => prisma.$disconnect());

  if (errors.length > 0) {
    logger.error("Worker shutdown completed with errors", { errorCount: errors.length });
    process.exitCode = 1;
  } else {
    logger.info("Worker shutdown complete");
  }
  clearTimeout(timer);
}

process.once("SIGINT", () => shutdownWorker("SIGINT").finally(() => process.exit()));
process.once("SIGTERM", () => shutdownWorker("SIGTERM").finally(() => process.exit()));

startWorker().catch(async (error) => {
  logger.error("Worker startup failed", { error });
  await shutdownWorker("startup failure");
  process.exitCode = 1;
});
