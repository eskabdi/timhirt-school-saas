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
// ============================================================================
import { z } from "npm:zod@3";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ email: z.string().email().max(254) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const email = parsed.data.email.trim().toLowerCase();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

    // 5 attempts / 15 min per account, 20 attempts / 15 min per IP. Both run
    // (not short-circuited) so a blocked IP still burns the email bucket too
    // — otherwise an attacker could learn which gate tripped by which retry
    // recovers first.
    const emailOk = await rateLimit(`login:email:${email}`, 5, 15 * 60_000);
    const ipOk = await rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);

    if (!emailOk || !ipOk) return errors.tooMany(15 * 60);
    return json({ allowed: true }, 200);
  } catch (err) {
    console.error("check-login-attempt failed", { message: (err as Error).message });
    return errors.internal();
  }
});
