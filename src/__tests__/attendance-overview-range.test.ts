import { describe, it, expect } from "vitest";
import { rangeFor, type TermRow } from "@/features/attendance/attendanceRange";

// Wednesday, 2026-08-12 -- deliberately mid-week/mid-month so week/month
// boundaries are unambiguous.
const TODAY = new Date("2026-08-12T12:00:00Z");

const TERMS: TermRow[] = [
  { term_no: 1, starts_on: "2025-09-08", ends_on: "2025-11-14" },
  { term_no: 2, starts_on: "2025-11-17", ends_on: "2026-01-30" },
  { term_no: 3, starts_on: "2026-02-02", ends_on: "2026-04-24" },
  { term_no: 4, starts_on: "2026-04-27", ends_on: "2026-07-02" },
];
const ACTIVE_YEAR = { starts_on: "2025-09-08", ends_on: "2026-07-08" };

describe("AttendanceOverviewPage rangeFor", () => {
  it("day is just today", () => {
    expect(rangeFor("day", TODAY, TERMS, ACTIVE_YEAR)).toEqual(["2026-08-12", "2026-08-12"]);
  });

  it("week is the Monday-Sunday span containing today", () => {
    expect(rangeFor("week", TODAY, TERMS, ACTIVE_YEAR)).toEqual(["2026-08-10", "2026-08-16"]);
  });

  it("month is the full current calendar month", () => {
    expect(rangeFor("month", TODAY, TERMS, ACTIVE_YEAR)).toEqual(["2026-08-01", "2026-08-31"]);
  });

  it("year is the active academic year's own span", () => {
    expect(rangeFor("year", TODAY, TERMS, ACTIVE_YEAR)).toEqual(["2025-09-08", "2026-07-08"]);
  });

  it("year is null when there is no active academic year", () => {
    expect(rangeFor("year", TODAY, TERMS, null)).toBeNull();
  });

  it("term picks the one term whose range covers today (none does here -- there's a gap after term 4 ends 07-02)", () => {
    expect(rangeFor("term", TODAY, TERMS, ACTIVE_YEAR)).toBeNull();
  });

  it("term picks the covering term when today actually falls inside one", () => {
    const inTerm3 = new Date("2026-03-01T00:00:00Z");
    expect(rangeFor("term", inTerm3, TERMS, ACTIVE_YEAR)).toEqual(["2026-02-02", "2026-04-24"]);
  });

  it("semester combines both terms of the pair (semester 2 = terms 3+4)", () => {
    const inTerm3 = new Date("2026-03-01T00:00:00Z");
    expect(rangeFor("semester", inTerm3, TERMS, ACTIVE_YEAR)).toEqual(["2026-02-02", "2026-07-02"]);
  });

  it("semester combines terms 1+2 for semester 1", () => {
    const inTerm2 = new Date("2025-12-01T00:00:00Z");
    expect(rangeFor("semester", inTerm2, TERMS, ACTIVE_YEAR)).toEqual(["2025-09-08", "2026-01-30"]);
  });

  it("semester is null when no term covers today, same as term", () => {
    expect(rangeFor("semester", TODAY, TERMS, ACTIVE_YEAR)).toBeNull();
  });

  it("week spans a month boundary correctly", () => {
    const endOfMonth = new Date("2026-08-31T12:00:00Z"); // a Monday
    expect(rangeFor("week", endOfMonth, TERMS, ACTIVE_YEAR)).toEqual(["2026-08-31", "2026-09-06"]);
  });

  it("passing terms from multiple academic years (unscoped) corrupts semester grouping -- callers MUST pre-scope terms to one academic year", () => {
    // academic_terms.term_no only repeats 1-4 WITHIN a year
    // (unique(tenant_id, academic_year_id, term_no)) -- rangeFor's semester
    // grouping keys purely on term_no, so handing it terms from two years
    // silently merges a prior year's same-numbered terms into the range.
    // This is exactly the bug AttendanceOverviewPage's query used to have
    // before it started filtering academic_terms by academic_year_id.
    const priorYearTerms3And4: TermRow[] = [
      { term_no: 3, starts_on: "2024-02-01", ends_on: "2024-04-20" },
      { term_no: 4, starts_on: "2024-04-23", ends_on: "2024-06-28" },
    ];
    const unscopedTerms = [...priorYearTerms3And4, ...TERMS];
    const inTerm3 = new Date("2026-03-01T00:00:00Z");
    // Correctly-scoped (current-year-only) terms give ["2026-02-02", "2026-07-02"]
    // -- see "semester combines both terms of the pair" above.
    expect(rangeFor("semester", inTerm3, unscopedTerms, ACTIVE_YEAR)).toEqual(["2024-02-01", "2026-07-02"]);
  });
});
