// ============================================================================
// [INSA category: PRIVATE] generate-fee-invoices
// AuthZ: school_admin / accountant. Manual, staff-triggered batch action --
// NOT a cron/recurring job (no scheduler infra exists in this codebase and
// none is added here, matching the library module's overdue-reminders
// precedent). Staff press "Generate Invoices" on a fee structure and get
// one invoice per eligible active student who doesn't already have one.
//
// fee_structures writes are school_admin only (20260713000005's generic
// role loop), but this function only ever inserts into fee_invoices, so
// accountant is let in too -- same reasoning enroll-finalize-billing uses
// to let registrar through even though registrar can't write fee_invoices
// directly via RLS.
//
// Scope resolution mirrors fee_structures_scope_check (20260814000003):
// exactly one of class_id / grade_level / grade_cycle_id is set, or none
// (tenant-wide, matching today's "all classes" meaning). due_date is
// hardcoded to today, matching enroll-finalize-billing's own convention --
// not inventing new due-date logic here.
//
// Dedup is a single batch pre-read (existing fee_invoices for this
// fee_structure_id) rather than N per-student checks, then a single
// multi-row insert for what's left. Calling this twice for the same
// fee_structure_id is safe: the second call's dedup set already contains
// every invoice the first call created.
//
// Consolidation (20260820000001): a school clicking "Generate Invoices" on
// Tuition today and Library today should get ONE invoice per student with
// two line items, not two unrelated invoices. So each matched student's new
// fee_invoices row attaches to their currently-open invoice_headers row for
// TODAY's due_date (one with at least one unpaid line) if one exists, else a
// new header is created. Scoped to (student, due_date) deliberately -- an
// unpaid header from last month must never silently absorb an unrelated
// charge due today, and a header where every line is already paid is
// treated as closed (a new charge starts a new invoice, it doesn't reopen
// one a receipt has already been issued against).
//
// Does not render invoice PDFs or send portal notifications synchronously --
// issue-fee-document already generates a PDF on-demand, fresh, the first
// time anyone opens an invoice (never cached, since amount_paid/status
// change); doing that here too would risk Edge Function timeouts on a large
// grade/cycle and duplicate work that's thrown away the moment the invoice
// is paid.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";

const Payload = z.object({ fee_structure_id: z.string().uuid() });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin", "accountant"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;
  try {
    if (req.method !== "POST") return errors.badRequest();
    if (!(await rateLimit(`generate-invoices:${ctx.userId}`, 10, 60_000))) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const p = parsed.data;

    // RLS-gated read -- proves the caller can see this fee structure (same
    // tenant) before any service_role work happens below.
    const { data: structure } = await ctx.userClient.from("fee_structures")
      .select("id, tenant_id, amount, class_id, grade_level, grade_cycle_id")
      .eq("id", p.fee_structure_id).maybeSingle();
    if (!structure) return errors.badRequest();

    const admin = ctx.adminClient;
    let studentIds: string[] = [];

    if (structure.class_id) {
      const { data } = await admin.from("students")
        .select("id").eq("tenant_id", structure.tenant_id).eq("status", "active")
        .eq("class_id", structure.class_id);
      studentIds = (data ?? []).map((s) => s.id);
    } else if (structure.grade_level != null) {
      const { data: classes } = await admin.from("classes")
        .select("id").eq("tenant_id", structure.tenant_id).eq("grade_level", structure.grade_level);
      const classIds = (classes ?? []).map((c) => c.id);
      if (classIds.length) {
        const { data } = await admin.from("students")
          .select("id").eq("tenant_id", structure.tenant_id).eq("status", "active").in("class_id", classIds);
        studentIds = (data ?? []).map((s) => s.id);
      }
    } else if (structure.grade_cycle_id) {
      const { data: cycle } = await admin.from("grade_cycles")
        .select("min_grade, max_grade").eq("id", structure.grade_cycle_id).maybeSingle();
      if (!cycle) return errors.badRequest();
      const { data: classes } = await admin.from("classes")
        .select("id").eq("tenant_id", structure.tenant_id)
        .gte("grade_level", cycle.min_grade).lte("grade_level", cycle.max_grade);
      const classIds = (classes ?? []).map((c) => c.id);
      if (classIds.length) {
        const { data } = await admin.from("students")
          .select("id").eq("tenant_id", structure.tenant_id).eq("status", "active").in("class_id", classIds);
        studentIds = (data ?? []).map((s) => s.id);
      }
    } else {
      const { data } = await admin.from("students")
        .select("id").eq("tenant_id", structure.tenant_id).eq("status", "active");
      studentIds = (data ?? []).map((s) => s.id);
    }

    const totalMatched = studentIds.length;
    if (totalMatched === 0) return json({ created_count: 0, skipped_count: 0, total_matched: 0 }, 200);

    // One batch dedup read instead of N single-row checks.
    const { data: existing } = await admin.from("fee_invoices")
      .select("student_id").eq("fee_structure_id", structure.id).in("student_id", studentIds);
    const already = new Set((existing ?? []).map((r) => r.student_id));
    const toCreate = studentIds.filter((id) => !already.has(id));

    if (toCreate.length === 0) {
      return json({ created_count: 0, skipped_count: totalMatched, total_matched: totalMatched }, 200);
    }

    const dueDate = new Date().toISOString().slice(0, 10);

    // Find each matched student's currently-open header for today's due
    // date -- one that already exists AND still has at least one unpaid
    // line item.
    const { data: headerRows } = await admin.from("invoice_headers")
      .select("id, student_id")
      .eq("tenant_id", structure.tenant_id).eq("due_date", dueDate).in("student_id", toCreate);
    const headerIds = (headerRows ?? []).map((h) => h.id);
    const { data: lineRows } = headerIds.length
      ? await admin.from("fee_invoices").select("invoice_header_id, status").in("invoice_header_id", headerIds)
      : { data: [] as { invoice_header_id: string; status: string }[] };
    const openHeaderIds = new Set(
      (lineRows ?? []).filter((r) => r.status !== "paid").map((r) => r.invoice_header_id),
    );
    const openHeaderByStudent = new Map<string, string>();
    for (const h of headerRows ?? []) {
      if (openHeaderIds.has(h.id) && !openHeaderByStudent.has(h.student_id)) {
        openHeaderByStudent.set(h.student_id, h.id);
      }
    }

    // Everyone else (no open header for this due date) gets a new one.
    const studentsNeedingHeader = toCreate.filter((id) => !openHeaderByStudent.has(id));
    if (studentsNeedingHeader.length) {
      const { data: newHeaders, error: hErr } = await admin.from("invoice_headers")
        .insert(studentsNeedingHeader.map((student_id) => ({
          tenant_id: structure.tenant_id, student_id, due_date: dueDate,
        })))
        .select("id, student_id");
      if (hErr) throw hErr;
      for (const h of newHeaders ?? []) openHeaderByStudent.set(h.student_id, h.id);
    }

    const rows = toCreate.map((student_id) => ({
      tenant_id: structure.tenant_id, student_id, fee_structure_id: structure.id,
      amount_due: structure.amount, due_date: dueDate,
      invoice_header_id: openHeaderByStudent.get(student_id)!,
    }));

    const { error: insErr } = await admin.from("fee_invoices").insert(rows);
    if (insErr) throw insErr;

    return json({
      created_count: toCreate.length,
      skipped_count: totalMatched - toCreate.length,
      total_matched: totalMatched,
    }, 200);
  } catch (err) {
    console.error("generate-fee-invoices failed", { message: (err as Error).message });
    return errors.internal();
  }
});
