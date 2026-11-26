/**
 * An error that carries an HTTP status (and optional extra response fields),
 * so the global handler in app.js can map domain failures to responses.
 */
export function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;

  if (details) {
    error.details = details;
  }

  return error;
}

export const badRequest = (message, details) => httpError(400, message, details);
export const notFound = (message = "Not found") => httpError(404, message);
export const conflict = (message, details) => httpError(409, message, details);
export const serviceUnavailable = (message) => httpError(503, message);
