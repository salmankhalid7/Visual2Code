import { Queue } from "bullmq";
import { connection } from "./redis.js";

export const QUEUE_NAMES = {
  GENERATION: "generation",
};

export const generationQueue = new Queue(QUEUE_NAMES.GENERATION, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
