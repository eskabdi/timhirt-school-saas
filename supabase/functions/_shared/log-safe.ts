/** Log-safe form of a thrown error: Auth (GoTrue) errors can quote the email
 *  address they were about, so they are logged by code only (privacy review,
 *  WP-01 round 3); other errors keep their message. */
export function logSafeError(err: unknown): Record<string, string> {
  const e = err as { name?: string; code?: string; message?: string } | null;
  return e?.name?.startsWith("Auth") ? { auth_error: e.code ?? "unknown" } : { message: e?.message ?? String(err) };
}
