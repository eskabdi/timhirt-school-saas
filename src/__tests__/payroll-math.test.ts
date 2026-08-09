// Payroll math property test — regression coverage for the tax-bracket
// replacement (Federal Income Tax Proclamation No. 979/2016, Art. 11, as
// amended by Proclamation No. 1395/2025) and the LOW-priority pension-base
// fix (§18.3: pension is 7%/11% of BASIC SALARY only, not gross). Rates and
// deduction amounts below were verified directly against the official
// gazette on 2026-07-15 — see docs/DEPLOYMENT.md's worksheet for the source
// citation and independent re-derivation. This is a pure reference
// re-implementation of run-payroll/index.ts's core formula — kept
// deliberately separate from the Edge Function so this test has no
// Supabase/Deno runtime dependency and can run in plain Vitest/CI.
import { describe, it, expect } from "vitest";

interface Bracket { incomeFrom: number; incomeTo: number | null; ratePct: number; deduction: number }

// Mirrors the seed in supabase/migrations/20260713000004_hr_payroll.sql exactly.
const BRACKETS_1395_2025: Bracket[] = [
  { incomeFrom: 0.00, incomeTo: 2000.00, ratePct: 0, deduction: 0.00 },
  { incomeFrom: 2000.01, incomeTo: 4000.00, ratePct: 15, deduction: 300.00 },
  { incomeFrom: 4000.01, incomeTo: 7000.00, ratePct: 20, deduction: 500.00 },
  { incomeFrom: 7000.01, incomeTo: 10000.00, ratePct: 25, deduction: 850.00 },
  { incomeFrom: 10000.01, incomeTo: 14000.00, ratePct: 30, deduction: 1350.00 },
  { incomeFrom: 14000.01, incomeTo: null, ratePct: 35, deduction: 2050.00 },
];
const PENSION_EMPLOYEE_PCT = 7;
const PENSION_EMPLOYER_PCT = 11;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function findBracket(taxable: number, brackets: Bracket[]): Bracket | undefined {
  return brackets.find((b) => taxable >= b.incomeFrom && (b.incomeTo === null || taxable <= b.incomeTo));
}

/** Same shape as run-payroll's per-employee computation, basic-salary-only (no allowances). */
function computePayslip(basic: number, brackets: Bracket[] = BRACKETS_1395_2025) {
  const gross = round2(basic);
  const taxable = round2(basic);
  const bracket = findBracket(taxable, brackets);
  const incomeTax = round2(bracket ? (taxable * bracket.ratePct) / 100 - bracket.deduction : 0);
  // Pension base is basic salary only (LOW fix — never allowances).
  const pensionEmployee = round2(basic * (PENSION_EMPLOYEE_PCT / 100));
  const pensionEmployer = round2(basic * (PENSION_EMPLOYER_PCT / 100));
  const netPay = round2(gross - incomeTax - pensionEmployee);
  return { gross, taxable, incomeTax, pensionEmployee, pensionEmployer, netPay };
}

describe("Payroll math — Proclamation No. 1395/2025 brackets", () => {
  it("matches the hand-computed worksheet in docs/DEPLOYMENT.md", () => {
    expect(computePayslip(2000.00)).toMatchObject({ incomeTax: 0.00, pensionEmployee: 140.00, netPay: 1860.00 });
    expect(computePayslip(5000.00)).toMatchObject({ incomeTax: 500.00, pensionEmployee: 350.00, netPay: 4150.00 });
    expect(computePayslip(12000.00)).toMatchObject({ incomeTax: 2250.00, pensionEmployee: 840.00, netPay: 8910.00 });
    expect(computePayslip(20000.00)).toMatchObject({ incomeTax: 4950.00, pensionEmployee: 1400.00, netPay: 13650.00 });
  });

  it("never produces negative tax at any bracket boundary", () => {
    const boundaries = [0, 2000.00, 2000.01, 4000.00, 4000.01, 7000.00, 7000.01, 10000.00, 10000.01, 14000.00, 14000.01, 100000];
    for (const b of boundaries) {
      expect(computePayslip(b).incomeTax).toBeGreaterThanOrEqual(0);
    }
  });

  it("is continuous across every bracket boundary (no cliff-edge jumps)", () => {
    const pairs: [number, number][] = [
      [2000.00, 2000.01], [4000.00, 4000.01], [7000.00, 7000.01], [10000.00, 10000.01], [14000.00, 14000.01],
    ];
    for (const [below, above] of pairs) {
      const taxBelow = computePayslip(below).incomeTax;
      const taxAbove = computePayslip(above).incomeTax;
      // A one-cent income increase should change tax by at most a few cents,
      // never producing a large discontinuous jump (marginal-rate schedules
      // with a deduction shortcut are designed to be continuous at the cent).
      expect(Math.abs(taxAbove - taxBelow)).toBeLessThan(0.05);
    }
  });

  it("pension is computed on basic salary only, independent of any allowance", () => {
    // Two employees with identical basic salary must have identical pension
    // figures regardless of what allowances they might separately receive —
    // this test operates at the basic-only formula level by construction,
    // documenting the LOW-priority fix (pensionableBase pinned to `basic`).
    const a = computePayslip(6000);
    const b = computePayslip(6000);
    expect(a.pensionEmployee).toBe(b.pensionEmployee);
    expect(a.pensionEmployee).toBe(round2(6000 * 0.07));
    expect(a.pensionEmployer).toBe(round2(6000 * 0.11));
  });

  it("every bracket's rate/deduction pair is internally consistent (marginal schedule)", () => {
    // Reconstructs each bracket's implied "tax at the top of the previous
    // bracket" and checks it matches "tax at the bottom of this bracket"
    // within a rounding cent — the same discipline the review's own
    // worksheet applied when the brackets were first transcribed.
    for (let i = 1; i < BRACKETS_1395_2025.length; i++) {
      const prev = BRACKETS_1395_2025[i - 1];
      const curr = BRACKETS_1395_2025[i];
      if (!prev || !curr) throw new Error("bracket index out of range");
      const taxAtPrevTop = (prev.incomeTo! * prev.ratePct) / 100 - prev.deduction;
      const taxAtCurrBottom = (curr.incomeFrom * curr.ratePct) / 100 - curr.deduction;
      expect(Math.abs(taxAtCurrBottom - taxAtPrevTop)).toBeLessThan(0.01);
    }
  });
});
