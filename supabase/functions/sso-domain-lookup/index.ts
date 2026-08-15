// ============================================================================
// [INSA category: PUBLIC] sso-domain-lookup
//
// LoginPage calls this before showing the password field -- if the entered
// email's domain has SAML SSO configured for a tenant, the page redirects to
// the IdP instead. Public and unauthenticated by necessity (there is no
// session yet), same category as check-login-attempt.
//
// Response is deliberately minimal ({ sso: boolean } only, no domain/tenant
// name/provider details) -- which domains have SSO configured is not secret,
// but there's no reason to hand back more than the one bit the caller needs,
// and doing so would make this a slightly better tenant-enumeration oracle
// than it has to be.
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ email: z.string().email().max(254) });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const email = parsed.data.email.trim().toLowerCase();
    const domain = email.split("@")[1];
    if (!domain) return errors.badRequest();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!(await rateLimit(`sso-lookup:ip:${ip}`, 20, 60_000))) return errors.tooMany();

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await db.from("tenant_sso_providers")
      .select("id").eq("domain", domain).eq("enabled", true).maybeSingle();

    return json({ sso: !!data }, 200);
  } catch (err) {
    console.error("sso-domain-lookup failed", { message: (err as Error).message });
    return errors.internal();
  }
});
