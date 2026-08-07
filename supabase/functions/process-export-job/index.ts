// ============================================================================
// [INSA category: PRIVATE] process-export-job
// AuthZ: school_admin only (matches DashboardShell's nav gate on
// /settings/import-export -- UX only per §6.2, this requireRole() is the
// real authorization layer).
//
// Mirrors process-import-job's discovery: create_export_job (20260719000010_
// import_export.sql) inserts a data_jobs row and nothing else -- no consumer
// ever existed, and ImportExportPage.tsx's export mutation never called
// anything after the RPC. Every "Start Export" click has produced a job stuck
// at status='queued' forever. This function is the missing consumer: read the
// tenant's rows for the chosen entity_type, write them out in exactly the
// column order importTemplates.ts's headers describe (so an exported CSV
// re-imports cleanly), upload as a CSV, and complete the job.
//
// Dates are converted Gregorian -> EC on the way out, the inverse of what
// process-import-job does on the way in (§17.2).
// ============================================================================
import { z } from "npm:zod@3";
// deno-lint-ignore no-explicit-any
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { toEthiopian } from "../_shared/ethiopian-date.ts";

const Payload = z.object({ job_id: z.string().uuid() });

// process-import-job always treats row 0 as a header and skips it
// (dataRows = rows.slice(1), positional parsing) -- an export with no header
// row would silently drop the first real record on re-import. Wording doesn't
// need to match importTemplates.ts's translated headers (that's UI-only, this
// row is never read), it just has to exist and match column count/order.
const HEADERS: Record<"students" | "teachers" | "fees", string[]> = {
  students: [
    "First Name (English)", "First Name (Amharic)", "Middle Name (English)", "Middle Name (Amharic)",
    "Last Name (English)", "Last Name (Amharic)", "Date of Birth (EC)", "Gender", "Ethnicity", "Class",
    "Guardian Full Name", "Relationship", "Guardian Phone", "Guardian Email",
  ],
  teachers: [
    "First Name (English)", "First Name (Amharic)", "Father Name (English)", "Father Name (Amharic)",
    "Last Name (English)", "Last Name (Amharic)", "Gender", "Date of Birth (EC)",
    "Nationality", "National ID", "Phone", "Personal Email",
    "Region", "Zone", "Woreda", "City", "Kebele", "House Number",
    "Emergency Contact Name", "Emergency Contact Relationship", "Emergency Contact Phone", "Emergency Contact Email",
    "Highest Qualification", "Year of Graduation (EC)", "Major/Specialization", "Institution Name",
    "Languages", "Certifications", "Teaching Specializations",
    "Designation/Role", "Department", "Date of Joining (EC)", "Employment Type",
    "Institutional Email", "Work Phone", "Reporting Manager", "Contract Duration (months)",
    "Invite to Portal", "Portal Role",
  ],
  fees: ["Name", "Amount (ETB)", "Billing Cycle", "Class"],
};

const PAGE_SIZE = 1000; // matches supabase/config.toml [api].max_rows -- PostgREST caps any single response there regardless of client role

function csvField(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}
function csvRow(cols: string[]): string {
  return cols.map(csvField).join(",");
}

function toEcString(iso: string | null): string {
  if (!iso) return "";
  const e = toEthiopian(new Date(`${iso}T00:00:00Z`));
  return `${e.year}-${String(e.month).padStart(2, "0")}-${String(e.day).padStart(2, "0")}`;
}

function classLabel(name: string | null, section: string | null): string {
  return [name, section].filter((s) => s && s.trim()).join(" ").trim();
}

