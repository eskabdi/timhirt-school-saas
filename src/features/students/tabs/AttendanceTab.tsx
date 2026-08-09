import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EthDate } from "@/components/EthDate";
import { toEthiopian } from "@/lib/ethiopian-date";

const GC_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const gc = (s: string) => { const d = new Date(s + "T00:00:00Z"); return `${GC_MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const EC_MON_ABBR = ["MES", "TIQ", "HID", "TAH", "TIR", "YEK", "MEG", "MIY", "GIN", "SEN", "HAM", "NEH", "PAG"];
const STATUS_TONE: Record<string, "ok" | "danger" | "late" | "neutral"> = { present: "ok", absent: "danger", late: "late", excused: "neutral" };
const cellColor = (s: string) => (s === "present" || s === "excused" ? "bg-ok" : s === "absent" ? "bg-danger" : s === "holiday" ? "bg-warn" : "bg-line");
const PAGE = 10;

interface Att { attendance_date: string; status: string; reason: string | null; recorded_by: string; }

export function AttendanceTab({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);

  const { data: rows } = useQuery({
    queryKey: ["attendance-log", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("attendance")
        .select("attendance_date, status, reason, recorded_by").eq("student_id", studentId).order("attendance_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Att[];
    },
  });
  const { data: markers } = useQuery({
    queryKey: ["attendance-markers", studentId, rows?.length],
    enabled: !!rows?.length,
    queryFn: async () => {
      const ids = [...new Set(rows!.map((r) => r.recorded_by).filter(Boolean))];
      if (!ids.length) return new Map<string, string>();
      const { data } = await supabase.from("users").select("id, full_name").in("id", ids);
      return new Map((data ?? []).map((u) => [u.id, u.full_name]));
    },
  });

  const insights = useMemo(() => {
    const excused = (rows ?? []).filter((r) => r.status === "excused").length;
    const unexcused = (rows ?? []).filter((r) => r.status === "absent").length;
    return { excused, unexcused };
  }, [rows]);

  const byMonth = useMemo(() => {
    const m = new Map<number, { day: number; status: string }[]>();
    for (const r of rows ?? []) {
      const e = toEthiopian(new Date(r.attendance_date + "T00:00:00Z"));
      const arr = m.get(e.month) ?? [];
      arr.push({ day: e.day, status: r.status });
      m.set(e.month, arr);
    }
    return m;
  }, [rows]);

  const paged = (rows ?? []).slice((page - 1) * PAGE, page * PAGE);
  const totalPages = Math.max(1, Math.ceil((rows?.length ?? 0) / PAGE));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Yearly trend heatmap */}
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">{t("attendanceTab.yearlyTrend")}</h2>
              <p className="text-xs text-ink-faint">{t("attendanceTab.academicYear")}</p>
            </div>
            <div className="flex gap-3 text-xs text-ink-soft">
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-ok" />{t("attendance.present")}</span>
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-danger" />{t("attendance.absent")}</span>
              <span className="flex items-center gap-1"><i className="h-3 w-3 rounded-sm bg-warn" />{t("attendanceTab.holiday")}</span>
            </div>
          </div>
          {byMonth.size ? (
            <div className="grid grid-cols-3 gap-4">
              {[...byMonth.entries()].map(([month, days]) => (
                <div key={month}>
                  <p className="mb-1 text-xs font-semibold text-ink-faint">{EC_MON_ABBR[month - 1]}</p>
                  <div className="grid grid-cols-6 gap-1">
                    {days.map((d, i) => <i key={i} title={`${t("attendanceTab.day")} ${d.day}: ${t(`attendance.${d.status}`, d.status)}`} className={`h-4 w-4 rounded-sm ${cellColor(d.status)}`} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="py-8 text-center text-ink-faint">{t("attendanceTab.noRecords")}</p>}
        </Card>

        {/* Absence insights */}
        <Card>
          <h2 className="font-display text-lg font-bold text-ink">{t("attendanceTab.absenceInsights")}</h2>
          <div className="mt-3 space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm"><Badge tone="ok">{t("attendance.excused")}</Badge><span className="text-ink-faint">{t("attendanceTab.absencesCount", { count: insights.excused })}</span></div>
              <div className="mt-1 h-2 rounded-full bg-ok-tint"><div className="h-2 rounded-full bg-ok" style={{ width: `${insights.excused + insights.unexcused ? (insights.excused / (insights.excused + insights.unexcused)) * 100 : 0}%` }} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm"><Badge tone="danger">{t("attendanceTab.unexcused")}</Badge><span className="text-ink-faint">{t("attendanceTab.absencesCount", { count: insights.unexcused })}</span></div>
              <div className="mt-1 h-2 rounded-full bg-danger-tint"><div className="h-2 rounded-full bg-danger" style={{ width: `${insights.excused + insights.unexcused ? (insights.unexcused / (insights.excused + insights.unexcused)) * 100 : 0}%` }} /></div>
            </div>
          </div>
        </Card>
      </div>

      {/* Attendance log */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">{t("attendanceTab.logTitle")}</h2>
            <p className="text-xs text-ink-faint">{t("attendanceTab.completeHistory")}</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">{t("attendanceTab.dateGc")}</th><th className="px-4 py-2">{t("attendanceTab.dateEc")}</th><th className="px-4 py-2">{t("students.status")}</th><th className="px-4 py-2">{t("attendanceTab.reasonNote")}</th><th className="px-4 py-2">{t("attendanceTab.markedBy")}</th><th className="px-4 py-2 no-print">{t("audit.action")}</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {paged.length ? paged.map((r, i) => (
              <tr key={i} className={r.status === "absent" ? "bg-danger-tint/40" : ""}>
                <td className="px-4 py-3 text-ink">{gc(r.attendance_date)}</td>
                <td className="px-4 py-3 text-ink-soft"><EthDate value={r.attendance_date} /></td>
                <td className="px-4 py-3"><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`attendance.${r.status}`, r.status)}</Badge></td>
                <td className="px-4 py-3 text-ink-soft">{r.reason || "-"}</td>
                <td className="px-4 py-3 text-ink-soft">{markers?.get(r.recorded_by) ?? "—"}</td>
                <td className="px-4 py-3 no-print"><button className="text-navy hover:underline">{t("attendanceTab.viewDetail")}</button></td>
              </tr>
            )) : <tr><td colSpan={6} className="py-10 text-center text-ink-faint">{t("attendanceTab.noRecords")}</td></tr>}
          </tbody>
        </table>
        {(rows?.length ?? 0) > PAGE && (
          <div className="mt-3 flex items-center justify-between text-sm text-ink-faint">
            <span>{t("attendanceTab.showing", { from: (page - 1) * PAGE + 1, to: Math.min(page * PAGE, rows!.length), total: rows!.length })}</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="no-print rounded border border-line px-2 py-1 disabled:opacity-40">‹</button>
              <span className="rounded bg-navy px-3 py-1 text-white">{page}</span>
              <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="no-print rounded border border-line px-2 py-1 disabled:opacity-40">›</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
