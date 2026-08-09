import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LineChart, type LineSeries } from "@/components/charts/Line";
import { toEthiopian, toIsoDate } from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";
import { IconFilter } from "@/features/dashboard/icons";
import { ATTENDANCE_VIEWS as VIEWS, rangeFor, type TermRow, type View } from "@/features/attendance/attendanceRange";

export type { TermRow, View };

const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";
const STATUS_OPTIONS = ["present", "absent", "late"] as const;
type StatusKey = (typeof STATUS_OPTIONS)[number];

// A fixed, distinguishable palette for record-row avatars, picked by a stable
// hash of the student id so the same student always gets the same colour.
const AVATAR_COLORS = ["#4C8DF6", "#EC3F8F", "#8B5CF6", "#22B8A0", "#F5972B", "#A3CE28", "#EC4B4B", "#6366F1"];
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

function daysBetweenIso(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function addDaysIso(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toIsoDate(d);
}
/** Same-length period immediately preceding `range`, used for both the
 *  Overall Rate trend arrow and the chart's dashed comparison line. */
function shiftRangeBack(range: [string, string]): [string, string] {
  const length = daysBetweenIso(range[0], range[1]) + 1;
  return [addDaysIso(range[0], -length), addDaysIso(range[1], -length)];
}
/** Day buckets for short ranges, weekly for a term/semester, monthly for a
 *  year — otherwise a year-long chart would need ~365 x-axis points. */
function buildBuckets(range: [string, string]): { start: string; end: string }[] {
  const totalDays = daysBetweenIso(range[0], range[1]) + 1;
  const bucketSize = totalDays <= 31 ? 1 : totalDays <= 120 ? 7 : 30;
  const buckets: { start: string; end: string }[] = [];
  let cursor = range[0];
  while (daysBetweenIso(cursor, range[1]) >= 0) {
    const remaining = daysBetweenIso(cursor, range[1]) + 1;
    const end = addDaysIso(cursor, Math.min(bucketSize, remaining) - 1);
    buckets.push({ start: cursor, end });
    cursor = addDaysIso(end, 1);
  }
  return buckets;
}
/** Terse EC day+month for a chart tick — the canonical conversion
 *  (toEthiopian), not a raw toLocaleDateString, just trimmed for space. */
function shortEthLabel(iso: string, monthNames: string[]): string {
  const e = toEthiopian(new Date(`${iso}T00:00:00Z`));
  return `${(monthNames[e.month - 1] ?? String(e.month)).slice(0, 3)} ${e.day}`;
}
function rateOf(rows: { status: string }[] | undefined): number | null {
  if (!rows || rows.length === 0) return null;
  const present = rows.filter((r) => r.status === "present").length;
  return Math.round((present / rows.length) * 1000) / 10;
}
function rateInRange(
  rows: { status: string; attendance_date: string }[] | undefined, start: string, end: string,
): number | null {
  return rateOf((rows ?? []).filter((r) => r.attendance_date >= start && r.attendance_date <= end));
}

export function AttendanceOverviewPage() {
  const { t } = useTranslation();
  const { t: tCal } = useTranslation("calendar");
  const monthNames = tCal("months", { returnObjects: true }) as string[];

  const [view, setView] = useState<View>("month");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<Set<StatusKey>>(() => new Set(["present", "absent"]));
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);

  const { data: classes } = useQuery({
    queryKey: ["attendance-classes"],
    queryFn: async () => (await supabase.from("classes")
      .select("id,name,section,grade_level").order("grade_level").order("section")).data ?? [],
  });
  const { data: activeYear } = useQuery({
    queryKey: ["attendance-active-year"],
    queryFn: async () => (await supabase.from("academic_years").select("id,starts_on,ends_on").eq("status", "active").maybeSingle()).data,
  });
  const { data: terms } = useQuery({
    queryKey: ["attendance-terms", activeYear?.id],
    enabled: !!activeYear?.id,
    queryFn: async () => (await supabase.from("academic_terms")
      .select("term_no,starts_on,ends_on").eq("academic_year_id", activeYear!.id).order("term_no")).data as TermRow[] ?? [],
  });

  const range = useMemo(() => rangeFor(view, new Date(), terms ?? [], activeYear), [view, terms, activeYear]);
  const prevRange = useMemo(() => (range ? shiftRangeBack(range) : null), [range]);

  const grades = useMemo(
    () => Array.from(new Set((classes ?? []).map((c) => c.grade_level).filter((g): g is number => g != null))).sort((a, b) => a - b),
    [classes],
  );
  const sections = useMemo(() => {
    const pool = (classes ?? []).filter((c) => gradeFilter === "all" || String(c.grade_level) === gradeFilter);
    return Array.from(new Set(pool.map((c) => c.section).filter((s): s is string => !!s))).sort();
  }, [classes, gradeFilter]);
  const filteredClassIds = useMemo(
    () => (classes ?? [])
      .filter((c) => gradeFilter === "all" || String(c.grade_level) === gradeFilter)
      .filter((c) => sectionFilter === "all" || c.section === sectionFilter)
      .map((c) => c.id),
    [classes, gradeFilter, sectionFilter],
  );
  const statusList = useMemo(() => Array.from(statusFilter), [statusFilter]);

  useEffect(() => { setSectionFilter("all"); }, [gradeFilter]);
  useEffect(() => { setVisibleCount(10); }, [view, gradeFilter, sectionFilter, statusFilter, atRiskOnly]);

  const { data: students, isLoading: studentsLoading } = useQuery({
    queryKey: ["attendance-students", filteredClassIds.join(",")],
    enabled: !!classes,
    queryFn: async () => {
      if (!filteredClassIds.length) return [];
      const { data, error } = await supabase.from("students")
        .select("id,admission_no,first_name,last_name,class_id")
        .in("class_id", filteredClassIds).eq("status", "active").order("first_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: attendanceCurrent } = useQuery({
    queryKey: ["attendance-current", range?.[0], range?.[1], filteredClassIds.join(","), statusList.join(",")],
    enabled: !!range && filteredClassIds.length > 0 && statusList.length > 0,
    queryFn: async () => {
      const [start, end] = range!;
      const { data, error } = await supabase.from("attendance")
        .select("student_id,class_id,status,attendance_date")
        .gte("attendance_date", start).lte("attendance_date", end)
        .in("class_id", filteredClassIds).in("status", statusList);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: attendancePrevious } = useQuery({
    queryKey: ["attendance-previous", prevRange?.[0], prevRange?.[1], filteredClassIds.join(","), statusList.join(",")],
    enabled: !!prevRange && filteredClassIds.length > 0 && statusList.length > 0,
    queryFn: async () => {
      const [start, end] = prevRange!;
      const { data, error } = await supabase.from("attendance")
        .select("student_id,class_id,status,attendance_date")
        .gte("attendance_date", start).lte("attendance_date", end)
        .in("class_id", filteredClassIds).in("status", statusList);
      if (error) throw error;
      return data ?? [];
    },
  });

  const todayIso = toIsoDate(new Date());
  const { data: absentToday } = useQuery({
    queryKey: ["attendance-absent-today", todayIso, filteredClassIds.join(",")],
    enabled: filteredClassIds.length > 0,
    queryFn: async () => {
      const { count, error } = await supabase.from("attendance")
        .select("id", { count: "exact", head: true })
        .eq("attendance_date", todayIso).eq("status", "absent").in("class_id", filteredClassIds);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Tenant-wide by design, like the dashboard's own at-risk card — the RPC
  // has no class/grade parameter, so this stat sits outside the Refine View
  // scope that governs everything else on the page.
  const { data: atRisk } = useQuery({
    queryKey: ["attendance-at-risk", range?.[0], range?.[1]],
    enabled: !!range,
    queryFn: async () => {
      const [start, end] = range!;
      const { data, error } = await supabase.rpc("dashboard_high_absence", { p_from: start, p_to: end, p_threshold: 10, p_limit: 100 });
      if (error) throw error;
      return (data ?? []) as { student_id: string }[];
    },
  });
  const atRiskIds = useMemo(() => new Set((atRisk ?? []).map((r) => r.student_id)), [atRisk]);

  const overallRate = rateOf(attendanceCurrent);
  const prevOverallRate = rateOf(attendancePrevious);
  const trendDelta = overallRate != null && prevOverallRate != null ? Math.round((overallRate - prevOverallRate) * 10) / 10 : null;

  const byClass = useMemo(() => {
    const m = new Map<string, { present: number; total: number }>();
    (attendanceCurrent ?? []).forEach((r) => {
      const e = m.get(r.class_id) ?? { present: 0, total: 0 };
      e.total += 1;
      if (r.status === "present") e.present += 1;
      m.set(r.class_id, e);
    });
    return m;
  }, [attendanceCurrent]);
  const highestClass = useMemo(() => {
    const candidates = [...byClass.entries()].flatMap(([classId, e]) => {
      const cls = (classes ?? []).find((c) => c.id === classId);
      if (!e.total || !cls) return [];
      const rate = Math.round((e.present / e.total) * 1000) / 10;
      return [{ label: `${cls.name}${cls.section ? ` ${cls.section}` : ""}`, rate }];
    });
    return candidates.reduce<{ label: string; rate: number } | null>(
      (best, c) => (!best || c.rate > best.rate ? c : best), null,
    );
  }, [byClass, classes]);

  const byStudent = useMemo(() => {
    const m = new Map<string, { present: number; absent: number }>();
    (attendanceCurrent ?? []).forEach((r) => {
      const e = m.get(r.student_id) ?? { present: 0, absent: 0 };
      if (r.status === "present") e.present += 1;
      else if (r.status === "absent") e.absent += 1;
      m.set(r.student_id, e);
    });
    return m;
  }, [attendanceCurrent]);

  const tableRows = useMemo(() => {
    let rows = (students ?? []).map((s) => {
      const cls = (classes ?? []).find((c) => c.id === s.class_id);
      const e = byStudent.get(s.id) ?? { present: 0, absent: 0 };
      return {
        id: s.id,
        name: `${s.first_name} ${s.last_name}`,
        admissionNo: s.admission_no,
        classLabel: cls ? `${cls.name}${cls.section ? ` ${cls.section}` : ""}` : "—",
        present: e.present,
        absent: e.absent,
        atRisk: atRiskIds.has(s.id),
      };
    });
    if (atRiskOnly) rows = rows.filter((r) => r.atRisk);
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  }, [students, classes, byStudent, atRiskIds, atRiskOnly]);
  const visibleRows = tableRows.slice(0, visibleCount);

  const chartBuckets = useMemo(() => (range ? buildBuckets(range) : []), [range]);
  const periodLength = range ? daysBetweenIso(range[0], range[1]) + 1 : 0;
  const chartSeries: LineSeries[] = useMemo(() => [
    {
      key: "current", label: t("attendance.currentPeriod"), color: "#1E3A5F",
      points: chartBuckets.map((b) => ({ x: shortEthLabel(b.start, monthNames), y: rateInRange(attendanceCurrent, b.start, b.end) ?? 0 })),
    },
    {
      key: "previous", label: t("attendance.previousPeriod"), color: "#94A3B8", dashed: true,
      points: chartBuckets.map((b) => {
        const pStart = addDaysIso(b.start, -periodLength);
        const pEnd = addDaysIso(b.end, -periodLength);
        return { x: shortEthLabel(b.start, monthNames), y: rateInRange(attendancePrevious, pStart, pEnd) ?? 0 };
      }),
    },
  ], [chartBuckets, attendanceCurrent, attendancePrevious, periodLength, monthNames, t]);

  const chartMarkers = useMemo(() => {
    const pts = chartSeries[0]?.points ?? [];
    if (!pts.length) return [];
    const lastIndex = pts.length - 1;
    let lowIndex = 0;
    pts.forEach((p, i) => { if (p.y < pts[lowIndex]!.y) lowIndex = i; });
    const marks = [{ seriesKey: "current", index: lastIndex, label: t("attendance.mostRecent") }];
    if (lowIndex !== lastIndex) marks.push({ seriesKey: "current", index: lowIndex, label: t("attendance.lowestPoint") });
    return marks;
  }, [chartSeries, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">{t("attendance.overview")}</h1>
        <SegmentedControl options={VIEWS.map((v) => ({ value: v, label: t(`attendance.period.${v}`) }))} value={view} onChange={setView} />
      </div>

      {!range ? (
        <Card className="py-12 text-center text-ink-faint">{t("attendance.noActivePeriod")}</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <Card className="h-fit space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <IconFilter className="h-4 w-4 text-ink-faint" />
              {t("attendance.refineView")}
            </div>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("attendance.gradeLevel")}</span>
              <select className={SELECT_CLS} value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
                <option value="all">{t("attendance.allGrades")}</option>
                {grades.map((g) => <option key={g} value={String(g)}>{t("students.profile.grade")} {g}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("crud.section")}</span>
              <select className={SELECT_CLS} value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)} disabled={!sections.length}>
                <option value="all">{t("attendance.allSections")}</option>
                {sections.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <div className="space-y-2">
              <span className="block text-xs font-medium uppercase tracking-wide text-ink-faint">{t("attendance.status")}</span>
              {STATUS_OPTIONS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={statusFilter.has(s)}
                    onChange={(e) => setStatusFilter((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s); else next.delete(s);
                      return next;
                    })}
                  />
                  {t(`attendance.${s}`)}
                </label>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <p className="text-sm text-ink-soft">{t("attendance.overallRate")}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{overallRate != null ? `${overallRate}%` : "—"}</p>
                {trendDelta != null && (
                  <p className={cn("mt-1 text-xs font-medium", trendDelta >= 0 ? "text-ok" : "text-danger")}>
                    {trendDelta >= 0 ? "▲" : "▼"} {Math.abs(trendDelta)}% {t("attendance.vsPreviousPeriod")}
                  </p>
                )}
              </Card>
              <Card>
                <p className="text-sm text-ink-soft">{t("attendance.totalAbsencesToday")}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{absentToday ?? 0}</p>
                <p className="mt-1 text-xs text-ink-faint">{t("nav.students")}</p>
              </Card>
              <Card>
                <p className="text-sm text-ink-soft">{t("attendance.highestAttendance")}</p>
                <p className="mt-1 truncate font-display text-lg font-bold text-ink">{highestClass?.label ?? "—"}</p>
                <p className="mt-1 text-xs text-ink-faint">{highestClass ? `${highestClass.rate}% ${t("attendance.average")}` : ""}</p>
              </Card>
              <Card className="border-l-4 border-danger">
                <p className="text-sm text-ink-soft">{t("attendance.atRiskStudents")}</p>
                <p className="mt-1 font-display text-2xl font-bold text-ink">{atRisk?.length ?? 0}</p>
                <button type="button" onClick={() => setAtRiskOnly(true)} className="mt-1 text-xs font-medium text-danger hover:underline">
                  {t("attendance.review")} →
                </button>
              </Card>
            </div>

            <Card>
              <h2 className="font-display text-base font-semibold text-ink">
                {t("attendance.trendTitle", { period: t(`attendance.period.${view}`) })}
              </h2>
              <LineChart series={chartSeries} markers={chartMarkers} className="mt-3" formatY={(n) => `${n}%`} emptyLabel={t("attendance.noRecords")} />
            </Card>

            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-base font-semibold text-ink">{t("attendance.detailedRecords")}</h2>
                {atRiskOnly && (
                  <button type="button" onClick={() => setAtRiskOnly(false)} className="text-xs font-medium text-navy hover:underline">
                    {t("attendance.clearFilter")}
                  </button>
                )}
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs font-medium text-ink-soft">
                      <th className="px-3 py-2">{t("attendance.name")}</th>
                      <th className="px-3 py-2">{t("students.admissionNo")}</th>
                      <th className="px-3 py-2">{t("attendance.class")}</th>
                      <th className="px-3 py-2">{t("attendance.presentDays")}</th>
                      <th className="px-3 py-2">{t("attendance.absentDays")}</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {studentsLoading || !visibleRows.length ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-ink-faint">
                          {studentsLoading ? "…" : t("attendance.noRecords")}
                        </td>
                      </tr>
                    ) : visibleRows.map((r) => (
                      <tr key={r.id} className={cn("border-t border-line", r.atRisk && "border-l-4 border-l-danger")}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={r.name} size="sm" color={colorFor(r.id)} />
                            <span className="font-medium text-ink">{r.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-ink-soft">{r.admissionNo}</td>
                        <td className="px-3 py-2.5 text-ink-soft">{r.classLabel}</td>
                        <td className="px-3 py-2.5 text-ink">{r.present}</td>
                        <td className={cn("px-3 py-2.5", r.absent > 0 ? "font-medium text-danger" : "text-ink")}>{r.absent}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Link to={`/students/${r.id}`} className="text-xs font-medium text-navy hover:underline">
                            {t("attendance.viewHistory")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {visibleCount < tableRows.length && (
                <div className="mt-3 text-center">
                  <Button variant="tertiary" onClick={() => setVisibleCount((n) => n + 10)}>{t("attendance.loadMore")}</Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
