import { Worker } from "bullmq";
import { connection } from "./config/redis.js";
import { QUEUE_NAMES } from "./config/queue.js";
import { generationProcessor } from "./jobs/processors/generation.processor.js";

const worker = new Worker(QUEUE_NAMES.GENERATION, generationProcessor, {
  connection,
  concurrency: 1,
});

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error);
});

console.log(`Worker listening on queue "${QUEUE_NAMES.GENERATION}"`);

process.once("SIGTERM", async () => {
  console.log("SIGTERM received. Closing worker...");
  await worker.close();
  process.exit(0);
});

process.once("SIGINT", async () => {
  console.log("SIGINT received. Closing worker...");
  await worker.close();
  process.exit(0);
});
