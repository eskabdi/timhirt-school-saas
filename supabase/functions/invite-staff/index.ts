// ============================================================================
// [INSA category: INTERNAL] invite-staff — school_admin only.
// Fills the gap that made the Teachers module unreachable: onboard-tenant /
// invite-tenant-admin only ever create school_admin accounts, and
// provision-portal-accounts only students/parents — there was NO path that
// created a login for a teacher (or registrar/hr_officer/accountant), so
// role-gated teacher pages and every is_teacher_of_class() RLS policy were
// dead code in practice.
//
// Same shape as invite-tenant-admin: pre-check the email against
// public.users BEFORE inviteUserByEmail (invite silently re-sends for an
// existing auth user — reaching the catch-block rollback would then delete
// a pre-existing account), invite -> users row -> teachers row (teacher
// role only; staff_no comes from the admin because schools typically carry
// staff numbers over from their HR/payroll records rather than minting new
// ones), roll back the auth user on any later failure. Tenant is ALWAYS
// the caller's own tenant — a school_admin cannot invite staff into
// another school.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  email: z.string().email().max(254),
  full_name: z.string().trim().min(1).max(120),
  role: z.enum(["teacher", "registrar", "hr_officer", "accountant"]),
  staff_no: z.string().regex(/^[A-Z0-9\-/]{2,20}$/).optional(),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
}).refine((p) => p.role !== "teacher" || !!p.staff_no, { message: "staff_no required for teachers" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  let invitedUserId: string | undefined;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!rateLimit(`invite-staff:${ctx.userId}`, 15, 60_000)) return errors.tooMany();
    if (!ctx.tenantId) return errors.forbidden();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const db = ctx.adminClient;

    const { data: existing } = await db.from("users").select("id").eq("email", p.email).maybeSingle();
    if (existing) return json({ error: "This email is already registered to a user in the system." }, 400);

    if (p.role === "teacher" && p.staff_no) {
      const { data: dupStaffNo } = await db.from("teachers")
        .select("id").eq("tenant_id", ctx.tenantId).eq("staff_no", p.staff_no).maybeSingle();
      if (dupStaffNo) return json({ error: "This staff number is already in use." }, 400);
    }

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(p.email, {
      data: { full_name: p.full_name },
      redirectTo: `${appUrl}/accept-invite`,
    });
    if (uErr) {
      if (/rate limit/i.test(uErr.message)) {
        return json({ error: "Too many invite emails sent recently. Try again shortly." }, 429);
      }
      throw uErr;
    }
    invitedUserId = invited.user.id;

    const { error: profileErr } = await db.from("users").insert({
      id: invitedUserId, tenant_id: ctx.tenantId, role: p.role,
      full_name: p.full_name, email: p.email, locale: p.default_locale,
    });
    if (profileErr) throw profileErr;

    if (p.role === "teacher") {
      const { error: teacherErr } = await db.from("teachers").insert({
        tenant_id: ctx.tenantId, user_id: invitedUserId, staff_no: p.staff_no,
      });
      if (teacherErr) throw teacherErr;
    }

    return json({ user_id: invitedUserId }, 201);
  } catch (err) {
    console.error("invite-staff failed", { message: (err as Error).message });
    if (invitedUserId) {
      await ctx.adminClient.auth.admin.deleteUser(invitedUserId).catch(() => {});
    }
    return errors.internal();
  }
});
