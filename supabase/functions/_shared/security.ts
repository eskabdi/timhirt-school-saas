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

// Shared between every path that assigns a school-issued staff number
// (invite-staff, activate-sso-user) so the two never silently drift apart.
export const STAFF_NO_REGEX = /^[A-Z0-9\-/]{2,20}$/;

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
 * Token bucket: `limit` requests per `windowMs` per key, held in Postgres.
 *
 * The counter lives in public.rate_limits and is advanced by the atomic
 * consume_rate_limit() RPC (migration 20260726000002), so the limit holds
 * across concurrent isolates and survives cold starts — an in-process Map gave
 * a caller up to N× the limit and reset to zero whenever an isolate recycled.
 *
 * Its own service_role client, memoised per isolate, because several callers
 * (verify-id, submit-admission, check-admission-status) rate-limit before they
 * have any client at all — the check has to run before that work happens.
 */
let limiterClient: SupabaseClient | null = null;
function rateLimitDb(): SupabaseClient {
  limiterClient ??= createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  return limiterClient;
}

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const { data, error } = await rateLimitDb()
    .rpc("consume_rate_limit", { p_key: key, p_limit: limit, p_window_ms: windowMs });
  if (error) {
    // Fail closed. Every endpoint behind this limiter needs the database for
    // its actual work, so denying on a limiter failure costs a request that
    // was going to fail anyway — while failing open would drop the control
    // precisely when the database is under stress.
    console.error("rateLimit unavailable — denying", { message: error.message });
    return false;
  }
  return data === true;
}

/** Timing-safe HMAC-SHA256 verification for webhooks.
 *  Signatures are compared as lowercase hex — providers differ on casing and a
 *  case difference is not a forgery. */
export async function verifyHmac(payload: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = signature.trim().toLowerCase();
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
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
