import dotenv from "dotenv";

dotenv.config();

const toPort = (value) => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return port;
};

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: toPort(process.env.PORT || "3000"),
  corsOrigins: (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
