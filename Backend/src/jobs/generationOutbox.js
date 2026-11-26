import { GenerationJobStatus } from "../generated/prisma/client.ts";
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import { withTimeout } from "../lib/async.js";
import { enqueueGenerationRecord, getGenerationQueue } from "../queues/generationQueue.js";
import { prisma } from "../prisma.js";

const BATCH_SIZE = 100;
const RECOVERY_INTERVAL_MS = 15_000;
const log = logger.child({ component: "generation-outbox" });
let cursorId;
let activeRecovery;

export async function recoverQueuedGenerationJobs() {
  const records = await prisma.generationJob.findMany({
    where: {
      status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.RETRYING] },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: BATCH_SIZE,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
  });

  if (records.length === 0) {
    cursorId = undefined;
    return 0;
  }
  cursorId = records.length === BATCH_SIZE ? records.at(-1).id : undefined;

  let recoveredCount = 0;
  const queue = getGenerationQueue();

  for (const record of records) {
    try {
      const existing = await withTimeout(
        queue.getJob(record.id),
        env.queueOperationTimeoutMs,
        "Generation queue lookup timed out",
      );
      if (existing) continue;

      await enqueueGenerationRecord(record);
      recoveredCount += 1;
      log.warn("Recovered persisted generation job into Redis", { jobId: record.id });
    } catch (error) {
      log.error("Failed to recover persisted generation job", {
        jobId: record.id,
        error,
      });
    }
  }

  return recoveredCount;
}

export function startGenerationJobRecovery() {
  if (activeRecovery) return () => activeRecovery;

  const run = () => {
    if (activeRecovery) return activeRecovery;
    activeRecovery = recoverQueuedGenerationJobs()
      .then((recoveredCount) => {
        if (recoveredCount > 0) {
          log.info("Generation job recovery pass complete", { recoveredCount });
        }
      })
      .catch((error) => {
        log.error("Generation job recovery pass failed", { error });
      })
      .finally(() => {
        activeRecovery = undefined;
      });
    return activeRecovery;
  };

  run();
  const timer = setInterval(run, RECOVERY_INTERVAL_MS);
  timer.unref();

  return async () => {
    clearInterval(timer);
    await activeRecovery;
  };
}
