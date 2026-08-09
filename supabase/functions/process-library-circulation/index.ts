// ============================================================================
// [INSA category: PRIVATE] process-library-circulation
// AuthZ: school_admin / librarian. action-discriminated, mirrors
// enroll-finalize-billing's shape: checkout/return/renew/bulk_return need an
// atomic availability check + cross-table write beyond what RLS alone can
// express, so the actual mutation runs inside a security-definer Postgres
// function (library_checkout/library_return/library_renew/library_bulk_return,
// migration 20260813000002) called via ctx.adminClient -- this function's own
// requireRole() is the authorization layer, the RPC is the atomicity layer.
//
// place_hold/cancel_hold/scan_overdue/bulk_rent are simple enough (a single
// conditional write, or a loop of already-atomic checkout RPC calls) that
// they talk to ctx.adminClient directly without a dedicated RPC each.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders, type AuthContext } from "../_shared/security.ts";

type AdminClient = AuthContext["adminClient"];

const Payload = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("checkout"),
    copy_id: z.string().uuid(),
    student_id: z.string().uuid(),
    checkout_type: z.enum(["lending", "rental"]).default("lending"),
  }),
  z.object({ action: z.literal("return"), checkout_id: z.string().uuid() }),
  z.object({ action: z.literal("renew"), checkout_id: z.string().uuid() }),
  z.object({ action: z.literal("place_hold"), book_id: z.string().uuid(), student_id: z.string().uuid() }),
  z.object({ action: z.literal("cancel_hold"), hold_id: z.string().uuid() }),
  z.object({ action: z.literal("scan_overdue") }),
  z.object({
    action: z.literal("bulk_rent"),
    class_id: z.string().uuid(),
    book_ids: z.array(z.string().uuid()).min(1).max(50),
  }),
  z.object({ action: z.literal("bulk_return"), class_id: z.string().uuid() }),
]);

