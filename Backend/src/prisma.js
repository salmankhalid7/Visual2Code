import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaNeon } from "@prisma/adapter-neon";

// Pooled URL: runtime queries go through Neon's PgBouncer endpoint.
const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
