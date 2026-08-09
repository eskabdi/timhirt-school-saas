// M-5 regression test — EC engine parity. `ec_year_of()` (Postgres, migration
// 010) must agree with `toEthiopian(...).year` (the JS/Deno facade) for every
// day across a wide range, including the Pagume 5/6 and Sep 11/12 boundaries
// that the old SQL approximation (`case when month >= 9 then 7 else 8`) got
// wrong. Since we can't execute live Postgres in this test run, this file
// re-implements ec_year_of()'s exact arithmetic in TypeScript (a literal
// transcription of the SQL — see migration 010's comment for the formula)
// and property-tests it against toEthiopian(...).year. Run the pgTAP
// equivalent (`supabase/tests/rls/`) against a live Postgres before trusting
// this in production, since a transcription error here wouldn't be caught by
// this test alone — it would only prove self-consistency of the TS port.
import { describe, it, expect } from "vitest";
import { toEthiopian } from "@/lib/ethiopian-date";

const fdiv = (a: number, b: number) => Math.floor(a / b);
const ERA = 1723856;

/** Literal TS transcription of migration 010's ec_year_of() SQL formula. */
function ecYearOfSql(g: Date): number {
  const y = g.getUTCFullYear(), m = g.getUTCMonth() + 1, d = g.getUTCDate();
  const a = fdiv(14 - m, 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  const jdn = d + fdiv(153 * mm + 2, 5) + 365 * yy + fdiv(yy, 4) - fdiv(yy, 100) + fdiv(yy, 400) - 32045;
  const rem = jdn - ERA - 1461 * fdiv(jdn - ERA, 1461); // mod(jdn-ERA, 1461), nonneg for realistic dates
  return 4 * fdiv(jdn - ERA, 1461) + fdiv(rem, 365) - fdiv(rem, 1460);
}

describe("EC-year engine parity (M-5 regression)", () => {
  it("ec_year_of(SQL port) matches toEthiopian(...).year across 50+ EC years", () => {
    let checked = 0;
    for (let y = 1975; y <= 2030; y++) {
      for (const [m, d] of [[1, 1], [6, 15], [11, 30], [12, 25]] as const) {
        const g = new Date(Date.UTC(y, m - 1, d));
        expect(ecYearOfSql(g)).toBe(toEthiopian(g).year);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it("agrees exactly at the Sep 11/12 EC new-year boundary, both sides", () => {
    // Straddle several new-year transitions, both leap and common preceding years.
    const boundaryYears = [2023, 2024, 2025, 2026, 2027];
    for (const gy of boundaryYears) {
      for (const [m, d] of [[9, 9], [9, 10], [9, 11], [9, 12], [9, 13]] as const) {
        const g = new Date(Date.UTC(gy, m - 1, d));
        expect(ecYearOfSql(g)).toBe(toEthiopian(g).year);
      }
    }
  });

  it("agrees exactly across every Pagume day (5-day and 6-day years alike)", () => {
    // Walk a whole Gregorian year day-by-day to hit every Pagume date that
    // occurs within it, for both an EC-leap-adjacent and non-adjacent year.
    for (const gy of [2023, 2024]) {
      for (let doy = 0; doy < 366; doy++) {
        const g = new Date(Date.UTC(gy, 0, 1 + doy));
        if (g.getUTCFullYear() !== gy) break;
        expect(ecYearOfSql(g)).toBe(toEthiopian(g).year);
      }
    }
  });
});
