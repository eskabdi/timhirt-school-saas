// ============================================================================
// [INSA category: PUBLIC] verify-id
// H-2 fix: the ID/certificate verification RPC was being called directly
// from the browser with the anon key — no rate limiting existed despite the
// comment claiming otherwise, and verify_id_card() was callable by anon
// directly, making verify_code enumerable across every tenant (leaking
// subject_type, issued_on, tenant_name per guess). This function is now the
// only caller: it rate-limits by IP, validates the code shape, and invokes
// the RPC with service_role (anon's execute grant is revoked in migration
// 010). verify_code is required to be >= 24 chars (constraint in 010),
// making brute-force guessing computationally infeasible even without the
// rate limit — the rate limit is defense in depth against scripted scans.
// ============================================================================
import { z } from "npm:zod@3";
import { createClient } from "npm:@supabase/supabase-js@2";
import { errors, json, rateLimit } from "../_shared/security.ts";

const Payload = z.object({ code: z.string().min(1).max(64) });

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return errors.badRequest();

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!rateLimit(`verify:${ip}`, 20, 60_000)) return errors.tooMany(60);

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await db.rpc("verify_id_card", { p_code: parsed.data.code });
    if (error) throw error;

    const result = data?.[0] ?? { valid: false };
    return json(result, 200);
  } catch (err) {
    console.error("verify-id failed", { message: (err as Error).message });
    return errors.internal();
  }
});
