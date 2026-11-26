import { GenerationJobStatus } from "../generated/prisma/client.ts";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { sleep } from "../lib/async.js";
import { redactSecrets } from "../lib/redact.js";

const PROGRESS_STEPS = [10, 35, 65, 90];

export async function processGenerationJob(job) {
  const record = await prisma.generationJob.findUnique({ where: { id: job.data.jobId } });
  if (!record) throw new Error("Persisted generation job record is missing");
  if (record.status === GenerationJobStatus.CANCELLED) return { cancelled: true };

  await prisma.generationJob.update({
    where: { id: record.id },
    data: {
      status: GenerationJobStatus.ACTIVE,
      progress: 0,
      error: null,
      startedAt: record.startedAt ?? new Date(),
    },
  });
  await job.updateProgress(0);

  for (const progress of PROGRESS_STEPS) {
    if (env.mockGenerationDelayMs > 0) await sleep(env.mockGenerationDelayMs);
    await prisma.generationJob.update({
      where: { id: record.id },
      data: { progress },
    });
    await job.updateProgress(progress);
  }

  const result = {
    message: "Mock generation completed",
    promptLength: record.input.prompt.length,
    generatedAt: new Date().toISOString(),
  };

  await prisma.generationJob.update({
    where: { id: record.id },
    data: {
      status: GenerationJobStatus.COMPLETED,
      progress: 100,
      result,
      error: null,
      completedAt: new Date(),
    },
  });
  await job.updateProgress(100);

  return result;
}

export function safeJobFailureMessage(error) {
  return redactSecrets(error?.message || "Generation job failed").slice(0, 1_000);
}
