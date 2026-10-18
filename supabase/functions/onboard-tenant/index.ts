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
import { rollbackTenant, type InvitedUser, type RollbackClient } from "../_shared/onboard-rollback.ts";
import { toEthiopian, toGregorian, todayAddis } from "../_shared/ethiopian-date.ts";
import { defaultPeriods } from "../_shared/default-periods.ts";
import { isRateLimited, logSafeError, RATE_LIMITED_MESSAGE } from "../_shared/auth-errors.ts";

const Payload = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/),
  // GoTrue stores addresses lower-case; so do we (state-concurrency review).
  admin_email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()),
  admin_full_name: z.string().trim().min(1).max(120),
  default_locale: z.enum(["en", "am", "om"]).default("am"),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let tenantId: string | undefined;
  let invited: InvitedUser | undefined;
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
    // Case-insensitive: older rows may hold mixed case (LIKE wildcards escaped).
    const { data: existingUser } = await db.from("users").select("id")
      .ilike("email", p.admin_email.replace(/[\\%_]/g, (m) => `\\${m}`)).limit(1).maybeSingle();
    if (existingUser) return json({ error: "This email is already registered to a user in the system." }, 400);

    const { data: tenant, error: tErr } = await db.from("tenants")
      .insert({ name: p.name, slug: p.slug, status: "trial" }).select("id").single();
    if (tErr) throw tErr;
    tenantId = tenant.id;

    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const inviteStartedAt = Date.now();
    const { data: invitedData, error: uErr } = await db.auth.admin.inviteUserByEmail(p.admin_email, {
      // school_name is shown in the invite email (supabase/templates/invite.html).
      data: { full_name: p.admin_full_name, school_name: p.name },
      redirectTo: `${appUrl}/accept-invite`,
    });
    if (uErr) throw uErr;
    invited = { id: invitedData.user.id, createdAt: invitedData.user.created_at, startedAt: inviteStartedAt };

    // Every write is checked: an ignored error used to leave a half-built
    // tenant (e.g. no tenant_configs row) that reported success and skipped
    // the rollback below (R6 WP-01 review SEC-WP01-2 / RG-1).
    const must = async (q: PromiseLike<{ error: unknown }>) => {
      const { error } = await q;
      if (error) throw error;
    };

    await must(db.from("users").insert({
      id: invited.id, tenant_id: tenantId, role: "school_admin",
      full_name: p.admin_full_name, email: p.admin_email, locale: p.default_locale,
    }));

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
    const ec = toEthiopian(todayAddis());
    const ecYear = ec.year;
    const startsOn = toGregorian({ year: ecYear, month: 1, day: 1 });
    const endsOn = toGregorian({ year: ecYear, month: 13, day: 5 });
    await must(db.from("academic_years").insert({
      tenant_id: tenantId, ec_year: ecYear,
      label_i18n: { en: `${ecYear} E.C.`, am: `${ecYear} ዓ.ም`, om: `Bara ${ecYear} ALI` },
      starts_on: startsOn.toISOString().slice(0, 10),
      ends_on: endsOn.toISOString().slice(0, 10),
      status: "active",
    }));

    // Calendar keys are snake_case (fix plan §0 Rule 8); the tenant_configs
    // trigger (20260925000002) normalises them either way.
    await must(db.from("tenant_configs").insert({
      tenant_id: tenantId,
      settings: {
        defaultLocale: p.default_locale,
        calendar: { secondary_visible: true, numerals: "latn", show_hijri: false },
        branding: { primaryColor: "#E8A317" },
      },
    }));

    // The default 8-period day (_shared/default-periods.ts); every row carries
    // is_break, or the bulk insert sends NULL for it.
    await must(db.from("periods").insert(defaultPeriods(tenant.id)));

    return json({ tenant_id: tenantId, ec_year: ecYear }, 201);
  } catch (err) {
    console.error("onboard-tenant failed", logSafeError(err));
    let rolledBack = true;
    if (tenantId) {
      const failed = await rollbackTenant(ctx.adminClient as unknown as RollbackClient, tenantId, invited);
      if (failed.length) console.error("onboard-tenant: rollback incomplete", { steps: failed });
      rolledBack = failed.length === 0;
    }
    // GoTrue's email limit, and nothing was kept: say to retry. After an
    // incomplete rollback a retry would only fail on the slug, so it is a 500.
    if (rolledBack && isRateLimited(err)) return json({ error: RATE_LIMITED_MESSAGE }, 429);
    return errors.internal();
  }
});
