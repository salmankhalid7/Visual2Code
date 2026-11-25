const BROWSER_API_PREFIX = "/api";

// Relative URLs only resolve in the browser. Server-side callers (Server
// Components, Server Actions, Route Handlers) talk to the backend directly.
function buildUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined") {
    return `${BROWSER_API_PREFIX}${normalized}`;
  }

  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";
  return `${backendUrl.replace(/\/$/, "")}${normalized}`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ErrorBody = { error?: unknown };

/**
 * Fetch JSON from the Express backend. In the browser this goes through the
 * `/api/*` rewrite in next.config.ts, so requests stay same-origin.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const body = (await response.json()) as ErrorBody;
      if (typeof body?.error === "string" && body.error) {
        message = body.error;
      }
    } catch {
      // Non-JSON error bodies keep the status-based message.
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
