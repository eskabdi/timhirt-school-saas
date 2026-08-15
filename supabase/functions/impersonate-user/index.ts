// ============================================================================
// [INSA category: INTERNAL] impersonate-user — super_admin only.
//
// R4-D1: platform support needs to see exactly what a school_admin sees to
// diagnose a reported problem, without ever asking the tenant to share
// their own login. Mints a real session for the target user via GoTrue's
// admin.generateLink() (the documented "sign in as user" pattern — a
// magiclink token issued server-side, exchanged client-side via
// auth.verifyOtp(), never touching or resetting the target's password),
// but ONLY after the audit row is committed — if the audit insert fails,
// nothing is ever issued.
//
// Never impersonates another super_admin (checked server-side, not just
// hidden in the UI) -- this exists to see a TENANT's experience, not to
// quietly assume platform-staff authority.
//
// impersonation_sessions has no client insert/update policy at all
// (20260901000001) -- this function and end-impersonation are the only
// writers, both via service_role.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  target_user_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["super_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;

  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`impersonate-user:${ctx.userId}`, 10, 3_600_000))) return errors.tooMany(3600);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    if (p.target_user_id === ctx.userId) return errors.badRequest();

    const db = ctx.adminClient;
    const { data: target } = await db.from("users")
      .select("id, role, tenant_id, email, full_name").eq("id", p.target_user_id).maybeSingle();
    if (!target || !target.email) return errors.badRequest();
    if (target.role === "super_admin") return errors.forbidden();

    const { data: session, error: sErr } = await db.from("impersonation_sessions").insert({
      actor_id: ctx.userId,
      target_user_id: target.id,
      target_tenant_id: target.tenant_id,
      reason: p.reason,
    }).select("id").single();
    if (sErr) throw sErr;

    const { data: link, error: lErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    if (lErr || !link?.properties?.hashed_token) {
      // No session was actually established -- roll back the audit row
      // rather than leaving a record of an impersonation that never happened.
      await db.from("impersonation_sessions").delete().eq("id", session.id);
      throw lErr ?? new Error("generateLink returned no hashed_token");
    }

    return json({
      session_id: session.id,
      token_hash: link.properties.hashed_token,
      target_name: target.full_name,
      target_tenant_id: target.tenant_id,
    }, 200);
  } catch (err) {
    console.error("impersonate-user failed", { message: (err as Error).message });
    return errors.internal();
  }
});