// deno-lint-ignore no-explicit-any
async function fetchAll(client: SupabaseClient, table: string, columns: string, tenantId: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client.from(table).select(columns)
      .eq("tenant_id", tenantId).order("id").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function buildStudentsCsv(admin: SupabaseClient, tenantId: string): Promise<string[][]> {
  const [students, classes, guardians] = await Promise.all([
    fetchAll(admin, "students",
      "id, first_name, first_name_am, middle_name, middle_name_am, last_name, last_name_am, date_of_birth, gender, ethnicity, class_id",
      tenantId),
    fetchAll(admin, "classes", "id, name, section", tenantId),
    fetchAll(admin, "guardians", "student_id, relationship, full_name, phone, email, created_at", tenantId),
  ]);

  const classMap = new Map(classes.map((c) => [c.id, classLabel(c.name, c.section)]));
  const guardianMap = new Map<string, typeof guardians[number]>();
  for (const g of guardians.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (!guardianMap.has(g.student_id)) guardianMap.set(g.student_id, g);
  }

  return students.map((s) => {
    const g = guardianMap.get(s.id);
    return [
      s.first_name ?? "", s.first_name_am ?? "",
      s.middle_name ?? "", s.middle_name_am ?? "",
      s.last_name ?? "", s.last_name_am ?? "",
      toEcString(s.date_of_birth), s.gender ?? "", s.ethnicity ?? "",
      classMap.get(s.class_id) ?? "",
      g?.full_name ?? "", g?.relationship ?? "", g?.phone ?? "", g?.email ?? "",
    ];
  });
}

// deno-lint-ignore no-explicit-any
async function buildTeachersCsv(admin: SupabaseClient, tenantId: string): Promise<string[][]> {
  const [employees, contacts, contracts, qualifications, subjectLinks] = await Promise.all([
    fetchAll(admin, "employees",
      `id, first_name, first_name_am, father_name, father_name_am, last_name, last_name_am, gender, date_of_birth,
       nationality, national_id, phone, personal_email, region, zone, woreda, city, kebele, house_number,
       highest_qualification, graduation_year_ec, major, institution_name, languages, department,
       institutional_email, work_phone, reporting_manager_id, employee_type, hire_date`,
      tenantId),
    fetchAll(admin, "employee_emergency_contacts", "employee_id, full_name, relationship, phone, email, created_at", tenantId),
    fetchAll(admin, "employment_contracts", "employee_id, contract_type, starts_on, ends_on, status", tenantId),
    fetchAll(admin, "employee_qualifications", "employee_id, name", tenantId),
    fetchAll(admin, "employee_subjects", "employee_id, subjects(code)", tenantId),
  ]);

  const nameById = new Map(employees.map((e) => [e.id, [e.first_name, e.father_name, e.last_name].filter(Boolean).join(" ")]));

  const contactMap = new Map<string, typeof contacts[number]>();
  for (const c of contacts.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
    if (!contactMap.has(c.employee_id)) contactMap.set(c.employee_id, c);
  }

  const contractMap = new Map<string, typeof contracts[number]>();
  for (const c of contracts) {
    const existing = contractMap.get(c.employee_id);
    if (!existing) { contractMap.set(c.employee_id, c); continue; }
    const existingActive = existing.status === "active";
    const currentActive = c.status === "active";
    if (currentActive && !existingActive) { contractMap.set(c.employee_id, c); continue; }
    if (currentActive === existingActive && (c.starts_on ?? "") > (existing.starts_on ?? "")) {
      contractMap.set(c.employee_id, c);
    }
  }

  const qualMap = new Map<string, string[]>();
  for (const q of qualifications) {
    const list = qualMap.get(q.employee_id) ?? [];
    list.push(q.name);
    qualMap.set(q.employee_id, list);
  }

  const subjectMap = new Map<string, string[]>();
  for (const l of subjectLinks) {
    const code = l.subjects?.code;
    if (!code) continue;
    const list = subjectMap.get(l.employee_id) ?? [];
    list.push(code);
    subjectMap.set(l.employee_id, list);
  }

  return employees.map((e) => {
    const contact = contactMap.get(e.id);
    const contract = contractMap.get(e.id);
    const durationMonths = contract?.starts_on && contract?.ends_on
      ? String(Math.max(0, Math.round(
          (new Date(contract.ends_on).getTime() - new Date(contract.starts_on).getTime()) / (30 * 86_400_000),
        )))
      : "";
    return [
      e.first_name ?? "", e.first_name_am ?? "",
      e.father_name ?? "", e.father_name_am ?? "",
      e.last_name ?? "", e.last_name_am ?? "",
      e.gender ?? "", toEcString(e.date_of_birth),
      e.nationality ?? "", e.national_id ?? "",
      e.phone ?? "", e.personal_email ?? "",
      e.region ?? "", e.zone ?? "", e.woreda ?? "", e.city ?? "", e.kebele ?? "", e.house_number ?? "",
      contact?.full_name ?? "", contact?.relationship ?? "", contact?.phone ?? "", contact?.email ?? "",
      e.highest_qualification ?? "", e.graduation_year_ec != null ? String(e.graduation_year_ec) : "",
      e.major ?? "", e.institution_name ?? "",
      (e.languages ?? []).join(";"),
      (qualMap.get(e.id) ?? []).join(";"),
      (subjectMap.get(e.id) ?? []).join(";"),
      e.employee_type ?? "", e.department ?? "",
      toEcString(e.hire_date), contract?.contract_type ?? "",
      e.institutional_email ?? "", e.work_phone ?? "",
      e.reporting_manager_id ? (nameById.get(e.reporting_manager_id) ?? "") : "",
      durationMonths,
      "", "", // Invite Portal / Portal Role -- not stored on employees, always blank on export
    ];
  });
}

// deno-lint-ignore no-explicit-any
async function buildFeesCsv(admin: SupabaseClient, tenantId: string): Promise<string[][]> {
  const [fees, classes] = await Promise.all([
    fetchAll(admin, "fee_structures", "name_i18n, amount, billing_cycle, class_id", tenantId),
    fetchAll(admin, "classes", "id, name, section", tenantId),
  ]);
  const classMap = new Map(classes.map((c) => [c.id, classLabel(c.name, c.section)]));
  return fees.map((f) => [
    f.name_i18n?.en ?? "", String(f.amount ?? ""), f.billing_cycle ?? "",
    f.class_id ? (classMap.get(f.class_id) ?? "") : "",
  ]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;

  if (req.method !== "POST") return errors.badRequest();
  if (!(await rateLimit(`process-export:${ctx.userId}`, 5, 60_000))) return errors.tooMany();

  const parsed = Payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest();
  const { job_id } = parsed.data;

  try {
    // RLS-gated read -- proves the caller can actually see this job before
    // any service_role work happens below, same shape as process-import-job.
    const { data: job } = await ctx.userClient.from("data_jobs")
      .select("id, tenant_id, entity_type, job_type, status").eq("id", job_id).maybeSingle();
    if (!job || job.job_type !== "export" || job.tenant_id !== ctx.tenantId) return errors.badRequest();
    if (job.status !== "queued") return errors.badRequest();
    if (!["students", "teachers", "fees"].includes(job.entity_type)) return errors.badRequest();

    await ctx.adminClient.from("data_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() }).eq("id", job_id);

    const rows = job.entity_type === "students" ? await buildStudentsCsv(ctx.adminClient, ctx.tenantId!)
      : job.entity_type === "teachers" ? await buildTeachersCsv(ctx.adminClient, ctx.tenantId!)
      : await buildFeesCsv(ctx.adminClient, ctx.tenantId!);

    const csv = [HEADERS[job.entity_type as "students" | "teachers" | "fees"], ...rows].map(csvRow).join("\n");
    const storagePath = `${ctx.tenantId}/${job_id}/${job.entity_type}-export.csv`;
    const { error: upErr } = await ctx.adminClient.storage.from("data-imports")
      .upload(storagePath, new Blob([csv], { type: "text/csv" }), { contentType: "text/csv", upsert: true });
    if (upErr) {
      await ctx.adminClient.rpc("fail_job", { p_job_id: job_id, p_error_message: "could_not_upload_file" });
      return json({ ok: false, reason: "upload_failed" }, 200);
    }

    // update_job_progress sets processed_rows -- complete_job never touches
    // it (only total_rows/storage_path/status). Skipping this left every
    // completed export showing "0 rows" in the Job History list, the same
    // shape of bug complete_job's error_count gap left for imports.
    await ctx.adminClient.rpc("update_job_progress", {
      p_job_id: job_id, p_processed_rows: rows.length, p_progress_percent: 100,
    });
    await ctx.adminClient.rpc("complete_job", {
      p_job_id: job_id, p_total_rows: rows.length, p_storage_path: storagePath,
    });

    return json({ ok: true, total_rows: rows.length }, 200);
  } catch (err) {
    console.error("process-export-job failed", { message: (err as Error).message });
    await ctx.adminClient.rpc("fail_job", { p_job_id: job_id, p_error_message: "internal_error" }).catch(() => {});
    return errors.internal();
  }
});
