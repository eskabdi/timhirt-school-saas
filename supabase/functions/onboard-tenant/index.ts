// ============================================================================
// [INSA category: INTERNAL] onboard-tenant — super_admin only (§5.3)
// Provisions: tenant row → invited school_admin auth user → profile row →
// default config + current EC academic year + default period grid. Rolls
// back on failure.
// Uses inviteUserByEmail (not createUser) so the invited admin actually
// receives an email with a link to set their own password — createUser
// with email_confirm:false creates an account nobody can ever sign into,
// since nothing else in this app sends that person any credentials.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { toEthiopian, toGregorian } from "../_shared/ethiopian-date.ts";

const Payload = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  admin_email: z.string().email().max(254),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let tenantId: string | undefined;
  const ctxOrRes = await requireRole(req, ["super_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`onboard:${ctx.userId}`, 5, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const db = ctx.adminClient;

    // Check before creating anything: inviteUserByEmail resends an invite
    // (returning the SAME existing user id) rather than erroring when the
    // email already has an account — inserting that id as this new tenant's
    // admin would collide with their existing public.users row and fail
    // with a confusing generic error instead of a clear one.
    const { data: existingUser } = await db.from("users").select("id").eq("email", p.admin_email).maybeSingle();
    if (existingUser) return json({ error: "This email is already registered to a user in the system." }, 400);

    const { data: tenant, error: tErr } = await db.from("tenants")
      .insert({ name: p.name, slug: p.slug, status: "trial" }).select("id").single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const { data: invited, error: uErr } = await db.auth.admin.inviteUserByEmail(p.admin_email, {
      data: { full_name: p.admin_full_name },
      redirectTo: `${appUrl}/accept-invite`,
    });
    if (uErr) throw uErr;

    await db.from("users").insert({
      id: invited.user.id, tenant_id: tenantId, role: "school_admin",
      full_name: p.admin_full_name, email: p.admin_email, locale: p.default_locale,
    });

    // Current EC academic year: Meskerem 1 → Pagume end (§17.5).
    // M-5 fix: previously added an ad-hoc "+1 if month >= 11" heuristic to
    // guess at "near year-end, seed next year instead" — but toEthiopian(now())
    // already IS the true current EC year by construction; "today" can never
    // be past its own year's Pagume end, so that heuristic was pure guesswork
    // that diverged from the canonical engine used everywhere else (§M-5).
    // Use the real current EC year directly. If product later wants "seed
    // next year's academic year when onboarding late in the current EC year"
    // as a UX feature, make it an explicit opt-in field on the onboarding
    // payload (e.g. `seed_next_year: boolean`) — a visible decision, not
    // hidden date-based magic.
    const ec = toEthiopian(new Date());
    const ecYear = ec.year;
    const startsOn = toGregorian({ year: ecYear, month: 1, day: 1 });
    const endsOn = toGregorian({ year: ecYear, month: 13, day: 5 });
    await db.from("academic_years").insert({
      tenant_id: tenantId, ec_year: ecYear,
      label_i18n: { en: `${ecYear} E.C.`, am: `${ecYear} ዓ.ም`, om: `Bara ${ecYear} ALI` },
      starts_on: startsOn.toISOString().slice(0, 10),
      ends_on: endsOn.toISOString().slice(0, 10),
      status: "active",
    });

    await db.from("tenant_configs").insert({
      tenant_id: tenantId,
      settings: {
        defaultLocale: p.default_locale,
        calendar: { secondaryVisible: true, geezNumerals: false },
        branding: { primaryColor: "#E8A317" },
      },
    });

    // Same default 8-period day 20260802000006 backfilled onto every tenant
    // that already existed when it ran -- a tenant onboarded after that
    // migration needs the same seed here, or Timetable Editor opens to a
    // grid with no period rows to place anything into.
    await db.from("periods").insert([
      { tenant_id: tenantId, period_no: 1, label: "Period 1", starts_at: "08:30", ends_at: "09:10" },
      { tenant_id: tenantId, period_no: 2, label: "Period 2", starts_at: "09:10", ends_at: "09:50" },
      { tenant_id: tenantId, period_no: 3, label: "Period 3", starts_at: "09:50", ends_at: "10:30" },
      { tenant_id: tenantId, period_no: 4, label: "Period 4", starts_at: "10:30", ends_at: "11:10" },
      { tenant_id: tenantId, period_no: 5, label: "Break", starts_at: "11:10", ends_at: "11:30", is_break: true },
      { tenant_id: tenantId, period_no: 6, label: "Period 5", starts_at: "11:30", ends_at: "12:10" },
      { tenant_id: tenantId, period_no: 7, label: "Period 6", starts_at: "12:10", ends_at: "12:50" },
      { tenant_id: tenantId, period_no: 8, label: "Period 7", starts_at: "12:50", ends_at: "13:30" },
      { tenant_id: tenantId, period_no: 9, label: "Period 8", starts_at: "13:30", ends_at: "14:10" },
    ]);

    return json({ tenant_id: tenantId, ec_year: ecYear }, 201);
  } catch (err) {
    console.error("onboard-tenant failed", { message: (err as Error).message });
    if (tenantId) {
      await ctx.adminClient.from("tenants").delete().eq("id", tenantId); // rollback
    }
    return errors.internal();
  }
});
