// Handling Supabase Auth (GoTrue) errors in the Edge Functions that call the
// Auth admin API, so the rules live in one tested place.

/** What a caller is told when GoTrue's email limit is hit. */
export const RATE_LIMITED_MESSAGE = "Too many invite emails sent recently. Try again shortly.";

const isAuthError = (e: { name?: unknown }) => typeof e.name === "string" && e.name.startsWith("Auth");
const asRecord = (err: unknown) => (typeof err === "object" && err !== null ? err : {}) as Record<string, unknown>;

/** Log-safe form of a thrown error: Auth errors can quote the email address
 *  they were about, so they are logged by code only (privacy review, WP-01
 *  round 3); other errors keep their message. Never throws, so a catch block
 *  always reaches its rollback. */
export function logSafeError(err: unknown): Record<string, string> {
  const e = asRecord(err);
  if (isAuthError(e)) {
    // The HTTP status carries no personal data and tells a bad address from an outage.
    return { auth_error: typeof e.code === "string" ? e.code : "unknown", ...(typeof e.status === "number" ? { status: String(e.status) } : {}) };
  }
  return { message: typeof e.message === "string" ? e.message : String(err) };
}

/** GoTrue's own rate limits: HTTP 429, its stable codes, or (Auth errors only)
 *  the wording of the per-address cooldown ("only request this after N
 *  seconds"). A database or network error that happens to say "rate limit"
 *  is not one. */
export function isRateLimited(err: unknown): boolean {
  const e = asRecord(err);
  if (e.status === 429) return true;
  if (e.code === "over_email_send_rate_limit" || e.code === "over_request_rate_limit") return true;
  return isAuthError(e) && typeof e.message === "string" && /rate limit|request this after/i.test(e.message);
}
