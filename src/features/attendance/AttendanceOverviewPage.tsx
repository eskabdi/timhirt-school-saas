import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { toIsoDate } from "@/lib/ethiopian-date";

const VIEWS = ["day", "week", "month", "term", "semester", "year"] as const;
export type View = (typeof VIEWS)[number];

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

export function AttendanceOverviewPage() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("month");

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: async () => (await supabase.from("classes").select("id,name,section").order("grade_level").order("section")).data ?? [],
  });
  const { data: activeYear } = useQuery({
    queryKey: ["attendance-active-year"],
    queryFn: async () => (await supabase.from("academic_years").select("starts_on,ends_on").eq("status", "active").maybeSingle()).data,
  });
  const { data: terms } = useQuery({
    queryKey: ["attendance-terms"],
    queryFn: async () => (await supabase.from("academic_terms").select("term_no,starts_on,ends_on").order("term_no")).data as TermRow[] ?? [],
  });

  const range = useMemo(() => rangeFor(view, new Date(), terms ?? [], activeYear), [view, terms, activeYear]);

  const { data: summary } = useQuery({
    queryKey: ["attendance-summary", range?.[0], range?.[1]],
    enabled: !!range,
    queryFn: async () => {
      const [start, end] = range!;
      const { data, error } = await supabase.from("attendance")
        .select("class_id, status").gte("attendance_date", start).lte("attendance_date", end);
      if (error) throw error;
      return data;
    },
  });
  const byClass = new Map<string, { present: number; absent: number }>();
  summary?.forEach((r) => {
    const e = byClass.get(r.class_id) ?? { present: 0, absent: 0 };
    if (r.status === "present") e.present++; else if (r.status === "absent") e.absent++;
    byClass.set(r.class_id, e);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t("attendance.overview")}</h1>
        <div className="flex overflow-hidden rounded-control border border-line">
          {VIEWS.map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-medium ${view === v ? "bg-navy text-white" : "bg-card text-ink-soft hover:bg-sidebar"}`}>
              {t(`attendance.period.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {!range ? (
        <Card className="py-12 text-center text-ink-faint">{t("attendance.noActivePeriod")}</Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {classes?.map((c) => {
            const e = byClass.get(c.id) ?? { present: 0, absent: 0 };
            const total = e.present + e.absent;
            const pct = total ? Math.round((e.present / total) * 100) : 0;
            return (
              <Card key={c.id}>
                <p className="font-medium text-ink">{c.name} {c.section}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{pct}%</p>
                <p className="text-xs text-ink-faint">{t("attendance.presentAbsent", { present: e.present, absent: e.absent })}</p>
              </Card>
            );
          })}
          {!classes?.length && <Card className="py-12 text-center text-ink-faint md:col-span-3">{t("crud.noClasses")}</Card>}
        </div>
      )}
    </div>
  );
}
