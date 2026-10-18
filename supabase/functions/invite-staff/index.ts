// ============================================================================
// [INSA category: INTERNAL] invite-staff — school_admin or hr_officer.
// Fills the gap that made the Teachers module unreachable: onboard-tenant /
// invite-tenant-admin only ever create school_admin accounts, and
// provision-portal-accounts only students/parents — there was NO path that
// created a login for a teacher (or registrar/hr_officer/accountant), so
// role-gated teacher pages and every is_teacher_of_class() RLS policy were
// dead code in practice.
//
// hr_officer is allowed alongside school_admin: StaffRegistrationPage is
// route-gated to exactly those two roles (router.tsx's HR guard), and its
// "also invite to portal" step calls this function directly. Restricting
// this to school_admin left the wizard's own stated persona unable to
// complete the invite it defaults to sending, with no recovery path in the
// product short of a school_admin re-running it by hand.
//
// That widening only covers WHO may call this function, not WHICH role the
// caller may hand out — those are different questions. An hr_officer caller
// is capped to teacher/registrar (HR_OFFICER_ASSIGNABLE_ROLES below); only
// school_admin may mint hr_officer or accountant accounts. Before hr_officer
// was allowed to call this function at all, that was implicit (school_admin
// was the only caller, full stop); adding a second caller role without also
// scoping what it can grant would have let any hr_officer mint themselves
// unlimited hr_officer/accountant peers via a service-role write that RLS
// never sees (public.users has no authenticated INSERT policy — this insert
// bypasses RLS entirely by design, so this check is the only backstop).
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
import { requireRole, errors, json, rateLimit, corsHeaders, STAFF_NO_REGEX } from "../_shared/security.ts";
import { isRateLimited, logSafeError, RATE_LIMITED_MESSAGE } from "../_shared/auth-errors.ts";
import { createdByThisCall, escapeLike, rollbackInvitedUser, type InviteRollbackClient } from "../_shared/invite-guard.ts";

const Payload = z.object({
  // GoTrue stores addresses lower-case; so do we, and the duplicate check
  // below is case-insensitive (as in invite-tenant-admin and onboard-tenant):
  // a case-only variant of an existing address used to pass the check, get
  // that existing account back from inviteUserByEmail, and have the rollback
  // delete it.
  email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  full_name: z.string().trim().min(1).max(120),
  role: z.enum(["teacher", "registrar", "hr_officer", "accountant", "librarian"]),
  staff_no: z.string().regex(STAFF_NO_REGEX).optional(),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
  // grade_cycles.key (20260814000001) -- optional; a teacher with none set
  // stays unrestricted by enforce_teacher_cycle() (20260819000001).
  teaching_cycle_key: z.enum(["first_cycle", "second_cycle", "lower_secondary", "upper_secondary"]).optional(),
}).refine((p) => p.role !== "teacher" || !!p.staff_no, { message: "staff_no required for teachers" });

// An hr_officer may onboard the staff they directly manage; only school_admin
// grants roles with HR/financial administration rights over the school itself.
const HR_OFFICER_ASSIGNABLE_ROLES = new Set(["teacher", "registrar"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "hr_officer"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  let invitedUserId: string | undefined;
  let profileInserted = false;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`invite-staff:${ctx.userId}`, 15, 60_000))) return errors.tooMany();
    if (!ctx.tenantId) return errors.forbidden();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    if (ctx.role === "hr_officer" && !HR_OFFICER_ASSIGNABLE_ROLES.has(p.role)) return errors.forbidden();
    const db = ctx.adminClient;

    // Fail closed: an unverified duplicate check must never lead to an invite.
    const { data: existing, error: existErr } = await db.from("users").select("id")
      .ilike("email", escapeLike(p.email)).limit(1).maybeSingle();
    if (existErr) throw existErr;
    if (existing) return json({ error: "This email is already registered to a user in the system." }, 400);

    if (p.role === "teacher" && p.staff_no) {
      const { data: dupStaffNo, error: dupErr } = await db.from("teachers")
        .select("id").eq("tenant_id", ctx.tenantId).eq("staff_no", p.staff_no).maybeSingle();
      if (dupErr) throw dupErr;   // fail closed: never invite on an unverified check
      if (dupStaffNo) return json({ error: "This staff number is already in use." }, 400);
    }

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const inviteStartedAt = Date.now();
    const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(p.email, {
      data: { full_name: p.full_name },
      redirectTo: `${appUrl}/accept-invite`,
    });
    if (uErr) {
      if (isRateLimited(uErr)) {
        return json({ error: RATE_LIMITED_MESSAGE }, 429);
      }
      throw uErr;
    }
    // An auth account that already existed (no profile, or one a concurrent
    // request is creating) is never adopted, and so never rolled back.
    if (!createdByThisCall(invited.user.created_at, inviteStartedAt)) return json({ error: "This email is already registered to a user in the system." }, 400);
    invitedUserId = invited.user.id;

    const { error: profileErr } = await db.from("users").insert({
      id: invitedUserId, tenant_id: ctx.tenantId, role: p.role,
      full_name: p.full_name, email: p.email, locale: p.default_locale,
    });
    if (profileErr) throw profileErr;
    profileInserted = true;

    if (p.role === "teacher") {
      const { error: teacherErr } = await db.from("teachers").insert({
        tenant_id: ctx.tenantId, user_id: invitedUserId, staff_no: p.staff_no,
        teaching_cycle_key: p.teaching_cycle_key ?? null,
      });
      if (teacherErr) throw teacherErr;
    }

    return json({ user_id: invitedUserId }, 201);
  } catch (err) {
    console.error("invite-staff failed", logSafeError(err));
    if (invitedUserId) {
      await rollbackInvitedUser(ctx.adminClient as unknown as InviteRollbackClient, invitedUserId, profileInserted, "invite-staff");
    }
    return errors.internal();
  }
});
