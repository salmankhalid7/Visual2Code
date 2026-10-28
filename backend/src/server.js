import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/prisma.js";
import { connection } from "./config/redis.js";
import { generationQueue } from "./config/queue.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

let server;
let shuttingDown = false;

const shutdown = async (signal, error) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Starting graceful shutdown...`);
  if (error) console.error(error);

  const forceShutdownTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceShutdownTimer.unref();

  try {
    await prisma.$disconnect();
  } catch (disconnectError) {
    console.error("Error disconnecting from database:", disconnectError);
  }

  try {
    await generationQueue.close();
    await connection.quit();
  } catch (disconnectError) {
    console.error("Error disconnecting from Redis:", disconnectError);
  }

  if (!server) {
    process.exit(error ? 1 : 0);
  }

  server.close((closeError) => {
    if (closeError) {
      console.error("Error while closing the server:", closeError);
      process.exit(1);
    }

    console.log("Server shut down successfully.");
    process.exit(error ? 1 : 0);
  });
};

const startServer = () => {
  server = app.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });

  server.on("error", (error) => {
    console.error("Error while starting the server:", error);
    shutdown("startup error", error);
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("uncaughtException", (error) => shutdown("uncaughtException", error));
process.once("unhandledRejection", (error) => shutdown("unhandledRejection", error));

startServer();