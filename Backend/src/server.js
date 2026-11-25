// Entry point: loads .env into process.env, then starts the HTTP server.
// Must stay the first import so env vars exist before app.js is evaluated.
import "dotenv/config";
import app from "./app.js";
import { prisma } from "./prisma.js";

// Falls back to 3000 when PORT is missing from .env
const PORT = process.env.PORT || 3000;

// Upper bound on graceful shutdown; open keep-alive sockets can otherwise
// delay `server.close()` indefinitely.
const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

const startServer = async () => {
  // Prisma connects lazily, so without this the first failed query would
  // surface as a 500 instead of preventing a half-dead server from binding.
  // The probe matters: the Neon adapter only builds a lazy pool on `$connect()`,
  // so `SELECT 1` is what actually proves the database is reachable.
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log("Database connection established");
  } catch (error) {
    console.error(`Failed to connect to the database: ${error.message}`);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
  });

  // Bind errors (EADDRINUSE, EACCES) arrive as events, not via the callback
  server.on("error", (error) => {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
  });

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`${signal} received: closing server`);

    // Guarantees the process dies even if sockets stay open
    setTimeout(() => {
      console.error("Shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    server.close(async () => {
      try {
        await prisma.$disconnect();
        console.log("Database connection closed");
      } catch (error) {
        console.error(`Error closing database connection: ${error.message}`);
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

startServer();
