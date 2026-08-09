// ============================================================================
// [INSA category: PUBLIC] check-login-attempt
//
// LoginPage calls this before every supabase.auth.signInWithPassword() —
// GoTrue itself has no per-application "N tries then lock" policy exposed to
// this app, and rate-limiting the login *button* client-side is trivially
// bypassed (call the SDK directly). This is the only server-side gate: it
// consumes a token from the same Postgres-backed rate_limits store used by
// submit-admission/verify-id (migration 20260726000002) before the caller is
// allowed to even attempt a sign-in, keyed by both the normalized email
// (stops repeated guesses against one account) and the caller's IP (stops
// one source spraying attempts across many emails). Either bucket tripping
// blocks the attempt.
//
// Thresholds come from public.system_config (20260806000001), set by a
// super_admin at /platform/security -- read fresh on every call (no cache)
// so a policy change is effective immediately, not just for isolates that
// cold-start after the edit.
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ email: z.string().email().max(254) });

const DEFAULTS = {
  login_max_attempts: 5, login_attempt_window_minutes: 15,
  login_ip_max_attempts: 20, login_ip_window_minutes: 15,
};

async function loadThresholds(): Promise<typeof DEFAULTS> {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await db.from("system_config")
    .select("key,value").is("tenant_id", null).in("key", Object.keys(DEFAULTS));
  const out = { ...DEFAULTS };
  for (const row of data ?? []) {
    const n = Number(row.value);
    if (Number.isFinite(n) && n > 0 && row.key in out) (out as Record<string, number>)[row.key] = n;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const email = parsed.data.email.trim().toLowerCase();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const t = await loadThresholds();

    // Both run (not short-circuited) so a blocked IP still burns the email
    // bucket too — otherwise an attacker could learn which gate tripped by
    // which retry recovers first.
    const emailOk = await rateLimit(`login:email:${email}`, t.login_max_attempts, t.login_attempt_window_minutes * 60_000);
    const ipOk = await rateLimit(`login:ip:${ip}`, t.login_ip_max_attempts, t.login_ip_window_minutes * 60_000);

    if (!emailOk || !ipOk) return errors.tooMany(Math.max(t.login_attempt_window_minutes, t.login_ip_window_minutes) * 60);
    return json({ allowed: true }, 200);
  } catch (err) {
    console.error("check-login-attempt failed", { message: (err as Error).message });
    return errors.internal();
  }
});
