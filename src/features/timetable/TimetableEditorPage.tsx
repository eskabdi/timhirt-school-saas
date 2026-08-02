import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import { formatEth } from "@/lib/ethiopian-date";
import { TimetableSlotModal, type ExistingSlot } from "./TimetableSlotModal";
import { GenerateTimetableModal } from "./GenerateTimetableModal";
import { buildTimetablePdf } from "./timetable-pdf";

// dow indexes the shared `weekdays` array in common.json (1 = Sunday), so the
// day names come from i18n rather than being duplicated here.
const DAYS = [2, 3, 4, 5, 6];
// Subject → colour family (left border + tint), matching the reference cards.
const PALETTE = [
  { bar: "#1a56db", bg: "#eff4ff", text: "#1a56db" },
  { bar: "#006c4a", bg: "#e8f6f0", text: "#006c4a" },
  { bar: "#b45309", bg: "#faf3e8", text: "#92400e" },
  { bar: "#b91c1c", bg: "#fdeeee", text: "#b91c1c" },
  { bar: "#6d28d9", bg: "#f3eefb", text: "#6d28d9" },
];
const colorFor = (key: string) => PALETTE[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length]!;
const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

interface Period { id: string; period_no: number; label: string | null; starts_at: string; ends_at: string; is_break: boolean }
interface Slot {
  id: string; day_of_week: number; period_id: string; room: string | null;
  class_id: string; teacher_id: string; subject_id: string;
  subjects: { name_i18n: Record<string, string>; code: string } | null;
  teachers: { staff_no: string; users: { full_name: string } | null } | null;
  classes: { name: string; section: string | null } | null;
}

