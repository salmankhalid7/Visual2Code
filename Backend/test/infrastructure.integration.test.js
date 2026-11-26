import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";
import { prisma } from "../src/prisma.js";
import { connectRedis, closeRedis, getRedisClient } from "../src/redis/connection.js";
import { closeGenerationQueue, getGenerationQueue } from "../src/queues/generationQueue.js";
import { createGenerationWorker } from "../src/workers/generationWorker.js";
import { processGenerationJob } from "../src/jobs/generationProcessor.js";
import { recoverQueuedGenerationJobs } from "../src/jobs/generationOutbox.js";
import { env } from "../src/env.js";

const enabled = process.env.RUN_INFRASTRUCTURE_INTEGRATION_TESTS === "1";
const skipReason = enabled
  ? false
  : "Set RUN_INFRASTRUCTURE_INTEGRATION_TESTS=1 with a migrated test PostgreSQL database and Redis.";
const createdJobIds = new Set();
let workerResources;
let server;
let baseUrl;
let resourcesClosed = false;

async function waitForStatus(jobId, status, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await prisma.generationJob.findUnique({ where: { id: jobId } });
    if (record?.status === status) return record;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${status}`);
}

before(async () => {
  if (!enabled) return;

  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  await connectRedis();
  await getGenerationQueue().waitUntilReady();

  workerResources = await createGenerationWorker(async (job) => {
    const record = await prisma.generationJob.findUnique({ where: { id: job.data.jobId } });
    if (record?.input.prompt === "integration:retry" && job.attemptsMade === 0) {
      throw new Error("expected first-attempt failure");
    }
    if (record?.input.prompt === "integration:fail") {
      throw new Error("expected terminal failure");
    }
    return processGenerationJob(job);
  });
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test("connects Redis and initializes the generation queue", { skip: skipReason }, async () => {
  assert.equal(await getRedisClient().ping(), "PONG");
  assert.equal(getGenerationQueue().name, env.generationQueueName);
});

test("submits a generation job and persists progress and result", { skip: skipReason }, async () => {
  const idempotencyKey = randomUUID();
  const response = await fetch(`${baseUrl}/jobs/generation`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ prompt: "integration:success" }),
  });
  assert.equal(response.status, 202);
  const { data: submitted } = await response.json();
  createdJobIds.add(submitted.id);

  const duplicateResponse = await fetch(`${baseUrl}/jobs/generation`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify({ prompt: "integration:success" }),
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).data.id, submitted.id);

  const completed = await waitForStatus(submitted.id, "COMPLETED");
  assert.equal(completed.progress, 100);
  assert.ok(completed.startedAt);
  assert.ok(completed.completedAt);

  const resultResponse = await fetch(`${baseUrl}/jobs/generation/${submitted.id}/result`);
  assert.equal(resultResponse.status, 200);
  const result = await resultResponse.json();
  assert.equal(result.data.result.message, "Mock generation completed");

  const statusResponse = await fetch(`${baseUrl}/jobs/generation/${submitted.id}`);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).data.status, "completed");

  const progressResponse = await fetch(`${baseUrl}/jobs/generation/${submitted.id}/progress`);
  assert.equal(progressResponse.status, 200);
  assert.equal((await progressResponse.json()).data.progress, 100);
});

test("rejects invalid requests and returns not found for missing jobs", { skip: skipReason }, async () => {
  const invalidResponse = await fetch(`${baseUrl}/jobs/generation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "", unexpected: true }),
  });
  assert.equal(invalidResponse.status, 400);

  const missingResponse = await fetch(`${baseUrl}/jobs/generation/${randomUUID()}`);
  assert.equal(missingResponse.status, 404);

  const invalidIdResponse = await fetch(`${baseUrl}/jobs/generation/not-a-uuid`);
  assert.equal(invalidIdResponse.status, 400);
});

test("recovers a PostgreSQL job missing from Redis", { skip: skipReason }, async () => {
  const jobId = randomUUID();
  createdJobIds.add(jobId);
  await prisma.generationJob.create({
    data: {
      id: jobId,
      input: { prompt: "integration:recovered" },
    },
  });

  await recoverQueuedGenerationJobs();
  const recovered = await waitForStatus(jobId, "COMPLETED");
  assert.equal(recovered.progress, 100);
});

test("retries a transient processor failure and persists terminal failures", { skip: skipReason }, async () => {
  for (const prompt of ["integration:retry", "integration:fail"]) {
    const response = await fetch(`${baseUrl}/jobs/generation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    assert.equal(response.status, 202);
    const { data } = await response.json();
    createdJobIds.add(data.id);

    const terminalStatus = prompt.endsWith("retry") ? "COMPLETED" : "FAILED";
    const record = await waitForStatus(data.id, terminalStatus);
    if (terminalStatus === "COMPLETED") {
      assert.equal(record.progress, 100);
    } else {
      assert.match(record.error, /expected terminal failure/);
      assert.ok(record.completedAt);
    }
  }
});

test("cancels a delayed job before processing", { skip: skipReason }, async () => {
  const response = await fetch(`${baseUrl}/jobs/generation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "integration:cancel", delayMs: 60_000 }),
  });
  const { data } = await response.json();
  createdJobIds.add(data.id);

  const cancellation = await fetch(`${baseUrl}/jobs/generation/${data.id}`, { method: "DELETE" });
  assert.equal(cancellation.status, 200);
  assert.equal((await cancellation.json()).data.status, "cancelled");
});

test("closes worker, queue, and Redis connections gracefully", { skip: skipReason }, async () => {
  if (createdJobIds.size > 0) {
    await prisma.generationJob.deleteMany({ where: { id: { in: [...createdJobIds] } } });
  }
  await workerResources.worker.close();
  assert.equal(workerResources.worker.closed, true);
  if (workerResources.connection.status !== "end") await workerResources.connection.quit();
  await closeGenerationQueue();
  await closeRedis();
  await prisma.$disconnect();
  resourcesClosed = true;
});

after(async () => {
  if (!enabled) return;

  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  if (!resourcesClosed && createdJobIds.size > 0) {
    await prisma.generationJob.deleteMany({ where: { id: { in: [...createdJobIds] } } });
  }
  if (!resourcesClosed) {
    await workerResources?.worker.close();
    if (workerResources?.connection.status !== "end") await workerResources?.connection.quit();
    await closeGenerationQueue();
    await closeRedis();
    await prisma.$disconnect();
  }
});
