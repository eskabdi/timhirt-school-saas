// The default 8-period school day seeded for a new tenant (onboard-tenant),
// the same grid 20260802000006 backfilled onto every tenant that existed
// then. Without it Timetable Editor opens to a grid with no period rows.
//
// Every row carries every column, is_break included: PostgREST builds a bulk
// insert from the union of the rows' keys and sends NULL (not the column
// default) for a key a row lacks, so a single `is_break: true` on the Break
// row made the other eight NULL, and periods.is_break is NOT NULL. That
// failed every onboarding with a 500 and rolled the new school back
// (production logs 2026-10-17).
export interface PeriodSeed {
  tenant_id: string;
  period_no: number;
  label: string;
  starts_at: string;
  ends_at: string;
  is_break: boolean;
}

const GRID: readonly [label: string, starts_at: string, ends_at: string, is_break: boolean][] = [
  ["Period 1", "08:30", "09:10", false],
  ["Period 2", "09:10", "09:50", false],
  ["Period 3", "09:50", "10:30", false],
  ["Period 4", "10:30", "11:10", false],
  ["Break", "11:10", "11:30", true],
  ["Period 5", "11:30", "12:10", false],
  ["Period 6", "12:10", "12:50", false],
  ["Period 7", "12:50", "13:30", false],
  ["Period 8", "13:30", "14:10", false],
];

export function defaultPeriods(tenantId: string): PeriodSeed[] {
  return GRID.map(([label, starts_at, ends_at, is_break], i) => ({
    tenant_id: tenantId, period_no: i + 1, label, starts_at, ends_at, is_break,
  }));
}
