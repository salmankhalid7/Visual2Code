import "dotenv/config";
import app from "./app.js";
import { env, assertValidEnv } from "./env.js";
import { prisma } from "./prisma.js";
import { logger } from "./lib/logger.js";
import { closeRedis, connectRedis } from "./redis/connection.js";
import { closeGenerationQueue, getGenerationQueue } from "./queues/generationQueue.js";
import { withTimeout } from "./lib/async.js";

let server;
let shuttingDown = false;

async function startServer() {
  try {
    assertValidEnv();
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    await prisma.generationJob.count();
    logger.info("Database connection established");
    await connectRedis();
    await withTimeout(
      getGenerationQueue().waitUntilReady(),
      env.redisConnectTimeoutMs,
      "Generation queue startup timed out",
    );
  } catch (error) {
    logger.error("Failed to initialize API dependencies", { error });
    await closeGenerationQueue().catch((closeError) => {
      logger.error("Failed to close queue after startup error", { error: closeError });
    });
    await closeRedis().catch((closeError) => {
      logger.error("Failed to close Redis after startup error", { error: closeError });
    });
    await prisma.$disconnect().catch((disconnectError) => {
      logger.error("Failed to disconnect Prisma after startup error", { error: disconnectError });
    });
    process.exit(1);
  }

  server = app.listen(env.port, () => {
    logger.info("HTTP server listening", { port: env.port });
  });
  server.on("error", (error) => {
    logger.error("HTTP server failed", { error });
    shutdown("HTTP server error").finally(() => process.exit(1));
  });
}

export async function shutdown(signal = "shutdown") {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutdown requested", { signal });

  const timer = setTimeout(() => {
    logger.error("Shutdown timed out");
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

  if (server?.listening) {
    await cleanup("close HTTP server", () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));
  }
  await cleanup("close generation queue", closeGenerationQueue);
  await cleanup("close Redis", closeRedis);
  await cleanup("disconnect Prisma", () => prisma.$disconnect());

  if (errors.length > 0) {
    logger.error("API shutdown completed with errors", { errorCount: errors.length });
    process.exitCode = 1;
  } else {
    logger.info("API shutdown complete");
  }
  clearTimeout(timer);
}

process.once("SIGINT", () => shutdown("SIGINT").finally(() => process.exit()));
process.once("SIGTERM", () => shutdown("SIGTERM").finally(() => process.exit()));

startServer().catch((error) => {
  logger.error("API startup failed", { error });
  process.exitCode = 1;
});
