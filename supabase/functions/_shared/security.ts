// ============================================================================
// Shared Edge Function security middleware (INSA §5)
// - JWT authentication (user-scoped client → RLS applies to lookups)
// - Role authorization (Least Privilege)
// - Zod allow-list validation helpers
// - Generic client errors; detailed logs server-side only (no PII/salaries)
// - Token-bucket rate limiting (in-memory per-isolate; swap for Upstash in prod)
// ============================================================================
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// Every function is called cross-origin (Vercel frontend -> supabase.co), and
// any POST with a JSON body triggers a CORS preflight (OPTIONS) regardless of
// verify_jwt — application/json isn't a CORS-safelisted content type. Without
// these headers on every response (preflight AND the real one), the browser
// rejects the response before the caller's code ever sees it and fetch()
// throws a bare "Failed to fetch" with no further detail.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });

export const errors = {
  badRequest: () => json({ error: "Invalid request" }, 400),
  unauthorized: () => json({ error: "Unauthorized" }, 401),
  forbidden: () => json({ error: "Forbidden" }, 403),
  tooMany: (retry = 30) => json({ error: "Too many requests", retry_after_seconds: retry }, 429),
  internal: () => json({ error: "An unexpected error occurred" }, 500),
};

export interface AuthContext {
  userId: string;
  role: string;
  tenantId: string | null;
  userClient: SupabaseClient;   // RLS applies
  adminClient: SupabaseClient;  // service_role — server-side only
}

/** Authenticate the caller and enforce an allowed-roles list. */
export async function requireRole(
  req: Request,
  allowed: string[],
): Promise<AuthContext | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return errors.unauthorized();

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await adminClient
    .from("users").select("role, tenant_id").eq("id", user.id).maybeSingle();
  if (!profile || !allowed.includes(profile.role)) return errors.forbidden();

  return {
    userId: user.id,
    role: profile.role,
    tenantId: profile.tenant_id,
    userClient,
    adminClient,
  };
}

/**
 * Minimal token bucket: `limit` requests per `windowMs` per key.
 *
 * ⚠️ LOW-priority known limitation: this Map is per-isolate / per-instance
 * memory. Supabase Edge Functions can scale to multiple concurrent isolates,
 * so under load a caller can get up to N× the intended limit (N = number of
 * warm isolates handling their requests), and every cold start resets the
 * count to zero. This is acceptable for the current scale (deters casual
 * scripted abuse on /submit-admission and /verify-id) but is NOT a durable
 * guarantee. Before scaling beyond a single-region / low-traffic deployment,
 * back this with a shared store — Upstash Redis (INCR + PEXPIRE) or a
 * Postgres `rate_limits(key, window_start, count)` table with an atomic
 * upsert — so the limit holds across isolates and survives cold starts.
 */
const buckets = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Timing-safe HMAC-SHA256 verification for webhooks. */
export async function verifyHmac(payload: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

/**
 * Reads a third-party credential (Chapa/Telebirr/Stripe secret keys, SMS
 * gateway API keys) preferring Supabase Vault — written via the
 * manage-integration-credentials Edge Function, super_admin self-service —
 * and falling back to a `Deno.env.get()` value if Vault has nothing under
 * that name. This makes credential configuration additive: an infra team
 * that prefers `supabase secrets set` keeps working unmodified, while a
 * super_admin without CLI/infra access can configure the same provider
 * entirely through the UI. `adminClient` must be a service_role client —
 * `vault.decrypted_secrets` is not readable by any other role.
 */
export async function getCredential(
  adminClient: SupabaseClient, secretName: string, envFallbackVar?: string,
): Promise<string | null> {
  const { data } = await adminClient.schema("vault").from("decrypted_secrets")
    .select("decrypted_secret").eq("name", secretName).maybeSingle();
  if (data?.decrypted_secret) return data.decrypted_secret as string;
  if (envFallbackVar) return Deno.env.get(envFallbackVar) ?? null;
  return null;
}
