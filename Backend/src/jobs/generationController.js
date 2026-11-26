import { isValidJobId } from "./generationValidation.js";
import {
  cancelGenerationJob,
  getGenerationJob,
  getGenerationResult,
  submitGenerationJob,
} from "./generationService.js";
import { badRequest } from "../lib/httpError.js";

function requireJobId(id) {
  if (!isValidJobId(id)) throw badRequest("Invalid generation job ID");
}

export async function createGeneration(req, res) {
  const { job, created } = await submitGenerationJob(req.body, req.get("Idempotency-Key"));
  res.status(created ? 202 : 200).json({ data: job });
}

export async function readGeneration(req, res) {
  requireJobId(req.params.id);
  res.json({ data: await getGenerationJob(req.params.id) });
}

export async function readGenerationProgress(req, res) {
  requireJobId(req.params.id);
  const job = await getGenerationJob(req.params.id);
  res.json({ data: { jobId: job.id, status: job.status, progress: job.progress } });
}

export async function readGenerationResult(req, res) {
  requireJobId(req.params.id);
  res.json({ data: await getGenerationResult(req.params.id) });
}

export async function cancelGeneration(req, res) {
  requireJobId(req.params.id);
  res.json({ data: await cancelGenerationJob(req.params.id) });
}
