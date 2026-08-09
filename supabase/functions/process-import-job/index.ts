// ============================================================================
// [INSA category: PRIVATE] process-import-job
// AuthZ: school_admin only (matches DashboardShell's nav gate on
// /settings/import-export -- that's UX only per §6.2, this requireRole() is
// the real authorization layer).
//
// This is the half of the CSV bulk-import feature that was never built.
// data_jobs + create_import_job/update_job_progress/complete_job/fail_job
// (20260719000010_import_export.sql) already existed, and ImportExportPage.tsx
// already created a queued job row and uploaded the file -- but nothing ever
// read the file back and wrote real students/employees/fee_structures rows.
// The job just sat at status='queued' forever. This function is the missing
// consumer: download the CSV the frontend just uploaded, parse it, and insert
// real rows, one row of the batch at a time, collecting a per-row error
// instead of failing the whole import on the first bad row.
//
// Column order for each entity_type is a fixed contract with
// src/features/settings/importTemplates.ts -- the downloadable template's
// header order IS this function's column-index mapping. If the template
// changes, this file has to change with it.
//
// Dates: every "(EC, YYYY-MM-DD)" column is parsed as an Ethiopian-calendar
// date and converted to Gregorian before storage, matching every other date
// field in this app (§17.2) and the EthDatePicker the manual forms use (which
// displays/collects EC but stores the underlying Gregorian Date).
//
// auto-generated columns (admission_no, employee_no, roll_number) are
// deliberately never set here -- the same BEFORE INSERT triggers the manual
// forms rely on fire identically for a service_role insert, so imported rows
// get the same auto-numbering for free.
//
// Portal invitations are explicitly out of scope (no email/SMS wiring exists
// in this app at all, per the fee-documents plan) -- imported employees are
// created with user_id left null, same as a draft profile before "Invite to
// Portal" is used manually on the Teachers page.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { toGregorian } from "../_shared/ethiopian-date.ts";

const Payload = z.object({
  job_id: z.string().uuid(),
  storage_path: z.string().min(1).max(500),
});

// ---------------------------------------------------------------------------
// CSV parsing -- RFC4180-ish: quoted fields, "" escapes a literal quote,
// commas/newlines inside quotes are preserved. Matches what this app's own
// downloadCsv() (ImportExportPage.tsx) writes, and tolerates a normal
// Excel/Sheets export too.
// ---------------------------------------------------------------------------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function parseEcDate(raw: string): string | null {
  const m = /^(\d{3,4})-(\d{1,2})-(\d{1,2})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 13 || day < 1 || day > 30) return null;
  const g = toGregorian({ year, month, day });
  if (Number.isNaN(g.getTime())) return null;
  return g.toISOString().slice(0, 10);
}