export function TimetableEditorPage() {
  const { t, i18n } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const [view, setView] = useState<"Weekly" | "Teacher View" | "Room View">("Weekly");
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [room, setRoom] = useState("");
  const [cell, setCell] = useState<{ dayOfWeek: number; periodId: string; existing: ExistingSlot | null } | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const tenantId = profile?.tenant_id ?? "";

  const { data: classes } = useQuery({
    queryKey: ["tt-classes", tenantId], enabled: !!tenantId,
    queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level").order("grade_level")).data ?? [],
  });
  const { data: teachers } = useQuery({
    queryKey: ["tt-teachers", tenantId], enabled: !!tenantId,
    queryFn: async () => (await supabase.from("teachers").select("id,staff_no,users(full_name)").order("staff_no")).data ?? [],
  });
  const { data: periods } = useQuery({
    queryKey: ["periods", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("periods").select("id,period_no,label,starts_at,ends_at,is_break")
        .eq("tenant_id", tenantId).order("period_no");
      if (error) throw error;
      return (data ?? []) as Period[];
    },
  });
  const { data: slots } = useQuery({
    queryKey: ["timetable-slots", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("timetable_slots")
        .select("id, day_of_week, period_id, room, class_id, teacher_id, subject_id, subjects(name_i18n, code), teachers(staff_no, users(full_name)), classes(name, section)");
      if (error) throw error;
      return (data ?? []) as unknown as Slot[];
    },
  });
  const { data: assignments } = useQuery({
    queryKey: ["class-subject-teachers", classId], enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase.from("class_subject_teachers")
        .select("id, subject_id, periods_per_week, subjects(name_i18n, code)").eq("class_id", classId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const teachingPeriods = useMemo(() => (periods ?? []).filter((p) => !p.is_break), [periods]);

  const rooms = useMemo(() => [...new Set((slots ?? []).map((s) => s.room).filter((r): r is string => !!r))].sort(), [slots]);

  // The grid always shows every period (including breaks, rendered inert) so
  // an entirely empty period is a visible row to fill, not an invisible gap.
  const filtered = useMemo(() => {
    if (view === "Weekly") return (slots ?? []).filter((s) => !classId || s.class_id === classId);
    if (view === "Teacher View") return (slots ?? []).filter((s) => !teacherId || s.teacher_id === teacherId);
    return (slots ?? []).filter((s) => !room || s.room === room);
  }, [slots, view, classId, teacherId, room]);

  const cellFor = (dow: number, periodId: string) => filtered.find((s) => s.day_of_week === dow && s.period_id === periodId);

  const health = useMemo(() => {
    const cells = teachingPeriods.length * DAYS.length;
    const scoped = classId ? (slots ?? []).filter((s) => s.class_id === classId) : (slots ?? []);
    const coverage = cells ? Math.round((scoped.length / cells) * 100) : 0;
    const teacherSet = new Set((slots ?? []).map((s) => s.teacher_id));
    const util = teacherSet.size ? Math.min(100, Math.round(((slots ?? []).length / (teacherSet.size * teachingPeriods.length || 1)) * 100)) : 0;
    return { coverage, util };
  }, [slots, classId, teachingPeriods]);

  const progress = useMemo(() => {
    if (!classId || !assignments) return [];
    const placed = new Map<string, number>();
    for (const s of slots ?? []) {
      if (s.class_id !== classId) continue;
      placed.set(s.subject_id, (placed.get(s.subject_id) ?? 0) + 1);
    }
    return assignments
      .filter((a) => a.periods_per_week != null)
      .map((a) => ({
        label: tField((a.subjects as any)?.name_i18n, i18n.resolvedLanguage!) || (a.subjects as any)?.code,
        placed: placed.get(a.subject_id) ?? 0,
        target: a.periods_per_week!,
      }));
  }, [classId, assignments, slots, i18n.resolvedLanguage]);

  const openCell = (dayOfWeek: number, period: Period) => {
    if (view !== "Weekly" || !classId || period.is_break) return;
    const existingSlot = cellFor(dayOfWeek, period.id);
    setCell({
      dayOfWeek, periodId: period.id,
      existing: existingSlot
        ? { id: existingSlot.id, subjectId: existingSlot.subject_id, teacherId: existingSlot.teacher_id, room: existingSlot.room }
        : null,
    });
  };

  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const cls = classes?.find((c) => c.id === classId);
      const blob = await buildTimetablePdf({
        schoolName: t("app.name"),
        scopeLabel: cls ? `${cls.name} ${cls.section ?? ""}`.trim() : t("crud.allGrades"),
        periods: teachingPeriods.map((p) => ({ label: p.label ?? `${t("crud.time")} ${p.period_no}`, starts_at: p.starts_at, ends_at: p.ends_at })),
        days: DAYS.map((dow) => weekdays[dow] ?? ""),
        cells: DAYS.map((dow) => teachingPeriods.map((p) => {
          const s = cellFor(dow, p.id);
          if (!s) return null;
          return {
            subject: tField(s.subjects?.name_i18n, i18n.resolvedLanguage!) || s.subjects?.code || "",
            teacher: s.teachers?.users?.full_name ?? s.teachers?.staff_no ?? "",
            room: s.room ?? "",
          };
        })),
        issuedOn: formatEth(new Date(), { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") }),
        labels: { title: t("crud.timetableMaster"), issued: t("idCards.issued") },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "timetable.pdf"; a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">{t("crud.timetableMaster")}</h1>
          <p className="text-sm text-ink-faint">{t("attendanceTab.academicYear")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-control border border-line">
            {(["Weekly", "Teacher View", "Room View"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium ${view === v ? "bg-navy-wash text-navy" : "bg-card text-ink-soft"}`}>{v}</button>
            ))}
          </div>
          <Button variant="ghost" className="border border-line" onClick={exportPdf} disabled={pdfBusy}>
            ⬇ {pdfBusy ? t("academicRecord.preparing") : t("crud.exportPdf")}
          </Button>
          <Button variant="ghost" className="border border-line" onClick={() => window.print()}>🖨 {t("crud.print")}</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {view === "Weekly" && (
          <>
            <span className="text-sm text-ink-soft">{t("crud.grade")}</span>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink">
              <option value="">{t("crud.allGrades")}</option>
              {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
            </select>
            {!classId && <span className="text-xs text-ink-faint">{t("timetable.pickGradeToEdit")}</span>}
          </>
        )}
        {view === "Teacher View" && (
          <>
            <span className="text-sm text-ink-soft">{t("timetable.teacher")}</span>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink">
              <option value="">{t("timetable.selectTeacher")}</option>
              {teachers?.map((tc) => <option key={tc.id} value={tc.id}>{(tc.users as any)?.full_name ?? tc.staff_no}</option>)}
            </select>
          </>
        )}
        {view === "Room View" && (
          <>
            <span className="text-sm text-ink-soft">{t("timetable.roomLabel")}</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)} className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink">
              <option value="">{t("timetable.selectRoom")}</option>
              {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Grid */}
        <Card className="overflow-x-auto p-0 lg:col-span-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy-wash">
                <th className="w-24 border-b border-line px-3 py-3 text-left text-ink-soft">{t("crud.time")}</th>
                {DAYS.map((dow) => <th key={dow} className="border-b border-l border-line px-3 py-3 text-center font-bold text-navy">{weekdays[dow]}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods?.length ? periods.map((p) => (
                <tr key={p.id} className={p.is_break ? "bg-sidebar/60" : ""}>
                  <td className="border-b border-line px-3 py-4 align-top text-xs font-semibold text-ink">
                    {p.label ?? `${t("crud.time")} ${p.period_no}`}<br />
                    <span className="font-normal text-ink-faint">{p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}</span>
                  </td>
                  {DAYS.map((dow) => {
                    const s = cellFor(dow, p.id);
                    const c = s ? colorFor(s.subjects?.code ?? "") : null;
                    const clickable = view === "Weekly" && !!classId && !p.is_break;
                    return (
                      <td key={dow} className={`border-b border-l border-line p-1.5 align-top ${clickable ? "cursor-pointer hover:bg-navy-wash/40" : ""}`}
                        onClick={() => openCell(dow, p)}>
                        {p.is_break ? (
                          <div className="py-3 text-center text-xs text-ink-faint">{t("timetable.breakLabel")}</div>
                        ) : s && c ? (
                          <div className="rounded-md p-2" style={{ background: c.bg, borderLeft: `3px solid ${c.bar}` }}>
                            <p className="text-sm font-semibold" style={{ color: c.text }}>{tField(s.subjects?.name_i18n, i18n.resolvedLanguage!) || s.subjects?.code}</p>
                            <p className="mt-1 flex justify-between text-xs text-ink-faint">
                              <span>{initials(s.teachers?.users?.full_name ?? s.teachers?.staff_no ?? "")}</span>
                              <span>{s.room ?? ""}</span>
                            </p>
                            {view !== "Weekly" && (
                              <p className="mt-0.5 text-[11px] text-ink-faint">{(s.classes as any)?.name} {(s.classes as any)?.section}</p>
                            )}
                          </div>
                        ) : <div className="py-3 text-center text-xs text-ink-faint">{t("crud.noSession")}</div>}
                      </td>
                    );
                  })}
                </tr>
              )) : <tr><td colSpan={DAYS.length + 1} className="py-16 text-center text-ink-faint">{t("crud.noSlots")}</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Side panel */}
        <div className="space-y-4">
          {view === "Weekly" && classId && (
            <Card>
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink">{t("timetable.periodsProgress")}</h2>
              <div className="mt-3 space-y-3">
                {progress.length ? progress.map((p, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm"><span className="text-ink-soft">{p.label}</span><span className="font-bold text-navy">{p.placed}/{p.target}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-navy-wash">
                      <div className="h-2 rounded-full bg-navy" style={{ width: `${Math.min(100, Math.round((p.placed / p.target) * 100))}%` }} />
                    </div>
                  </div>
                )) : <p className="text-sm text-ink-faint">{t("timetable.noTargetsSet")}</p>}
              </div>
            </Card>
          )}
          <Card>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink">{t("crud.timetableHealth")}</h2>
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">{t("crud.classCoverage")}</span><span className="font-bold text-navy">{health.coverage}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-navy-wash"><div className="h-2 rounded-full bg-navy" style={{ width: `${health.coverage}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">{t("crud.teacherUtilization")}</span><span className="font-bold text-ok">{health.util}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-ok-tint"><div className="h-2 rounded-full bg-ok" style={{ width: `${health.util}%` }} /></div>
              </div>
            </div>
            <Button variant="ghost" className="mt-4 w-full border border-line text-navy" onClick={() => setShowGenerate(true)}>
              {t("timetable.generateTimetable")}
            </Button>
          </Card>
        </div>
      </div>

      {cell && classId && (
        <TimetableSlotModal
          open={!!cell} onClose={() => setCell(null)} tenantId={tenantId}
          classId={classId} className={(() => { const c = classes?.find((x) => x.id === classId); return c ? `${c.name} ${c.section ?? ""}`.trim() : ""; })()}
          dayOfWeek={cell.dayOfWeek} dayLabel={weekdays[cell.dayOfWeek] ?? ""}
          periodId={cell.periodId} periodLabel={periods?.find((p) => p.id === cell.periodId)?.label ?? ""}
          existing={cell.existing}
        />
      )}
      <GenerateTimetableModal open={showGenerate} onClose={() => setShowGenerate(false)} tenantId={tenantId} classId={classId} />
    </div>
  );
}
