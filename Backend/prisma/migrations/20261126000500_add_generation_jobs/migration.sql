CREATE TYPE "GenerationJobStatus" AS ENUM (
    'QUEUED',
    'ACTIVE',
    'RETRYING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);

CREATE TABLE "GenerationJob" (
    "id" UUID NOT NULL,
    "userId" INTEGER,
    "idempotencyKey" TEXT,
    "type" TEXT NOT NULL DEFAULT 'generation',
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "delayMs" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GenerationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GenerationJob_idempotencyKey_key" ON "GenerationJob"("idempotencyKey");
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");
CREATE INDEX "GenerationJob_userId_idx" ON "GenerationJob"("userId");
