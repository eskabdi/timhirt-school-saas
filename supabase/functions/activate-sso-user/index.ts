// ============================================================================
// [INSA category: INTERNAL] activate-sso-user
//
// school_admin-only. Fills a real gap: nothing else in this codebase can
// change another user's fixed `role` column -- users_self_update
// (20260713000005, hardened in 20260713000010) locks `role` even for
// self-edits via both the policy's WITH CHECK and the users_lock_identity
// trigger, and every existing provisioning path sets `role` once, at
// INSERT, service_role, never again. complete-sso-login JIT-provisions SSO
// users as role='pending' (zero access, by construction of every RLS policy
// in this codebase being default-deny); this is the only path that promotes
// them afterward.
//
// Deliberately narrow, not a general role-editor: only ever moves a target
// FROM role='pending' TO a real role, and only within the caller's own
// tenant -- rejects anything else outright rather than silently no-op'ing,
// so a caller gets a clear error instead of wondering why nothing happened.
//
// Confirmed with the user: role is capped to teacher/registrar/hr_officer/
// accountant/librarian -- school_admin/super_admin/pending are rejected,
// mirroring invite-staff's HR_OFFICER_ASSIGNABLE_ROLES restriction, so this
// can't become a lower-friction path to admin than the existing invite flow.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const ACTIVATABLE_ROLES = ["teacher", "registrar", "hr_officer", "accountant", "librarian"] as const;

const Payload = z.object({
  user_id: z.string().uuid(),
  role: z.enum(ACTIVATABLE_ROLES),
  staff_no: z.string().regex(/^[A-Z0-9\-/]{2,20}$/).optional(),
}).refine((p) => p.role !== "teacher" || !!p.staff_no, { message: "staff_no required for teachers" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["school_admin"]);
    if (ctx instanceof Response) return ctx;
    if (!ctx.tenantId) return errors.forbidden();
    if (!(await rateLimit(`activate-sso:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const db = ctx.adminClient;

    // Re-verify the target is pending and in this tenant, even though the
    // caller can only see their own tenant's pending users in the UI --
    // never trust that the client-supplied user_id wasn't tampered with.
    const { data: target } = await db.from("users")
      .select("id, tenant_id, role").eq("id", p.user_id).maybeSingle();
    if (!target || target.tenant_id !== ctx.tenantId || target.role !== "pending") {
      return json({ error: "No pending SSO user with that id was found in your tenant." }, 404);
    }

    if (p.role === "teacher" && p.staff_no) {
      const { data: dupStaffNo } = await db.from("teachers")
        .select("id").eq("tenant_id", ctx.tenantId).eq("staff_no", p.staff_no).maybeSingle();
      if (dupStaffNo) return json({ error: "This staff number is already in use." }, 400);
    }

    // teachers insert happens BEFORE the role flip, not after: if this
    // fails (e.g. a concurrent activation raced the staff_no check above),
    // role is still 'pending' and the whole request is safely retryable.
    // Doing it in the other order would leave role='teacher' with no
    // teachers row and no way back -- a second call would 404 immediately
    // since the target is no longer 'pending'.
    if (p.role === "teacher") {
      const { error: teacherErr } = await db.from("teachers")
        .insert({ tenant_id: ctx.tenantId, user_id: p.user_id, staff_no: p.staff_no });
      if (teacherErr) throw teacherErr;
    }

    const { error: updErr } = await db.from("users").update({ role: p.role }).eq("id", p.user_id);
    if (updErr) {
      // Roll back the just-inserted teachers row so the target stays fully
      // retryable at role='pending' instead of ending up with a teacher
      // profile row but no matching role.
      if (p.role === "teacher") {
        await db.from("teachers").delete().eq("tenant_id", ctx.tenantId).eq("user_id", p.user_id).catch(() => {});
      }
      throw updErr;
    }

    return json({ user_id: p.user_id, role: p.role }, 200);
  } catch (err) {
    console.error("activate-sso-user failed", { message: (err as Error).message });
    return errors.internal();
  }
});
