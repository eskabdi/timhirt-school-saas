// ============================================================================
// [INSA category: INTERNAL] end-impersonation — super_admin only.
//
// R4-D1: closes out an impersonation_sessions row. Called AFTER the
// frontend has already restored the super_admin's own saved session (via
// auth.setSession()) -- requireRole's own auth.getUser() call is what
// proves the caller is genuinely back in their own identity again, not
// still riding the impersonated session, before this ever touches the
// audit row.
//
// Idempotent: calling this twice on an already-closed session is a no-op,
// not an error -- a retried request (flaky network on the "End
// impersonation" click) must not fail loudly for something already done.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({
  session_id: z.string().uuid(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["super_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;

  try {
    if (req.method !== "POST") return errors.badRequest();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    const db = ctx.adminClient;
    const { data: session } = await db.from("impersonation_sessions")
      .select("id, actor_id, ended_at").eq("id", p.session_id).maybeSingle();
    if (!session || session.actor_id !== ctx.userId) return errors.forbidden();

    if (!session.ended_at) {
      const { error } = await db.from("impersonation_sessions")
        .update({ ended_at: new Date().toISOString() }).eq("id", session.id);
      if (error) throw error;
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error("end-impersonation failed", { message: (err as Error).message });
    return errors.internal();
  }
});
