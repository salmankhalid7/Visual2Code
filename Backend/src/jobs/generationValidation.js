import { badRequest } from "../lib/httpError.js";
import { env } from "../env.js";

const SENSITIVE_KEY = /password|passwd|secret|api.?key|access.?token|authorization|credential/i;
const SENSITIVE_VALUE =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{20,})\b|\b(?:password|passwd|secret|token|api.?key|access.?token)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateMetadata(value, depth = 0) {
  if (depth > 8) throw badRequest("metadata is nested too deeply");

  if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
    throw badRequest("job input must not contain credentials or secrets");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateMetadata(item, depth + 1);
    return;
  }
  if (!isPlainObject(value)) throw badRequest("metadata must contain only JSON values");

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw badRequest("metadata must not contain credentials or secrets");
    }
    validateMetadata(nestedValue, depth + 1);
  }
}

export function validateGenerationRequest(body, idempotencyKey) {
  if (!isPlainObject(body)) throw badRequest("Request body must be a JSON object");

  const allowedFields = new Set(["prompt", "metadata", "priority", "delayMs"]);
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key));
  if (unknownFields.length > 0) {
    throw badRequest(`Unsupported request field: ${unknownFields[0]}`);
  }

  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0 || body.prompt.length > 10_000) {
    throw badRequest("prompt must be a non-empty string of at most 10000 characters");
  }
  if (SENSITIVE_VALUE.test(body.prompt)) {
    throw badRequest("job input must not contain credentials or secrets");
  }

  if (body.metadata !== undefined) {
    if (!isPlainObject(body.metadata)) throw badRequest("metadata must be a JSON object");
    validateMetadata(body.metadata);
  }

  const priority = body.priority === undefined ? env.jobDefaultPriority : body.priority;
  if (!Number.isInteger(priority) || priority < 1 || priority > 2_147_483_647) {
    throw badRequest("priority must be an integer from 1 to 2147483647");
  }

  const delayMs = body.delayMs === undefined ? 0 : body.delayMs;
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 7 * 24 * 60 * 60 * 1_000) {
    throw badRequest("delayMs must be an integer from 0 to 604800000");
  }

  if (idempotencyKey !== undefined && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw badRequest("Idempotency-Key must be 1-128 letters, digits, or . _ : - characters");
  }

  if (Buffer.byteLength(JSON.stringify(body), "utf8") > env.jobMaxInputBytes) {
    throw badRequest(`Request body exceeds the ${env.jobMaxInputBytes} byte limit`);
  }

  return {
    input: {
      prompt: body.prompt.trim(),
      ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    },
    priority,
    delayMs,
    idempotencyKey,
  };
}

export function isValidJobId(id) {
  return typeof id === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
