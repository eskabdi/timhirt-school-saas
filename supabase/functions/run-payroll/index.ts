// ============================================================================
// [INSA category: INTERNAL] run-payroll
// AuthZ: hr_officer OR school_admin, same tenant. Payslips are written ONLY
// here (service_role) — no PostgREST write path exists (RLS has no policy).
// Statutory rules (tax brackets, pension) resolved by effective date (§18.3).
// No salary values are ever logged.
// ============================================================================
import { z } from "npm:zod@3";
import { requireRole, errors, json, rateLimit, corsHeaders } from "../_shared/security.ts";
import { ecMonthSpan } from "../_shared/ethiopian-date.ts";

const Payload = z.object({
  ec_year: z.number().int().min(1990).max(2200),
  ec_month: z.number().int().min(1).max(13),
});

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    if (req.method !== "POST") return errors.badRequest();
    const ctx = await requireRole(req, ["hr_officer", "school_admin"]);
    if (ctx instanceof Response) return ctx;
    if (!rateLimit(`payroll:${ctx.userId}`, 10, 60_000)) return errors.tooMany();

    const parsed = Payload.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return errors.badRequest();
    const { ec_year, ec_month } = parsed.data;
    const period = ecMonthSpan(ec_year, ec_month);
    const runDate = period.end.toISOString().slice(0, 10);

    const db = ctx.adminClient;

    // 1. Upsert run in draft (idempotent recalculation); refuse if approved/paid
    const { data: existing } = await db.from("payroll_runs")
      .select("id, status").eq("tenant_id", ctx.tenantId)
      .eq("ec_year", ec_year).eq("ec_month", ec_month).maybeSingle();
    if (existing && existing.status !== "draft") return errors.badRequest();

    let runId = existing?.id as string | undefined;
    if (!runId) {
      const { data: run, error } = await db.from("payroll_runs")
        .insert({ tenant_id: ctx.tenantId, ec_year, ec_month, status: "draft", prepared_by: ctx.userId })
        .select("id").single();
      if (error) throw error;
      runId = run.id;
    }

    // 2. Load statutory rules in force at the run date (effective-dated)
    const { data: brackets } = await db.from("tax_brackets")
      .select("income_from, income_to, rate_pct, deduction_amount, effective_from")
      .lte("effective_from", runDate).order("effective_from", { ascending: false });
    const latestEffective = brackets?.[0]?.effective_from;
    const activeBrackets = (brackets ?? []).filter((b) => b.effective_from === latestEffective);

    const { data: pensionRows } = await db.from("pension_rates")
      .select("employee_pct, employer_pct").lte("effective_from", runDate)
      .order("effective_from", { ascending: false }).limit(1);
    const pension = pensionRows?.[0] ?? { employee_pct: 0, employer_pct: 0 };

    // 3. Load active employees + contracts + components
    const { data: employees, error: empErr } = await db.from("employees")
      .select(`id, full_name,
               employment_contracts!inner(basic_salary, status),
               employee_salary_components(amount, salary_components(name_i18n, kind, taxable, pensionable, calc_type))`)
      .eq("tenant_id", ctx.tenantId).eq("status", "active")
      .eq("employment_contracts.status", "active");
    if (empErr) throw empErr;

    let grossTotal = 0;
    for (const emp of employees ?? []) {
      const basic = Number(emp.employment_contracts[0]?.basic_salary ?? 0);
      let gross = basic, taxable = basic, pensionableBase = basic, otherDeductions = 0;
      const lines: Array<{ label_i18n: unknown; kind: string; amount: number }> = [
        { label_i18n: { en: "Basic salary", am: "መሠረታዊ ደመወዝ", om: "Mindaa bu'uuraa" }, kind: "earning", amount: round2(basic) },
      ];

      for (const esc of emp.employee_salary_components ?? []) {
        const comp = esc.salary_components;
        if (!comp) continue;
        const amt = comp.calc_type === "percent_of_basic"
          ? round2(basic * Number(esc.amount) / 100)
          : round2(Number(esc.amount));
        if (comp.kind === "allowance") {
          gross += amt;
          if (comp.taxable) taxable += amt;
          // LOW fix: Pension Proclamation 715/2011 computes 7%/11% on BASIC
          // SALARY only — allowances are not part of the pensionable base
          // under the statute. `salary_components.pensionable` remains in
          // the schema for a possible future tenant-level override, but it
          // is intentionally NOT applied here until legal counsel confirms
          // any allowance should be pension-bearing; pensionableBase stays
          // pinned to `basic` (declared above) for statutory correctness.
          lines.push({ label_i18n: comp.name_i18n, kind: "earning", amount: amt });
        } else {
          otherDeductions += amt;
          lines.push({ label_i18n: comp.name_i18n, kind: "deduction", amount: amt });
        }
      }
      gross = round2(gross); taxable = round2(taxable);

      // income_tax = taxable × rate − deduction (bracket in force)
      const bracket = activeBrackets.find((b) =>
        taxable >= Number(b.income_from) && (b.income_to == null || taxable <= Number(b.income_to)));
      const incomeTax = round2(bracket ? taxable * Number(bracket.rate_pct) / 100 - Number(bracket.deduction_amount) : 0);
      const pensionEmployee = round2(pensionableBase * Number(pension.employee_pct) / 100);
      const pensionEmployer = round2(pensionableBase * Number(pension.employer_pct) / 100);
      const netPay = round2(gross - incomeTax - pensionEmployee - otherDeductions);

      lines.push(
        { label_i18n: { en: "Income tax", am: "የገቢ ግብር", om: "Gibira galii" }, kind: "deduction", amount: incomeTax },
        { label_i18n: { en: "Pension (employee 7%)", am: "ጡረታ (ሠራተኛ)", om: "Soorama (hojjetaa)" }, kind: "deduction", amount: pensionEmployee },
        { label_i18n: { en: "Pension (employer 11%)", am: "ጡረታ (አሠሪ)", om: "Soorama (dhaabbata)" }, kind: "employer_cost", amount: pensionEmployer },
      );

      const { data: slip, error: slipErr } = await db.from("payslips")
        .upsert({
          tenant_id: ctx.tenantId, run_id: runId, employee_id: emp.id,
          gross, taxable_income: taxable, income_tax: incomeTax,
          pension_employee: pensionEmployee, pension_employer: pensionEmployer,
          other_deductions: round2(otherDeductions), net_pay: netPay,
        }, { onConflict: "run_id,employee_id" })
        .select("id").single();
      if (slipErr) throw slipErr;

      await db.from("payslip_lines").delete().eq("payslip_id", slip.id);
      await db.from("payslip_lines").insert(
        lines.map((l) => ({ payslip_id: slip.id, ...l })));

      grossTotal += gross;
    }

    return json({
      run_id: runId,
      employees: employees?.length ?? 0,
      gross_total: round2(grossTotal).toFixed(2),
      status: "draft",
    }, 200);
  } catch (err) {
    // Server-side detail only; never salary values or PII
    console.error("run-payroll failed", { message: (err as Error).message });
    return errors.internal();
  }
});
