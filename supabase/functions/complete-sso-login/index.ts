// ============================================================================
// [INSA category: INTERNAL] complete-sso-login
//
// Called once by SsoCallbackPage right after a SAML redirect completes and a
// session exists. Any authenticated caller, NOT role-gated via requireRole --
// by definition this runs before the caller has a public.users row, so
// requireRole's profile lookup would always 403 a legitimate first-time SSO
// user. Verifies the JWT directly instead (same first half requireRole does).
//
// Idempotent: if public.users already has a row for this auth id, this is a
// no-op success -- a page reload or a second login doesn't double-provision.
//
// Deliberately never reads a SAML attribute for role/permission decisions --
// this is the concrete mitigation for a misconfigured or malicious IdP
// claiming e.g. role=school_admin in an attribute. The only role this ever
// assigns is 'pending'; a school_admin promotes it afterward via
// activate-sso-user.
//
// Identity-linking edge case: GoTrue does NOT auto-link an SSO login to an
// existing password-based auth.users row by email (deliberately -- that
// would be an account-takeover vector via a spoofed IdP email claim), so a
// staff member who already has a password account and then logs in via
// newly-enabled SSO gets a DIFFERENT auth.users id for the same email.
// public.users.email is unique, so inserting a second row for that email
// would hit a raw 23505. Checked for explicitly below and turned into a
// clear "already registered via a different sign-in method" response
// instead of a crash.
// ============================================================================
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return errors.unauthorized();

    if (!(await rateLimit(`complete-sso:${user.id}`, 5, 60_000))) return errors.tooMany();

    const db = adminClient();

    const { data: existingById } = await db.from("users").select("id").eq("id", user.id).maybeSingle();
    if (existingById) return json({ status: "already_provisioned" }, 200);

    // getUserById is the documented, stable Admin API surface -- confirmed
    // this project's GoTrue omits is_sso_user entirely on a normal password
    // user's response rather than sending `false` explicitly, so it's
    // corroborated with the identities[].provider convention ("sso:<uuid>")
    // rather than trusted alone.
    const { data: adminUser, error: getErr } = await db.auth.admin.getUserById(user.id);
    if (getErr || !adminUser?.user) return errors.internal();
    const gotrueUser = adminUser.user;
    const isSso = gotrueUser.is_sso_user === true
      || (gotrueUser.identities ?? []).some((i: { provider?: string }) => i.provider?.startsWith("sso:"));
    if (!isSso) return errors.forbidden();

    const email = (gotrueUser.email ?? "").trim().toLowerCase();
    if (!email) return errors.internal();

    const { data: existingByEmail } = await db.from("users").select("id").eq("email", email).maybeSingle();
    if (existingByEmail) {
      return json({
        status: "email_conflict",
        error: "This email is already registered via a different sign-in method. Contact your school administrator.",
      }, 409);
    }

    const domain = email.split("@")[1];
    const { data: provider } = await db.from("tenant_sso_providers")
      .select("tenant_id").eq("domain", domain).eq("enabled", true).maybeSingle();
    if (!provider) return json({ status: "no_matching_tenant" }, 200);

    const fullName = (gotrueUser.user_metadata?.full_name as string | undefined)?.trim() || email.split("@")[0];

    const { error: insErr } = await db.from("users").insert({
      id: user.id, tenant_id: provider.tenant_id, role: "pending",
      full_name: fullName, email, locale: "en",
    });
    if (insErr) throw insErr;

    return json({ status: "provisioned" }, 200);
  } catch (err) {
    console.error("complete-sso-login failed", { message: (err as Error).message });
    return errors.internal();
  }
});
