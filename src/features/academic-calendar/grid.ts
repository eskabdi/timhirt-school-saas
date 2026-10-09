// ============================================================================
// Academic Calendar grid engine: the MoE "ዓመታዊ የትምህርት ጊዜ ሰሌዳ" layout as
// data. One row per EC month (an optional lead-in row carries the end of the
// previous year), 37 weekday columns Monday-first (ሰ ማ ረ ሐ ዓ ቅ እ × 5 + ሰ ማ),
// each day under its own weekday, and a ድምር column counting school days.
// The same function feeds the web page, print and the PDF.
//
// Day classification is the TypeScript twin of SQL `calendar_day_status`:
//   * the shown type is the highest-precedence of the entries covering the
//     day and the weekend (closure > holiday > break > admin > staff > exam >
//     milestone > event > weekend > instructional);
//   * a day counts in ድምር when it is inside the session, not a weekend day,
//     and every entry covering it counts as instructional (an exam or a
//     parent meeting does; a holiday or break does not).
// Dates are Gregorian ISO strings (§17.2); EC is computed here for layout.
// ============================================================================
import { daysInEthMonth, toEthiopian, toGregorian } from "@/lib/ethiopian-date";

export const GRID_COLUMNS = 37;

export type DayCategory =
  | "teaching" | "rest" | "holiday" | "break" | "exam" | "admin" | "staff"
  | "event" | "milestone" | "closure";

/** Lower is stronger. Out-of-session and instructional are not entry categories. */
const PRECEDENCE: Record<DayCategory, number> = {
  closure: 1, holiday: 2, break: 3, admin: 4, staff: 5, exam: 6, milestone: 7, event: 8, rest: 9, teaching: 10,
};

export interface GridDayType {
  code: string;
  category: DayCategory;
  color: string;
  countsAsInstructional: boolean;
}

export interface GridEntry {
  id: string;
  dayTypeCode: string;
  startsOn: string; // ISO, inclusive
  endsOn: string;   // ISO, inclusive
}

export interface GridCell {
  ecDay: number;
  ecMonth: number;
  ecYear: number;
  isoDate: string;
  weekday: number; // 0 = Monday … 6 = Sunday
  /** Shown type: an entry's day-type code, "weekend", "instructional" or "out_of_session". */
  dayType: string;
  counts: boolean;
  entryIds: string[];
  isToday: boolean;
}

export interface GridRow {
  kind: "lead_in" | "month";
  ecYear: number;
  /** The month the row is labelled with (for the lead-in, the previous year's last month shown). */
  ecMonth: number;
  cells: (GridCell | null)[];
  /** School days in the row; null when no day of it is in session (shown "–"). */
  total: number | null;
}

export interface YearGrid {
  /** Weekday index (0 = Monday) of each of the 37 columns. */
  header: number[];
  rows: GridRow[];
  total: number;
}

export interface BuildYearGridInput {
  ecYear: number;
  /** The session the ድምር column counts: may start in the previous EC year (the MoE lead-in). */
  sessionStartsOn: string;
  sessionEndsOn: string;
  entries: readonly GridEntry[];
  dayTypes: readonly GridDayType[];
  /** ISO weekdays that are rest days, 1 = Monday … 7 = Sunday. */
  weekendDays?: readonly number[];
  today?: string;
}

const DAY_MS = 86_400_000;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (iso: string) => new Date(`${iso}T00:00:00Z`);
const mondayFirst = (d: Date) => (d.getUTCDay() + 6) % 7;

export function buildYearGrid(input: BuildYearGridInput): YearGrid {
  const { ecYear, sessionStartsOn, sessionEndsOn, entries, today } = input;
  const weekend = new Set((input.weekendDays ?? [6, 7]).map((d) => d - 1));
  const types = new Map(input.dayTypes.map((t) => [t.code, t]));

  const cellFor = (d: Date): GridCell => {
    const iso = isoOf(d);
    const ec = toEthiopian(d);
    const weekday = mondayFirst(d);
    const inSession = iso >= sessionStartsOn && iso <= sessionEndsOn;
    const covering = entries.filter((e) => e.startsOn <= iso && e.endsOn >= iso && types.has(e.dayTypeCode));
    let shown = inSession ? "instructional" : "out_of_session";
    let rank = PRECEDENCE.teaching;
    if (weekend.has(weekday)) { shown = "weekend"; rank = PRECEDENCE.rest; }
    for (const e of covering) {
      const r = PRECEDENCE[types.get(e.dayTypeCode)!.category];
      if (r < rank) { rank = r; shown = e.dayTypeCode; }
    }
    const counts = inSession && !weekend.has(weekday)
      && covering.every((e) => types.get(e.dayTypeCode)!.countsAsInstructional);
    return {
      ecDay: ec.day, ecMonth: ec.month, ecYear: ec.year, isoDate: iso, weekday, dayType: shown, counts,
      entryIds: covering.map((e) => e.id), isToday: iso === today,
    };
  };

  const rowTotal = (cells: (GridCell | null)[]) => {
    const present = cells.filter((c): c is GridCell => c !== null);
    const inSession = present.some((c) => c.isoDate >= sessionStartsOn && c.isoDate <= sessionEndsOn);
    return inSession ? present.filter((c) => c.counts).length : null;
  };

  const rows: GridRow[] = [];
  const yearStart = toGregorian({ year: ecYear, month: 1, day: 1 });

  // Lead-in: the days of the previous EC year that are in this session (the
  // MoE sheet's "ነሀሴ/2018" row), packed into one row as late as they fit.
  if (sessionStartsOn < isoOf(yearStart)) {
    const days: Date[] = [];
    for (let d = dateOf(sessionStartsOn); d.getTime() < yearStart.getTime(); d = new Date(d.getTime() + DAY_MS)) days.push(d);
    const n = Math.min(days.length, GRID_COLUMNS);
    const shown = days.slice(days.length - n);
    const firstShown = shown[0]!; // the session starts before the year, so at least one day
    const wd = mondayFirst(firstShown);
    const start = wd + 7 * Math.max(0, Math.floor((GRID_COLUMNS - n - wd) / 7));
    const cells: (GridCell | null)[] = Array(GRID_COLUMNS).fill(null);
    shown.forEach((d, i) => { cells[start + i] = cellFor(d); });
    const prev = toEthiopian(firstShown);
    rows.push({ kind: "lead_in", ecYear: prev.year, ecMonth: prev.month, cells, total: rowTotal(cells) });
  }

  for (let m = 1; m <= 13; m++) {
    const first = toGregorian({ year: ecYear, month: m, day: 1 });
    const offset = mondayFirst(first);
    const cells: (GridCell | null)[] = Array(GRID_COLUMNS).fill(null);
    for (let day = 1; day <= daysInEthMonth(ecYear, m); day++) {
      cells[offset + day - 1] = cellFor(new Date(first.getTime() + (day - 1) * DAY_MS));
    }
    const total = rowTotal(cells);
    // Pagume is shown only when part of it is in session; otherwise the
    // next year's lead-in carries it, as on the MoE sheet.
    if (m === 13 && total === null) continue;
    rows.push({ kind: "month", ecYear, ecMonth: m, cells, total });
  }

  return {
    header: Array.from({ length: GRID_COLUMNS }, (_, i) => i % 7),
    rows,
    total: rows.reduce((s, r) => s + (r.total ?? 0), 0),
  };
}
