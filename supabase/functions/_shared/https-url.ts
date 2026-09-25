// Bank-receipt verification URLs are stored and later rendered as links to
// staff, parents and super_admin. Only https is accepted: z.string().url()
// alone lets `javascript:` and `data:` through, which is a stored XSS once the
// value lands in an <a href> (R6 WP-00 review FS-1). Import-free, so the
// browser (src/lib/safeUrl.ts) and the Edge Functions share one rule.
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
