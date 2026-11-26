/**
 * Removes credentials from a connection URL so it can be logged safely.
 * `rediss://user:secret@host:6379/0` becomes `rediss://host:6379/0`.
 */
export function redactUrl(value) {
  if (typeof value !== "string" || value === "") return value;

  try {
    const url = new URL(value);

    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }

    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    // Not a parseable URL: strip anything that looks like userinfo.
    return value.replace(/\/\/[^@/]*@/, "//").replace(/[?#].*$/, "");
  }
}

const CREDENTIAL_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/**
 * Best-effort scrubber for free-form text (error messages from drivers) so
 * credentials never end up in API responses or persisted job errors.
 */
export function redactSecrets(text) {
  if (typeof text !== "string") return text;

  return text
    .replace(URL_PATTERN, (value) => redactUrl(value))
    .replace(CREDENTIAL_PATTERN, "$1***@")
    .replace(/\b(password|passwd|pwd|token|secret|apikey|api_key)\s*[=:]\s*\S+/gi, "$1=***");
}

export function truncate(text, maxLength = 1_000) {
  if (typeof text !== "string") return text;
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}
