import { env } from "../config/env.js";

export default function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  const isProduction = env.nodeEnv === "production";
  const message = statusCode >= 500 && isProduction
    ? "Internal server error"
    : error.message || "Internal server error";

  if (env.nodeEnv !== "test") {
    console.error(error);
  }

  return res.status(statusCode).json({
    status: "error",
    message,
  });
}
