// ============================================================================
// [INSA category: INTERNAL] provision-portal-accounts
// AuthZ: school_admin / registrar. Given a newly-enrolled student, creates
// (or links, if one already exists) the auth accounts that let the student
// and their guardian sign into the portal — students.user_id and
// guardians.user_id both exist as columns already but nothing in this
// codebase ever populated them before this function.
//
// Two onboarding paths, chosen per record:
//  - A real email on file (only ever true for a guardian; students don't
//    give one at admission) -> inviteUserByEmail, same magic-link ->
//    /accept-invite flow as invite-tenant-admin. They set their own
//    password and nothing sensitive crosses this API.
//  - No email (the common case for a K-12 student, and for a guardian who
//    didn't give one) -> admin.createUser() with a synthetic
//    {handle}@{tenant_slug}.portal.local address and a generated temporary
//    password, returned once in this response for the office to hand to
//    the family (there is no inbox behind that address to email a link
//    to). This is a genuinely different pattern from every other invite
//    flow in this codebase, which is why it's spelled out here rather than
//    silently reusing inviteUserByEmail.
//
// Same "check for an existing users row before creating" pre-check as
// invite-tenant-admin, extended to the synthetic-email path too: a guardian
// with more than one child enrolled must land on the SAME account, not a
// second one that collides on the unique users.email constraint.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ student_id: z.string().uuid() });

const PW_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
function generateTempPassword(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PW_ALPHABET[b % PW_ALPHABET.length]).join("");
}

function slugifyLocalPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "user";
}

interface AccountResult {
  kind: "student" | "guardian";
  method: "password" | "email_invite" | "existing_account";
  email: string;
  temp_password?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "registrar"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  const db = ctx.adminClient;
  const createdAuthUserIds: string[] = [];

  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`provision-portal:${ctx.userId}`, 20, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();

    const { data: student } = await ctx.userClient.from("students")
      .select("id, tenant_id, user_id, first_name, middle_name, last_name, admission_no")
      .eq("id", parsed.data.student_id).maybeSingle();
    if (!student) return errors.badRequest();

    const { data: tenant } = await ctx.userClient.from("tenants").select("slug").eq("id", student.tenant_id).maybeSingle();
    if (!tenant) return errors.badRequest();

    const { data: guardians } = await ctx.userClient.from("guardians")
      .select("id, user_id, relationship, phone, email").eq("student_id", student.id);

    // guardians has no name column (relationship/phone/email only) — the name
    // given at application time lives on admission_applications, so fall back
    // to it for the invite email's display name; a plain "Guardian" if this
    // student wasn't created through the enrollment bridge at all.
    const { data: application } = await ctx.userClient.from("admission_applications")
      .select("guardian_name").eq("converted_student_id", student.id).maybeSingle();
    const guardianName = application?.guardian_name ?? "Guardian";

    const alreadyDone = !!student.user_id && (guardians ?? []).every((g) => !!g.user_id);
    if (alreadyDone) return json({ already_provisioned: true, accounts: [] }, 200);

    const fullName = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(" ");
    const appUrl = Deno.env.get("APP_URL") ?? "https://timhirt-school-saas.vercel.app";
    const accounts: AccountResult[] = [];

    if (!student.user_id) {
      const email = `student-${slugifyLocalPart(student.admission_no)}@${tenant.slug}.portal.local`;
      const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
      if (existing) {
        await db.from("students").update({ user_id: existing.id }).eq("id", student.id);
        accounts.push({ kind: "student", method: "existing_account", email });
      } else {
        const tempPassword = generateTempPassword();
        const { data: created, error: cErr } = await db.auth.admin.createUser({
          email, password: tempPassword, email_confirm: true,
          user_metadata: { full_name: fullName },
        });
        if (cErr) throw cErr;
        createdAuthUserIds.push(created.user.id);
        const { error: profileErr } = await db.from("users").insert({
          id: created.user.id, tenant_id: student.tenant_id, role: "student",
          full_name: fullName, email, locale: "en",
        });
        if (profileErr) throw profileErr;
        await db.from("students").update({ user_id: created.user.id }).eq("id", student.id);
        accounts.push({ kind: "student", method: "password", email, temp_password: tempPassword });
      }
    }

    for (const g of guardians ?? []) {
      if (g.user_id) continue;

      if (g.email) {
        const { data: existing } = await db.from("users").select("id").eq("email", g.email).maybeSingle();
        if (existing) {
          await db.from("guardians").update({ user_id: existing.id }).eq("id", g.id);
          accounts.push({ kind: "guardian", method: "existing_account", email: g.email });
          continue;
        }
        const { data: invited, error: iErr } = await db.auth.admin.inviteUserByEmail(g.email, {
          data: { full_name: guardianName },
          redirectTo: `${appUrl}/accept-invite`,
        });
        if (iErr) {
          if (/rate limit/i.test(iErr.message)) {
            return json({ error: "Too many invite emails sent recently. Try again shortly." }, 429);
          }
          throw iErr;
        }
        createdAuthUserIds.push(invited.user.id);
        const { error: profileErr } = await db.from("users").insert({
          id: invited.user.id, tenant_id: student.tenant_id, role: "parent",
          full_name: guardianName, email: g.email, locale: "en",
        });
        if (profileErr) throw profileErr;
        await db.from("guardians").update({ user_id: invited.user.id }).eq("id", g.id);
        accounts.push({ kind: "guardian", method: "email_invite", email: g.email });
      } else {
        const email = `guardian-${slugifyLocalPart(g.phone ?? student.admission_no)}@${tenant.slug}.portal.local`;
        const { data: existing } = await db.from("users").select("id").eq("email", email).maybeSingle();
        if (existing) {
          await db.from("guardians").update({ user_id: existing.id }).eq("id", g.id);
          accounts.push({ kind: "guardian", method: "existing_account", email });
          continue;
        }
        const tempPassword = generateTempPassword();
        const { data: created, error: cErr } = await db.auth.admin.createUser({
          email, password: tempPassword, email_confirm: true,
          user_metadata: { full_name: guardianName },
        });
        if (cErr) throw cErr;
        createdAuthUserIds.push(created.user.id);
        const { error: profileErr } = await db.from("users").insert({
          id: created.user.id, tenant_id: student.tenant_id, role: "parent",
          full_name: guardianName, email, locale: "en",
        });
        if (profileErr) throw profileErr;
        await db.from("guardians").update({ user_id: created.user.id }).eq("id", g.id);
        accounts.push({ kind: "guardian", method: "password", email, temp_password: tempPassword });
      }
    }

    return json({ already_provisioned: false, accounts }, 201);
  } catch (err) {
    console.error("provision-portal-accounts failed", { message: (err as Error).message });
    for (const id of createdAuthUserIds) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
    return errors.internal();
  }
});
