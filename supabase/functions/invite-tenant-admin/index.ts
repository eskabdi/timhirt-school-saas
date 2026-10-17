// ============================================================================
// [INSA category: INTERNAL] invite-tenant-admin — super_admin only (§5.3)
// Adds an additional school_admin to an EXISTING tenant. Distinct from
// onboard-tenant (which provisions a brand-new tenant + its first admin):
// this is the path for "this school needs a second admin" or "replace the
// admin who left" without touching the tenant row, config, or academic year.
// Uses inviteUserByEmail (not createUser) so the invitee actually receives an
// email with a magic link to set their own password, rather than being
// created with no way to ever sign in.
//
// Three actions (body.action):
//   invite (default) — invite a new school_admin to the tenant.
//   status           — which of the tenant's school_admins have not accepted
//                      their invite yet (auth.users is not readable from the
//                      browser, so the platform console asks here).
//   resend           — send a pending school_admin a fresh invite email (the
//                      old link is single-use and expires). Refused once the
//                      invite was accepted; at most 3 per admin per hour.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Invite = z.object({
  action: z.literal("invite").optional(),
  tenant_id: z.string().uuid(),
  // GoTrue stores addresses lower-case; so do we, and the duplicate check
  // below is case-insensitive (as in onboard-tenant).
  admin_email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
}).strict();
const Status = z.object({ action: z.literal("status"), tenant_id: z.string().uuid() }).strict();
const Resend = z.object({ action: z.literal("resend"), tenant_id: z.string().uuid(), user_id: z.string().uuid() }).strict();

const RATE_LIMITED = "Too many invite emails sent recently — Supabase's default email sender is rate-limited. "
  + "Try again shortly, or configure custom SMTP in the Supabase dashboard (Authentication -> Emails) for production use.";

/** Accepted = the invitee set a password (email confirmed) or has signed in. */
const isPending = (u: { email_confirmed_at?: string | null; last_sign_in_at?: string | null }) =>
  !u.email_confirmed_at && !u.last_sign_in_at;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["super_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  let invitedUserId: string | undefined;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`invite-admin:${ctx.userId}`, 10, 60_000))) return errors.tooMany();

    const body = await req.json().catch(() => null) as { action?: unknown } | null;
    const db = ctx.adminClient;
    // Without an explicit redirectTo, Supabase falls back to the project's
    // Site URL (Authentication -> URL Configuration). APP_URL must also be in
    // that project's redirect-URL allow-list, or Supabase rejects this value
    // and falls back to Site URL anyway.
    const appUrl = Deno.env.get("APP_URL") ?? "https://www.edux.et";
    const redirectTo = `${appUrl}/accept-invite`;

    // ---------------------------------------------------------------- status
    if (body?.action === "status") {
      const parsed = Status.safeParse(body);
      if (!parsed.success) return errors.badRequest();
      const { data: admins, error } = await db.from("users").select("id")
        .eq("tenant_id", parsed.data.tenant_id).eq("role", "school_admin").limit(50);
      if (error) throw error;
      const out = [];
      for (const a of admins ?? []) {
        const { data } = await db.auth.admin.getUserById(a.id);
        if (data?.user) out.push({ user_id: a.id, pending: isPending(data.user), invited_at: data.user.invited_at ?? null });
      }
      return json({ admins: out }, 200);
    }

    // ---------------------------------------------------------------- resend
    if (body?.action === "resend") {
      const parsed = Resend.safeParse(body);
      if (!parsed.success) return errors.badRequest();
      const { tenant_id, user_id } = parsed.data;
      const { data: tenant } = await db.from("tenants").select("id, name").eq("id", tenant_id).maybeSingle();
      const { data: profile } = await db.from("users").select("id, full_name")
        .eq("id", user_id).eq("tenant_id", tenant_id).eq("role", "school_admin").maybeSingle();
      if (!tenant || !profile) return errors.badRequest();
      const { data: authData, error: getErr } = await db.auth.admin.getUserById(user_id);
      if (getErr || !authData?.user?.email) return errors.badRequest();
      if (!isPending(authData.user)) {
        return json({ error: "This admin has already accepted the invite.", code: "already_accepted" }, 409);
      }
      if (!(await rateLimit(`resend-invite:${user_id}`, 3, 3_600_000))) return errors.tooMany();
      // For an address with an unconfirmed account, inviteUserByEmail sends a
      // fresh invite to that same account (a new single-use link).
      const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(authData.user.email, {
        data: { full_name: profile.full_name, school_name: tenant.name },
        redirectTo,
      });
      if (uErr) {
        if (/rate limit/i.test(uErr.message)) return json({ error: RATE_LIMITED }, 429);
        throw uErr;
      }
      if (invited.user.id !== user_id) throw new Error("resend returned a different user");
      console.log("invite-tenant-admin: invite resent", { tenant_id, user_id, by: ctx.userId });
      return json({ user_id, resent: true, invited_at: invited.user.invited_at ?? null }, 200);
    }

    // ---------------------------------------------------------------- invite
    const parsed = Invite.safeParse(body);
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const { data: tenant } = await db.from("tenants").select("id, name").eq("id", p.tenant_id).maybeSingle();
    if (!tenant) return errors.badRequest();

    // Check BEFORE inviting: inviteUserByEmail resends an invite (returning
    // the SAME existing user id) rather than erroring when the email already
    // has an auth account. If we let that reach the catch block below, the
    // rollback would delete that pre-existing user's account on a failed
    // profile insert -- a real destructive bug, not a "this email is taken"
    // message. Since every active account in this app has a matching
    // public.users row (§ the "chicken-and-egg" note in DEPLOYMENT.md),
    // checking there is enough to catch this before it ever calls invite.
    // (A pending admin of this school is re-invited with action "resend".)
    const { data: existing } = await db.from("users").select("id")
      .ilike("email", p.admin_email.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(1).maybeSingle();
    if (existing) return json({ error: "This email is already registered to a user in the system." }, 400);

    const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(p.admin_email, {
      // school_name is shown in the invite email (supabase/templates/invite.html).
      data: { full_name: p.admin_full_name, school_name: tenant.name },
      redirectTo,
    });
    if (uErr) {
      if (/rate limit/i.test(uErr.message)) return json({ error: RATE_LIMITED }, 429);
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
    // invitedUserId is set exclusively by the invite action above, and the
    // pre-check means we only reach here for a genuinely new user.
    if (invitedUserId) {
      await ctx.adminClient.auth.admin.deleteUser(invitedUserId);
    }
    return errors.internal();
  }
});