// Ethiopia observes a single fixed UTC+3 offset year-round (no DST), so the
// local calendar date is just "UTC now + 3 hours" -- no timezone-database
// lookup needed. Reading new Date().toISOString() directly (UTC) instead
// compares against yesterday's date for the first ~3 hours after local
// midnight, silently missing same-day overdue/fine transitions.
function todayLocal(): string {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const KNOWN_LIBRARY_ERRORS = [
  "copy_not_found", "copy_not_available", "copy_reserved_for_hold",
  "checkout_limit_reached", "checkout_not_active", "not_renewable",
  "renewal_limit_reached", "hold_waiting",
];

/** Maps a raised exception from one of the library_* RPCs to a friendly 400,
 *  falling back to a generic 500 for anything unrecognized. */
function mapLibraryError(error: { message?: string }) {
  const msg = error.message ?? "";
  const hit = KNOWN_LIBRARY_ERRORS.find((k) => msg.includes(k));
  if (hit) return json({ error: hit }, 400);
  console.error("process-library-circulation: rpc failed", { message: msg });
  return errors.internal();
}

async function activeYearEndsOn(admin: AdminClient, tenantId: string): Promise<string | null> {
  const { data } = await admin.from("academic_years").select("ends_on")
    .eq("tenant_id", tenantId).eq("status", "active")
    .order("starts_on", { ascending: false }).limit(1).maybeSingle();
  return data?.ends_on ?? null;
}

async function defaultLendingDueOn(admin: AdminClient, tenantId: string): Promise<string> {
  const { data } = await admin.from("library_settings").select("loan_days_default")
    .eq("tenant_id", tenantId).maybeSingle();
  return addDays(todayLocal(), data?.loan_days_default ?? 14);
}

interface NotifyLibraryInput {
  tenantId: string;
  studentId: string;
  kind: "book_overdue" | "book_hold_ready";
  checkoutId?: string;
  holdId?: string;
}

/** Resolves recipients (the student's own user_id, plus every guardian with a
 *  user_id) and inserts portal_notifications rows -- same shape as
 *  notifyBilling() in _shared/fee-pdf.ts, kept local since this is its only
 *  caller. Returns whether any recipient was actually newly notified (not a
 *  replay-guard duplicate), so scan_overdue can report an accurate count. */
async function notifyLibrary(admin: AdminClient, input: NotifyLibraryInput): Promise<boolean> {
  const { data: student } = await admin.from("students").select("user_id").eq("id", input.studentId).maybeSingle();
  const { data: guardians } = await admin.from("guardians").select("user_id")
    .eq("student_id", input.studentId).not("user_id", "is", null);

  const recipientIds = new Set<string>();
  if (student?.user_id) recipientIds.add(student.user_id);
  for (const g of guardians ?? []) if (g.user_id) recipientIds.add(g.user_id);

  let anyNotified = false;
  for (const recipientId of recipientIds) {
    const { error } = await admin.from("portal_notifications").insert({
      tenant_id: input.tenantId, recipient_id: recipientId, student_id: input.studentId,
      kind: input.kind, checkout_id: input.checkoutId ?? null, hold_id: input.holdId ?? null,
    });
    if (!error) { anyNotified = true; continue; }
    if ((error as { code?: string }).code !== "23505") {
      console.error("notifyLibrary: insert failed", { message: error.message });
    }
  }
  return anyNotified;
}

async function checkout(admin: AdminClient, tenantId: string, p: { copy_id: string; student_id: string; checkout_type: "lending" | "rental" }) {
  const { data: student } = await admin.from("students").select("id")
    .eq("id", p.student_id).eq("tenant_id", tenantId).maybeSingle();
  if (!student) return errors.badRequest();
  const { data: copy } = await admin.from("library_book_copies").select("id")
    .eq("id", p.copy_id).eq("tenant_id", tenantId).maybeSingle();
  if (!copy) return errors.badRequest();

  const dueOn = p.checkout_type === "rental"
    ? await activeYearEndsOn(admin, tenantId)
    : await defaultLendingDueOn(admin, tenantId);
  if (!dueOn) return json({ error: "no_active_academic_year" }, 400);

  const { data, error } = await admin.rpc("library_checkout", {
    p_tenant_id: tenantId, p_copy_id: p.copy_id, p_student_id: p.student_id,
    p_checkout_type: p.checkout_type, p_due_on: dueOn,
  });
  if (error) return mapLibraryError(error);
  return json({ checkout: data }, 201);
}

async function doReturn(admin: AdminClient, tenantId: string, checkoutId: string) {
  const { data, error } = await admin.rpc("library_return", { p_tenant_id: tenantId, p_checkout_id: checkoutId });
  if (error) return mapLibraryError(error);
  const row = (Array.isArray(data) ? data[0] : data) as
    { checkout: unknown; fine_amount: number; hold_ready_id: string | null; hold_ready_student_id: string | null } | undefined;
  if (!row) return errors.internal();

  if (row.hold_ready_student_id && row.hold_ready_id) {
    await notifyLibrary(admin, {
      tenantId, studentId: row.hold_ready_student_id, kind: "book_hold_ready", holdId: row.hold_ready_id,
    });
  }
  return json({ checkout: row.checkout, fine_amount: row.fine_amount }, 200);
}

async function renew(admin: AdminClient, tenantId: string, checkoutId: string) {
  const { data, error } = await admin.rpc("library_renew", { p_tenant_id: tenantId, p_checkout_id: checkoutId });
  if (error) return mapLibraryError(error);
  return json({ checkout: data }, 200);
}

async function placeHold(admin: AdminClient, tenantId: string, p: { book_id: string; student_id: string }) {
  const { data: student } = await admin.from("students").select("id")
    .eq("id", p.student_id).eq("tenant_id", tenantId).maybeSingle();
  if (!student) return errors.badRequest();
  const { data: book } = await admin.from("library_books").select("id")
    .eq("id", p.book_id).eq("tenant_id", tenantId).maybeSingle();
  if (!book) return errors.badRequest();

  const { data, error } = await admin.from("library_holds")
    .insert({ tenant_id: tenantId, book_id: p.book_id, student_id: p.student_id })
    .select("id, status, requested_on").single();
  if (error) {
    // The partial unique index (tenant_id, book_id, student_id) where status
    // in ('waiting','ready') is the actual race-closer here; this just turns
    // its violation into a friendly response instead of a raw 23505.
    if ((error as { code?: string }).code === "23505") return json({ error: "already_on_hold" }, 400);
    console.error("placeHold failed", { message: error.message });
    return errors.internal();
  }
  return json({ hold: data }, 201);
}

async function cancelHold(admin: AdminClient, tenantId: string, holdId: string) {
  const { data, error } = await admin.from("library_holds")
    .update({ status: "cancelled" })
    .eq("id", holdId).eq("tenant_id", tenantId).in("status", ["waiting", "ready"])
    .select("id").maybeSingle();
  if (error) throw error;
  if (!data) return json({ error: "hold_not_cancellable" }, 400);
  return json({ ok: true }, 200);
}

async function scanOverdue(admin: AdminClient, tenantId: string) {
  const { data: overdue, error } = await admin.from("library_checkouts")
    .select("id, student_id")
    .eq("tenant_id", tenantId).eq("status", "checked_out").lt("due_on", todayLocal());
  if (error) throw error;

  let notifiedCount = 0;
  for (const c of overdue ?? []) {
    const notified = await notifyLibrary(admin, { tenantId, studentId: c.student_id, kind: "book_overdue", checkoutId: c.id });
    if (notified) notifiedCount++;
  }
  return json({ scanned: overdue?.length ?? 0, notified_count: notifiedCount }, 200);
}

async function bulkRent(admin: AdminClient, tenantId: string, p: { class_id: string; book_ids: string[] }) {
  const dueOn = await activeYearEndsOn(admin, tenantId);
  if (!dueOn) return json({ error: "no_active_academic_year" }, 400);

  const { data: students, error: stuErr } = await admin.from("students").select("id")
    .eq("tenant_id", tenantId).eq("class_id", p.class_id).eq("status", "active");
  if (stuErr) throw stuErr;
  if (!students?.length) return json({ error: "no_students_in_class" }, 400);

  const results: Record<string, { issued: number; no_copy_available: string[] }> = {};

  for (const bookId of p.book_ids) {
    const { data: copies, error: copyErr } = await admin.from("library_book_copies")
      .select("id").eq("tenant_id", tenantId).eq("book_id", bookId).eq("status", "available")
      .order("created_at");
    if (copyErr) throw copyErr;
    const queue = (copies ?? []).map((c) => c.id as string);
    let issued = 0;
    const shortfall: string[] = [];

    for (const student of students) {
      let claimed = false;
      // Each candidate copy is claimed through the same atomic RPC checkout()
      // uses -- not a batch UPDATE at the end -- so a copy this loop's local
      // queue thinks is available but another concurrent checkout (desk or a
      // second admin) just claimed simply fails with copy_not_available and
      // this loop moves on to the next candidate, instead of double-booking it.
      while (queue.length > 0 && !claimed) {
        const candidateCopyId = queue.shift()!;
        const { error } = await admin.rpc("library_checkout", {
          p_tenant_id: tenantId, p_copy_id: candidateCopyId, p_student_id: student.id,
          p_checkout_type: "rental", p_due_on: dueOn,
        });
        if (!error) { claimed = true; issued++; }
        else if (!(error.message ?? "").includes("copy_not_available")) break;
      }
      if (!claimed) shortfall.push(student.id as string);
    }
    results[bookId] = { issued, no_copy_available: shortfall };
  }

  return json({ results }, 200);
}

async function bulkReturn(admin: AdminClient, tenantId: string, classId: string) {
  const { data, error } = await admin.rpc("library_bulk_return", { p_tenant_id: tenantId, p_class_id: classId });
  if (error) throw error;
  return json({ returned_count: data?.length ?? 0 }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "librarian"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  const tenantId = ctx.tenantId;
  if (!tenantId) return errors.forbidden();

  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`library-circ:${ctx.userId}`, 30, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;
    const admin = ctx.adminClient;

    switch (p.action) {
      case "checkout": return await checkout(admin, tenantId, p);
      case "return": return await doReturn(admin, tenantId, p.checkout_id);
      case "renew": return await renew(admin, tenantId, p.checkout_id);
      case "place_hold": return await placeHold(admin, tenantId, p);
      case "cancel_hold": return await cancelHold(admin, tenantId, p.hold_id);
      case "scan_overdue": return await scanOverdue(admin, tenantId);
      case "bulk_rent": return await bulkRent(admin, tenantId, p);
      case "bulk_return": return await bulkReturn(admin, tenantId, p.class_id);
    }
  } catch (err) {
    console.error("process-library-circulation failed", { message: (err as Error).message });
    return errors.internal();
  }
});
