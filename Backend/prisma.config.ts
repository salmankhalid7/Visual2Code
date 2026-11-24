import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Unpooled (no "-pooler" host): PgBouncer cannot run migration DDL.
    // env() reads the variable internally instead of relying on the global
    // `process`, so a stray local `process` binding cannot shadow it.
    url: env("DATABASE_URL_UNPOOLED"),
    // Optional: only used by `migrate dev` to compute the diff.
    shadowDatabaseUrl: process.env["DATABASE_URL_UNPOOLED_SHADOW"],
  },
});
