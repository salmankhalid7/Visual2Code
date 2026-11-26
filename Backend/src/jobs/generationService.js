import { randomUUID } from "node:crypto";
import { GenerationJobStatus } from "../generated/prisma/client.ts";
import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { enqueueGenerationRecord, getGenerationQueue } from "../queues/generationQueue.js";
import { conflict, notFound, serviceUnavailable } from "../lib/httpError.js";
import { logger } from "../lib/logger.js";
import { redactSecrets, truncate } from "../lib/redact.js";
import { withTimeout } from "../lib/async.js";
import { validateGenerationRequest } from "./generationValidation.js";

const log = logger.child({ component: "generation-service" });

function toPublicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status.toLowerCase(),
    progress: job.progress,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  };
}

export async function submitGenerationJob(body, idempotencyKey) {
  const { input, priority, delayMs, idempotencyKey: key } =
    validateGenerationRequest(body, idempotencyKey);
  const id = randomUUID();

  let record;
  try {
    record = await prisma.generationJob.create({
      data: {
        id,
        idempotencyKey: key,
        priority,
        delayMs,
        input,
      },
    });
  } catch (error) {
    if (error?.code === "P2002" && key) {
      const existing = await prisma.generationJob.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if ([GenerationJobStatus.QUEUED, GenerationJobStatus.RETRYING].includes(existing.status)) {
          try {
            await enqueueGenerationRecord(existing);
          } catch (queueError) {
            log.error("Failed to ensure idempotent generation job is queued", {
              jobId: existing.id,
              error: queueError,
            });
            throw serviceUnavailable("Job queue is temporarily unavailable");
          }
        }
        return { job: toPublicJob(existing), created: false };
      }
    }
    throw error;
  }

  try {
    await enqueueGenerationRecord(record);
  } catch (error) {
    log.error("Failed to submit generation job to queue; it remains recoverable in PostgreSQL", {
      jobId: id,
      error: truncate(redactSecrets(error?.message || "Queue submission failed"), 1_000),
    });
    throw serviceUnavailable("Job queue is temporarily unavailable");
  }

  return { job: toPublicJob(record), created: true };
}

export async function getGenerationJob(id) {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) throw notFound("Generation job not found");
  return toPublicJob(job);
}

export async function getGenerationResult(id) {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) throw notFound("Generation job not found");
  if (job.status !== GenerationJobStatus.COMPLETED) {
    throw conflict("Generation job has not completed");
  }
  return { jobId: job.id, result: job.result };
}

export async function cancelGenerationJob(id) {
  const record = await prisma.generationJob.findUnique({ where: { id } });
  if (!record) throw notFound("Generation job not found");
  if ([GenerationJobStatus.COMPLETED, GenerationJobStatus.FAILED, GenerationJobStatus.CANCELLED]
    .includes(record.status)) {
    throw conflict(`Generation job cannot be cancelled in ${record.status.toLowerCase()} state`);
  }

  let queuedJob;
  try {
    queuedJob = await withTimeout(
      getGenerationQueue().getJob(id),
      env.queueOperationTimeoutMs,
      "Generation queue lookup timed out",
    );
    if (queuedJob) {
      const state = await withTimeout(
        queuedJob.getState(),
        env.queueOperationTimeoutMs,
        "Generation queue state lookup timed out",
      );
      if (!["waiting", "delayed", "prioritized", "paused"].includes(state)) {
        throw conflict("Generation job can only be cancelled before processing starts");
      }
    }
  } catch (error) {
    if (error.status === 409) throw error;
    log.warn("Could not confirm queued job state; cancellation will be persisted in PostgreSQL", {
      jobId: id,
      error,
    });
  }

  const cancelled = await prisma.generationJob.updateMany({
    where: {
      id,
      status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RETRYING] },
    },
    data: {
      status: GenerationJobStatus.CANCELLED,
      completedAt: new Date(),
    },
  });
  if (cancelled.count !== 1) {
    throw conflict("Generation job changed state before it could be cancelled");
  }

  if (queuedJob) {
    try {
      await withTimeout(
        queuedJob.remove(),
        env.queueOperationTimeoutMs,
        "Generation job removal timed out",
      );
    } catch (error) {
      log.warn("Cancelled job could not be removed from Redis; the worker will skip it", {
        jobId: id,
        error,
      });
    }
  }

  return toPublicJob(await prisma.generationJob.findUniqueOrThrow({ where: { id } }));
}