function buildClassLookup(rows: { id: string; name: string; section: string | null }[]): Map<string, string> {
  const lookup = new Map<string, string>();
  const nameCounts = new Map<string, number>();
  for (const r of rows) {
    const full = `${r.name} ${r.section ?? ""}`.trim().toLowerCase().replace(/\s+/g, " ");
    lookup.set(full, r.id);
    const n = r.name.trim().toLowerCase();
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  // Only register a grade-only alias ("grade 3" -> id) when exactly one class
  // shares that name -- with two sections for the same grade, a grade-only
  // string is genuinely ambiguous and must be rejected, not silently guessed.
  for (const r of rows) {
    const n = r.name.trim().toLowerCase();
    if (nameCounts.get(n) === 1) lookup.set(n, r.id);
  }
  return lookup;
}

function resolveClassId(raw: string, lookup: Map<string, string>): string | null {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return lookup.get(norm) ?? null;
}

interface RowCtx {
  tenantId: string;
  // deno-lint-ignore no-explicit-any
  adminClient: any;
  classesLookup: Map<string, string>;
  subjectCodeLookup: Map<string, string>;
  employeeNameLookup: Map<string, string>;
}

async function importStudentRow(cols: string[], ctx: RowCtx): Promise<void> {
  const [
    firstEn, firstAm, midEn, midAm, lastEn, lastAm, dobRaw, genderRaw, ethnicityRaw, classRaw,
    guardianName, relationshipRaw, guardianPhone, guardianEmail,
  ] = cols;

  const first_name = (firstEn ?? "").trim();
  const last_name = (lastEn ?? "").trim();
  if (!first_name) throw new Error("First Name (English) is required");
  if (!last_name) throw new Error("Last Name (English) is required");

  const gender = (genderRaw ?? "").trim().toLowerCase();
  if (!["male", "female", "other"].includes(gender)) throw new Error(`invalid gender "${genderRaw ?? ""}"`);

  const dob = parseEcDate(dobRaw ?? "");
  if (!dob) throw new Error(`invalid date of birth "${dobRaw ?? ""}" (expected EC YYYY-MM-DD)`);
  if (dob >= new Date().toISOString().slice(0, 10)) throw new Error("date of birth must be in the past");

  const classId = resolveClassId(classRaw ?? "", ctx.classesLookup);
  if (!classId) throw new Error(`class not found: "${classRaw ?? ""}"`);

  let ethnicity: string | null = null;
  if (ethnicityRaw?.trim()) {
    const norm = ethnicityRaw.trim().toLowerCase().replace(/\s+/g, "_");
    if (/^[a-z][a-z0-9_]{1,39}$/.test(norm)) ethnicity = norm;
  }

  const { data: student, error } = await ctx.adminClient.from("students").insert({
    tenant_id: ctx.tenantId,
    first_name, first_name_am: firstAm?.trim() || null,
    middle_name: midEn?.trim() || null, middle_name_am: midAm?.trim() || null,
    last_name, last_name_am: lastAm?.trim() || null,
    date_of_birth: dob, gender, ethnicity, class_id: classId,
  }).select("id").single();
  if (error) throw new Error(error.message);

  const hasGuardianInfo = !!(guardianName?.trim() || guardianPhone?.trim() || guardianEmail?.trim());
  if (hasGuardianInfo) {
    const relationship = (relationshipRaw ?? "").trim().toLowerCase();
    const rel = ["father", "mother", "guardian", "other"].includes(relationship) ? relationship : "guardian";
    const { error: gErr } = await ctx.adminClient.from("guardians").insert({
      tenant_id: ctx.tenantId, student_id: student.id, relationship: rel,
      full_name: guardianName?.trim() || null, phone: guardianPhone?.trim() || null, email: guardianEmail?.trim() || null,
    });
    if (gErr) throw new Error(`student created but guardian failed: ${gErr.message}`);
  }
}

async function importTeacherRow(cols: string[], ctx: RowCtx): Promise<void> {
  const [
    firstEn, firstAm, fatherEn, fatherAm, lastEn, lastAm, genderRaw, dobRaw,
    nationality, nationalId, phone, personalEmail,
    region, zone, woreda, city, kebele, houseNumber,
    emName, emRelationship, emPhone, emEmail,
    highestQual, gradYearRaw, major, institutionName,
    languagesRaw, certificationsRaw, specializationsRaw,
    employeeTypeRaw, department, hireDateRaw, contractTypeRaw,
    institutionalEmail, workPhone, reportingManagerName, contractDurationRaw,
  ] = cols;

  const first_name = (firstEn ?? "").trim();
  const last_name = (lastEn ?? "").trim();
  if (!first_name) throw new Error("First Name (English) is required");
  if (!last_name) throw new Error("Last Name (English) is required");
  const father_name = (fatherEn ?? "").trim() || null;
  const full_name = [first_name, father_name, last_name].filter(Boolean).join(" ");

  const genderRawTrim = (genderRaw ?? "").trim().toLowerCase();
  if (genderRawTrim && !["male", "female", "other"].includes(genderRawTrim)) {
    throw new Error(`invalid gender "${genderRaw ?? ""}"`);
  }

  let dob: string | null = null;
  if (dobRaw?.trim()) {
    dob = parseEcDate(dobRaw);
    if (!dob) throw new Error(`invalid date of birth "${dobRaw}" (expected EC YYYY-MM-DD)`);
  }

  const employee_type = (employeeTypeRaw ?? "").trim().toLowerCase();
  if (!["teacher", "admin_staff", "support"].includes(employee_type)) {
    throw new Error(`invalid designation/role "${employeeTypeRaw ?? ""}"`);
  }

  const hireDate = parseEcDate(hireDateRaw ?? "");
  if (!hireDate) throw new Error(`invalid date of joining "${hireDateRaw ?? ""}" (expected EC YYYY-MM-DD)`);

  const languages = (languagesRaw ?? "").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);

  let graduation_year_ec: number | null = null;
  if (gradYearRaw?.trim()) {
    graduation_year_ec = Number(gradYearRaw.trim());
    if (!Number.isFinite(graduation_year_ec) || graduation_year_ec < 1950 || graduation_year_ec > 2200) {
      throw new Error(`invalid year of graduation "${gradYearRaw}"`);
    }
  }

  let reporting_manager_id: string | null = null;
  if (reportingManagerName?.trim()) {
    reporting_manager_id = ctx.employeeNameLookup.get(reportingManagerName.trim().toLowerCase()) ?? null;
  }

  const { data: employee, error } = await ctx.adminClient.from("employees").insert({
    tenant_id: ctx.tenantId, employee_type, full_name, hire_date: hireDate, status: "active",
    first_name, first_name_am: firstAm?.trim() || null,
    father_name, father_name_am: fatherAm?.trim() || null,
    last_name, last_name_am: lastAm?.trim() || null,
    gender: genderRawTrim || null, date_of_birth: dob,
    nationality: nationality?.trim() || null, national_id: nationalId?.trim() || null,
    phone: phone?.trim() || null, personal_email: personalEmail?.trim() || null,
    region: region?.trim() || null, zone: zone?.trim() || null, woreda: woreda?.trim() || null,
    city: city?.trim() || null, kebele: kebele?.trim() || null, house_number: houseNumber?.trim() || null,
    highest_qualification: highestQual?.trim() || null, major: major?.trim() || null,
    institution_name: institutionName?.trim() || null, graduation_year_ec,
    languages: languages.length ? languages : null,
    department: department?.trim() || null,
    institutional_email: institutionalEmail?.trim() || null, work_phone: workPhone?.trim() || null,
    reporting_manager_id, probation_status: "not_applicable",
  }).select("id").single();
  if (error) throw new Error(error.message);

  if (emName?.trim() || emPhone?.trim() || emEmail?.trim()) {
    const { error: ecErr } = await ctx.adminClient.from("employee_emergency_contacts").insert({
      tenant_id: ctx.tenantId, employee_id: employee.id,
      full_name: emName?.trim() || "Unknown", relationship: emRelationship?.trim() || null,
      phone: emPhone?.trim() || null, email: emEmail?.trim() || null,
    });
    if (ecErr) throw new Error(`employee created but emergency contact failed: ${ecErr.message}`);
  }

  const contractTypeNorm = (contractTypeRaw ?? "").trim().toLowerCase();
  if (["permanent", "contract", "part_time"].includes(contractTypeNorm)) {
    const months = contractDurationRaw?.trim() ? Number(contractDurationRaw.trim()) : null;
    const endsOn = months && Number.isFinite(months)
      ? new Date(new Date(hireDate).getTime() + months * 30 * 86_400_000).toISOString().slice(0, 10)
      : null;
    const { error: ccErr } = await ctx.adminClient.from("employment_contracts").insert({
      tenant_id: ctx.tenantId, employee_id: employee.id, contract_type: contractTypeNorm,
      starts_on: hireDate, ends_on: endsOn, status: "active", basic_salary: 0,
    });
    if (ccErr) throw new Error(`employee created but contract failed: ${ccErr.message}`);
  }

  const certNames = (certificationsRaw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  if (certNames.length) {
    const { error: qErr } = await ctx.adminClient.from("employee_qualifications").insert(
      certNames.map((name) => ({ tenant_id: ctx.tenantId, employee_id: employee.id, name })),
    );
    if (qErr) throw new Error(`employee created but qualifications failed: ${qErr.message}`);
  }

  const codes = (specializationsRaw ?? "").split(";").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const subjectIds = codes.map((c) => ctx.subjectCodeLookup.get(c)).filter((id): id is string => !!id);
  if (subjectIds.length) {
    const { error: sErr } = await ctx.adminClient.from("employee_subjects").insert(
      subjectIds.map((subject_id) => ({ tenant_id: ctx.tenantId, employee_id: employee.id, subject_id })),
    );
    if (sErr) throw new Error(`employee created but teaching subjects failed: ${sErr.message}`);
  }
}

async function importFeeRow(cols: string[], ctx: RowCtx): Promise<void> {
  const [name, amountRaw, cycleRaw, classRaw] = cols;
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) throw new Error("Name is required");

  const amount = Number((amountRaw ?? "").trim());
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`invalid amount "${amountRaw ?? ""}"`);

  const cycle = (cycleRaw ?? "").trim().toLowerCase();
  if (!["monthly", "term", "annual", "once"].includes(cycle)) throw new Error(`invalid billing cycle "${cycleRaw ?? ""}"`);

  let classId: string | null = null;
  if (classRaw?.trim()) {
    classId = resolveClassId(classRaw, ctx.classesLookup);
    if (!classId) throw new Error(`class not found: "${classRaw}"`);
  }

  const { error } = await ctx.adminClient.from("fee_structures").insert({
    tenant_id: ctx.tenantId, name_i18n: { en: trimmedName }, amount, billing_cycle: cycle, class_id: classId,
  });
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const ctxOrRes = await requireRole(req, ["school_admin"]);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  const ctx = ctxOrRes;

  if (req.method !== "POST") return errors.badRequest();
  if (!(await rateLimit(`process-import:${ctx.userId}`, 5, 60_000))) return errors.tooMany();

  const parsed = Payload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errors.badRequest();
  const { job_id, storage_path } = parsed.data;

  try {
    // RLS-gated read -- proves the caller can actually see this job (own
    // tenant, and either they created it or they're school_admin) before any
    // service_role write happens below.
    const { data: job } = await ctx.userClient.from("data_jobs")
      .select("id, tenant_id, entity_type, job_type, status").eq("id", job_id).maybeSingle();
    if (!job || job.job_type !== "import" || job.tenant_id !== ctx.tenantId) return errors.badRequest();
    if (job.status !== "queued") return errors.badRequest();
    if (!["students", "teachers", "fees"].includes(job.entity_type)) return errors.badRequest();
    if (!storage_path.startsWith(`${ctx.tenantId}/${job_id}/`)) return errors.badRequest();

    await ctx.adminClient.from("data_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() }).eq("id", job_id);

    const { data: fileBlob, error: dlErr } = await ctx.adminClient.storage.from("data-imports").download(storage_path);
    if (dlErr || !fileBlob) {
      await ctx.adminClient.rpc("fail_job", { p_job_id: job_id, p_error_message: "could_not_download_file" });
      return json({ ok: false, reason: "download_failed" }, 200);
    }

    const rows = parseCsv(await fileBlob.text());
    if (rows.length < 2) {
      await ctx.adminClient.rpc("fail_job", { p_job_id: job_id, p_error_message: "empty_or_header_only_csv" });
      return json({ ok: false, reason: "empty_csv" }, 200);
    }
    const dataRows = rows.slice(1); // header row is for humans only, columns are positional

    const { data: classRows } = await ctx.adminClient.from("classes")
      .select("id, name, section").eq("tenant_id", ctx.tenantId);
    const classesLookup = buildClassLookup(classRows ?? []);

    const subjectCodeLookup = new Map<string, string>();
    const employeeNameLookup = new Map<string, string>();
    if (job.entity_type === "teachers") {
      const { data: subjectRows } = await ctx.adminClient.from("subjects")
        .select("id, code").eq("tenant_id", ctx.tenantId);
      for (const s of subjectRows ?? []) subjectCodeLookup.set((s.code as string).toUpperCase(), s.id as string);
      const { data: empRows } = await ctx.adminClient.from("employees")
        .select("id, full_name").eq("tenant_id", ctx.tenantId);
      for (const e of empRows ?? []) if (e.full_name) employeeNameLookup.set((e.full_name as string).toLowerCase(), e.id as string);
    }

    const rowCtx: RowCtx = { tenantId: ctx.tenantId!, adminClient: ctx.adminClient, classesLookup, subjectCodeLookup, employeeNameLookup };

    const errorLog: { row: number; error: string }[] = [];
    let processed = 0;
    for (let i = 0; i < dataRows.length; i++) {
      const cols = dataRows[i];
      const rowNumber = i + 2; // +1 for the header row, +1 for 1-indexing -- matches what a spreadsheet shows
      try {
        if (job.entity_type === "students") await importStudentRow(cols, rowCtx);
        else if (job.entity_type === "teachers") await importTeacherRow(cols, rowCtx);
        else await importFeeRow(cols, rowCtx);
        processed++;
      } catch (err) {
        errorLog.push({ row: rowNumber, error: (err as Error).message });
      }
      await ctx.adminClient.rpc("update_job_progress", {
        p_job_id: job_id, p_processed_rows: processed,
        p_progress_percent: Math.round(((i + 1) / dataRows.length) * 100),
        p_error_log: errorLog.length ? errorLog : null,
      });
    }

    // complete_job/update_job_progress never touch error_count (only
    // error_log) -- set it directly so the Job History list's error badge
    // isn't permanently stuck at 0 for a completed-with-errors import.
    await ctx.adminClient.from("data_jobs").update({ error_count: errorLog.length }).eq("id", job_id);
    await ctx.adminClient.rpc("complete_job", { p_job_id: job_id, p_total_rows: dataRows.length });

    return json({ ok: true, total_rows: dataRows.length, processed_rows: processed, error_count: errorLog.length }, 200);
  } catch (err) {
    console.error("process-import-job failed", { message: (err as Error).message });
    await ctx.adminClient.rpc("fail_job", { p_job_id: job_id, p_error_message: "internal_error" }).catch(() => {});
    return errors.internal();
  }
});
