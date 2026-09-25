// Stored, user-supplied URLs are rendered as links only when they are https
// (R6 WP-00 review FS-1): anything else, including a legacy `javascript:` value,
// renders as plain text. Same rule as the Edge Functions' input check.
import { isHttpsUrl } from "../../supabase/functions/_shared/https-url";

export function httpsHref(value: string | null | undefined): string | null {
  return value && isHttpsUrl(value) ? value : null;
}
