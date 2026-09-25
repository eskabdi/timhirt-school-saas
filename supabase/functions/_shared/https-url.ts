// Bank-receipt verification URLs are stored and later rendered as links to
// staff, parents and super_admin. Only https is accepted: z.string().url()
// alone lets `javascript:` and `data:` through, which is a stored XSS once the
// value lands in an <a href> (R6 WP-00 review FS-1). Import-free, so the
// browser (src/lib/safeUrl.ts) and the Edge Functions share one rule.
//
// The literal prefix check matters: `new URL()` strips leading whitespace and
// embedded tabs/newlines, so " https://…" or "https:\n//…" parse as https but
// would be stored raw and then fail the database CHECK (`~* '^https://'`).
// Requiring the stored string itself to start with https:// keeps the two
// rules identical (review SR3-1).
export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/[^\s]+$/i.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
