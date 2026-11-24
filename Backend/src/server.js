// Entry point: loads .env into process.env, then starts the HTTP server.
// Must stay the first import so env vars exist before app.js is evaluated.
import "dotenv/config";
import app from "./app.js";

// Falls back to 3000 when PORT is missing from .env
const PORT = process.env.PORT || 3000;

const startServer = () => {
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port http://localhost:${PORT}`);
  });

  // Bind errors (EADDRINUSE, EACCES) arrive as events, not via the callback
  server.on("error", (error) => {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
  });
};

startServer();
