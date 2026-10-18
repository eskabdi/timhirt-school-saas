// Handling Supabase Auth (GoTrue) errors in every Edge Function that calls
// the Auth admin API (invite-tenant-admin, onboard-tenant, invite-staff,
// provision-portal-accounts), so the rules live in one tested place.

/** Log-safe form of a thrown error: Auth errors can quote the email address
 *  they were about, so they are logged by code only (privacy review, WP-01
 *  round 3); other errors keep their message. Never throws, so a catch block
 *  always reaches its rollback. */
export function logSafeError(err: unknown): Record<string, string> {
  const e = (typeof err === "object" && err !== null ? err : {}) as { name?: unknown; code?: unknown; message?: unknown };
  if (typeof e.name === "string" && e.name.startsWith("Auth")) {
    return { auth_error: typeof e.code === "string" ? e.code : "unknown" };
  }
  return { message: typeof e.message === "string" ? e.message : String(err) };
}

/** GoTrue's own limits answer 429; the per-address one says "you can only
 *  request this after N seconds". */
export function isRateLimited(err: unknown): boolean {
  const e = (typeof err === "object" && err !== null ? err : {}) as { status?: unknown; message?: unknown };
  return e.status === 429 || (typeof e.message === "string" && /rate limit|request this after/i.test(e.message));
}
