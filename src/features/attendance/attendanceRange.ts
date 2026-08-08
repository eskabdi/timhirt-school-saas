import { toIsoDate } from "@/lib/ethiopian-date";

const VIEWS = ["day", "week", "month", "term", "semester", "year"] as const;
export type View = (typeof VIEWS)[number];
export const ATTENDANCE_VIEWS = VIEWS;

export interface TermRow { term_no: number; starts_on: string; ends_on: string }

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday-start week
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}
function endOfWeek(d: Date): Date {
  const mon = startOfWeek(d);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun;
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }

/** Resolves a view option to a concrete [start, end] Gregorian date range
 *  (attendance_date is canonical Gregorian storage, §17.2). Day/Week/Month
 *  are always "the one containing today" -- no separate period picker, to
 *  keep this a single view-mode switch rather than a full date-range UI.
 *  Term/Semester key off academic_terms.term_no the same way
 *  AcademicYearsPage does: semester = ceil(term_no / 2), so semester 1 is
 *  terms 1-2 and semester 2 is terms 3-4. Returns null when the view needs
 *  data that doesn't exist yet (no term covers today, or no active year). */
export function rangeFor(view: View, today: Date, terms: TermRow[], activeYear: { starts_on: string; ends_on: string } | undefined | null): [string, string] | null {
  const todayIso = toIsoDate(today);
  if (view === "day") return [todayIso, todayIso];
  if (view === "week") return [toIsoDate(startOfWeek(today)), toIsoDate(endOfWeek(today))];
  if (view === "month") return [toIsoDate(startOfMonth(today)), toIsoDate(endOfMonth(today))];
  if (view === "year") return activeYear ? [activeYear.starts_on, activeYear.ends_on] : null;

  const currentTerm = terms.find((t) => t.starts_on <= todayIso && todayIso <= t.ends_on);
  if (!currentTerm) return null;
  if (view === "term") return [currentTerm.starts_on, currentTerm.ends_on];

  // semester -- currentTerm is always a member of its own semester group, so
  // semesterTerms is never empty here.
  const semester = Math.ceil(currentTerm.term_no / 2);
  const semesterTerms = terms.filter((t) => Math.ceil(t.term_no / 2) === semester);
  const starts = semesterTerms.map((t) => t.starts_on).sort();
  const ends = semesterTerms.map((t) => t.ends_on).sort();
  return [starts[0]!, ends[ends.length - 1]!];
}
