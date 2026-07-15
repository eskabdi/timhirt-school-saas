// ============================================================================
// [INSA category: INTERNAL] invite-tenant-admin — super_admin only (§5.3)
// Adds an additional school_admin to an EXISTING tenant. Distinct from
// onboard-tenant (which provisions a brand-new tenant + its first admin):
// this is the path for "this school needs a second admin" or "replace the
// admin who left" without touching the tenant row, config, or academic year.
// Uses inviteUserByEmail (not createUser) so the invitee actually receives an
// email with a magic link to set their own password, rather than being
// created with no way to ever sign in.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  tenant_id: z.string().uuid(),
  admin_email: z.string().email().max(254),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["super_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  let invitedUserId: string | undefined;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!rateLimit(`invite-admin:${ctx.userId}`, 10, 60_000)) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const db = ctx.adminClient;

    const { data: tenant } = await db.from("tenants").select("id").eq("id", p.tenant_id).maybeSingle();
    if (!tenant) return errors.badRequest();

    // Check BEFORE inviting: inviteUserByEmail resends an invite (returning
    // the SAME existing user id) rather than erroring when the email already
    // has an auth account. If we let that reach the catch block below, the
    // rollback would delete that pre-existing user's account on a failed
    // profile insert -- a real destructive bug, not a "this email is taken"
    // message. Since every active account in this app has a matching
    // public.users row (§ the "chicken-and-egg" note in DEPLOYMENT.md),
    // checking there is enough to catch this before it ever calls invite.
    const { data: existing } = await db.from("users").select("id").eq("email", p.admin_email).maybeSingle();
    if (existing) return json({ error: "This email is already registered to a user in the system." }, 400);

    // Without an explicit redirectTo, Supabase falls back to the project's
    // Site URL (Authentication -> URL Configuration) -- which defaults to
    // http://localhost:3000 on a fresh project and silently sends every
    // invite link there instead of the deployed app. APP_URL must also be
    // added to that project's redirect-URL allow-list, or Supabase rejects
    // this value and falls back to Site URL anyway.
    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(p.admin_email, {
      data: { full_name: p.admin_full_name },
      redirectTo: `${appUrl}/accept-invite`,
    });
    if (uErr) {
      if (/rate limit/i.test(uErr.message)) {
        return json({
          error: "Too many invite emails sent recently — Supabase's default email sender is rate-limited. "
            + "Try again shortly, or configure custom SMTP in the Supabase dashboard (Authentication -> Emails) for production use.",
        }, 429);
      }
      throw uErr;
    }
    invitedUserId = invited.user.id;

    const { error: profileErr } = await db.from("users").insert({
      id: invitedUserId, tenant_id: p.tenant_id, role: "school_admin",
      full_name: p.admin_full_name, email: p.admin_email, locale: p.default_locale,
    });
    if (profileErr) throw profileErr;

    return json({ user_id: invitedUserId, tenant_id: p.tenant_id }, 201);
  } catch (err) {
    console.error("invite-tenant-admin failed", { message: (err as Error).message });
    // Only roll back an auth user we just created ourselves this call --
    // invitedUserId is set exclusively by the inviteUserByEmail call above,
    // and the pre-check means we only reach here for a genuinely new user.
    if (invitedUserId) {
      await ctx.adminClient.auth.admin.deleteUser(invitedUserId);
    }
    return errors.internal();
  }
});
