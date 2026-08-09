import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

// The school's own Ethiopian-time clock values, taken as given -- these are
// NOT western clock times and must never be shifted by +6h or any other
// offset before storage. period_no is scoped per (tenant, shift), so morning
// and afternoon each restart at 1 without colliding.
const STANDARD_SHIFT_PERIODS: Record<"morning" | "afternoon", { period_no: number; starts_at: string; ends_at: string; is_break: boolean }[]> = {
  morning: [
    { period_no: 1, starts_at: "02:00", ends_at: "02:40", is_break: false },
    { period_no: 2, starts_at: "02:40", ends_at: "03:20", is_break: false },
    { period_no: 3, starts_at: "03:20", ends_at: "04:00", is_break: false },
    { period_no: 4, starts_at: "04:00", ends_at: "04:30", is_break: true },
    { period_no: 5, starts_at: "04:30", ends_at: "05:10", is_break: false },
    { period_no: 6, starts_at: "05:10", ends_at: "05:50", is_break: false },
    { period_no: 7, starts_at: "05:50", ends_at: "06:30", is_break: false },
  ],
  afternoon: [
    { period_no: 1, starts_at: "07:00", ends_at: "07:40", is_break: false },
    { period_no: 2, starts_at: "07:40", ends_at: "08:20", is_break: false },
    { period_no: 3, starts_at: "08:20", ends_at: "09:00", is_break: false },
    { period_no: 4, starts_at: "09:00", ends_at: "09:30", is_break: true },
    { period_no: 5, starts_at: "09:30", ends_at: "10:10", is_break: false },
    { period_no: 6, starts_at: "10:10", ends_at: "10:50", is_break: false },
    { period_no: 7, starts_at: "10:50", ends_at: "11:30", is_break: false },
  ],
};

interface Period { id: string; period_no: number; label: string | null; starts_at: string; ends_at: string; is_break: boolean; shift: string | null }
interface PeriodDraft { period_no: string; label: string; starts_at: string; ends_at: string; is_break: boolean; shift: string }
const emptyPeriodDraft: PeriodDraft = { period_no: "", label: "", starts_at: "", ends_at: "", is_break: false, shift: "" };
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
  const queryClient = useQueryClient();
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const [view, setView] = useState<"Weekly" | "Teacher View" | "Room View">("Weekly");
  const [classId, setClassId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [room, setRoom] = useState("");
  const [cell, setCell] = useState<{ dayOfWeek: number; periodId: string; existing: ExistingSlot | null } | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [periodDraft, setPeriodDraft] = useState<PeriodDraft>(emptyPeriodDraft);
  const [periodError, setPeriodError] = useState<string | null>(null);

  const tenantId = profile?.tenant_id ?? "";
  const canManagePeriods = profile?.role === "school_admin";

  const { data: classes } = useQuery({
    queryKey: ["tt-classes", tenantId], enabled: !!tenantId,
    queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level,shift").order("grade_level")).data ?? [],
  });
  const { data: teachers } = useQuery({
    queryKey: ["tt-teachers", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("teachers").select("id,staff_no,users(full_name)").order("staff_no");
      return (data as unknown as { id: string; staff_no: string; users: { full_name: string } | null }[] | null) ?? [];
    },
  });
  const { data: periods } = useQuery({
    queryKey: ["periods", tenantId], enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("periods").select("id,period_no,label,starts_at,ends_at,is_break,shift")
        .eq("tenant_id", tenantId).order("starts_at");
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
      return (data as unknown as {
        id: string; subject_id: string; periods_per_week: number | null;
        subjects: { name_i18n: Record<string, string>; code: string } | null;
      }[] | null) ?? [];
    },
  });
  const { data: tenantConfig } = useQuery({
    queryKey: ["tenant-config", tenantId], enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_configs").select("operational_mode_key").eq("tenant_id", tenantId).maybeSingle()).data,
  });
  const isDoubleShift = tenantConfig?.operational_mode_key === "double_shift";

  const invalidatePeriods = () => queryClient.invalidateQueries({ queryKey: ["periods", tenantId] });

  const startEditPeriod = (p: Period) => {
    if (!canManagePeriods) return;
    setEditingPeriodId(p.id);
    setPeriodDraft({
      period_no: String(p.period_no), label: p.label ?? "",
      starts_at: p.starts_at.slice(0, 5), ends_at: p.ends_at.slice(0, 5),
      is_break: p.is_break, shift: p.shift ?? "",
    });
    setPeriodError(null);
  };
  const startAddPeriod = (shift: string = "") => {
    const nextNo = Math.max(0, ...(periods ?? []).filter((p) => (p.shift ?? "") === shift).map((p) => p.period_no)) + 1;
    setEditingPeriodId("__new__");
    setPeriodDraft({ ...emptyPeriodDraft, period_no: String(nextNo), shift });
    setPeriodError(null);
  };
  const cancelPeriodEdit = () => { setEditingPeriodId(null); setPeriodError(null); };

  const savePeriod = useMutation({
    mutationFn: async () => {
      if (!periodDraft.starts_at || !periodDraft.ends_at) throw new Error(t("timetable.periodTimesRequired"));
      const payload = {
        period_no: Number(periodDraft.period_no) || 1,
        label: periodDraft.label.trim() || null,
        starts_at: periodDraft.starts_at,
        ends_at: periodDraft.ends_at,
        is_break: periodDraft.is_break,
        shift: periodDraft.shift || null,
      };
      if (editingPeriodId && editingPeriodId !== "__new__") {
        const { error } = await supabase.from("periods").update(payload).eq("id", editingPeriodId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("periods").insert({ tenant_id: tenantId, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidatePeriods(); setEditingPeriodId(null); setPeriodError(null); },
    onError: (e: unknown) => setPeriodError(e instanceof Error ? e.message : t("timetable.periodSaveFailed")),
  });

  const deletePeriod = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("periods").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { invalidatePeriods(); setEditingPeriodId(null); },
    onError: (e: unknown) => setPeriodError(e instanceof Error ? e.message : t("timetable.periodDeleteFailed")),
  });

  // One-click population of the school's standard 7-row shift schedule, using
  // its own Ethiopian clock values verbatim (see STANDARD_SHIFT_PERIODS) --
  // offered only until that shift already has periods, so it can't be fired
  // twice into a duplicate set.
  const seedShiftPeriods = useMutation({
    mutationFn: async (shift: "morning" | "afternoon") => {
      const rows = STANDARD_SHIFT_PERIODS[shift].map((p) => ({
        tenant_id: tenantId, period_no: p.period_no, shift,
        label: p.is_break ? t("timetable.breakLabel") : null,
        starts_at: p.starts_at, ends_at: p.ends_at, is_break: p.is_break,
      }));
      const { error } = await supabase.from("periods").insert(rows);
      if (error) throw error;
    },
    onSuccess: invalidatePeriods,
    onError: (e: unknown) => setPeriodError(e instanceof Error ? e.message : t("timetable.periodSaveFailed")),
  });
  const hasMorningPeriods = (periods ?? []).some((p) => p.shift === "morning");
  const hasAfternoonPeriods = (periods ?? []).some((p) => p.shift === "afternoon");

  const selectedClass = useMemo(() => classes?.find((c) => c.id === classId), [classes, classId]);
  // A double-shift class only ever meets during its own shift's periods (or
  // a shift-agnostic shared one), so narrow the grid to those rather than
  // showing rows this class can never occupy. Teacher/Room views span both
  // shifts at once, so they keep the full period list.
  const visiblePeriods = useMemo(() => {
    if (view !== "Weekly" || !selectedClass?.shift) return periods ?? [];
    return (periods ?? []).filter((p) => !p.shift || p.shift === selectedClass.shift);
  }, [periods, view, selectedClass]);
  const teachingPeriods = useMemo(() => visiblePeriods.filter((p) => !p.is_break), [visiblePeriods]);

  // A double-shift school's Morning and Afternoon periods are two unrelated
  // clocks -- "Period 1" means a different literal time in each -- so they're
  // always rendered as two separate tables rather than one list interleaved
  // by start time. Shared/shift-agnostic periods (legacy or full-day) get
  // their own group too, but only when any exist. When a shift-scoped class
  // is already selected, visiblePeriods is pre-narrowed to that one shift, so
  // only its table (plus any shared one) renders.
  const groupedPeriods = useMemo(() => {
    if (!isDoubleShift) return [{ key: "all", heading: null as string | null, rows: visiblePeriods }];
    const shared = visiblePeriods.filter((p) => !p.shift);
    const morning = visiblePeriods.filter((p) => p.shift === "morning");
    const afternoon = visiblePeriods.filter((p) => p.shift === "afternoon");
    const showBothShifts = view !== "Weekly" || !selectedClass?.shift;
    const groups: { key: string; heading: string | null; rows: Period[] }[] = [];
    if (shared.length) groups.push({ key: "shared", heading: t("timetable.sharedPeriods"), rows: shared });
    if (morning.length || showBothShifts) groups.push({ key: "morning", heading: t("hr.shiftOption.morning"), rows: morning });
    if (afternoon.length || showBothShifts) groups.push({ key: "afternoon", heading: t("hr.shiftOption.afternoon"), rows: afternoon });
    return groups;
  }, [isDoubleShift, visiblePeriods, view, selectedClass, t]);

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
        label: tField(a.subjects?.name_i18n, i18n.resolvedLanguage!) || a.subjects?.code,
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

  const renderPeriodForm = () => (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <input type="text" value={periodDraft.label} onChange={(e) => setPeriodDraft({ ...periodDraft, label: e.target.value })}
        placeholder={t("crud.time")} maxLength={40}
        className="w-full rounded border border-line bg-card px-1.5 py-1 text-xs text-ink" />
      <div className="flex items-center gap-1">
        <input type="time" value={periodDraft.starts_at} onChange={(e) => setPeriodDraft({ ...periodDraft, starts_at: e.target.value })}
          className="w-full rounded border border-line bg-card px-1 py-1 text-xs text-ink" />
        <span className="text-ink-faint">–</span>
        <input type="time" value={periodDraft.ends_at} onChange={(e) => setPeriodDraft({ ...periodDraft, ends_at: e.target.value })}
          className="w-full rounded border border-line bg-card px-1 py-1 text-xs text-ink" />
      </div>
      {isDoubleShift && (
        <select value={periodDraft.shift} onChange={(e) => setPeriodDraft({ ...periodDraft, shift: e.target.value })}
          className="w-full rounded border border-line bg-card px-1 py-1 text-xs text-ink">
          <option value="">{t("timetable.anyShift")}</option>
          <option value="morning">{t("hr.shiftOption.morning")}</option>
          <option value="afternoon">{t("hr.shiftOption.afternoon")}</option>
        </select>
      )}
      <label className="flex items-center gap-1 text-[11px] text-ink-faint">
        <input type="checkbox" checked={periodDraft.is_break} onChange={(e) => setPeriodDraft({ ...periodDraft, is_break: e.target.checked })} />
        {t("timetable.breakLabel")}
      </label>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <button type="button" onClick={() => savePeriod.mutate()} disabled={savePeriod.isPending}
          className="rounded bg-navy px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-60">{t("common.save")}</button>
        <button type="button" onClick={cancelPeriodEdit}
          className="rounded border border-line px-2 py-0.5 text-[11px] text-ink-soft">{t("common.cancel")}</button>
        {editingPeriodId && editingPeriodId !== "__new__" && (
          <button type="button" onClick={() => deletePeriod.mutate(editingPeriodId)} disabled={deletePeriod.isPending}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-danger">{t("crud.delete")}</button>
        )}
      </div>
    </div>
  );

  const renderPeriodRow = (p: Period) => (
    <tr key={p.id} className={p.is_break ? "bg-sidebar/60" : ""}>
      <td className="border-b border-line px-3 py-2 align-top text-xs font-semibold text-ink">
        {editingPeriodId === p.id ? (
          renderPeriodForm()
        ) : (
          <div className={canManagePeriods ? "cursor-pointer py-2 hover:text-navy" : "py-2"} onClick={() => startEditPeriod(p)}>
            {p.label ?? `${t("crud.time")} ${p.period_no}`}<br />
            <span className="font-normal text-ink-faint">{p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)}</span>
          </div>
        )}
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
                  <p className="mt-0.5 text-[11px] text-ink-faint">{s.classes?.name} {s.classes?.section}</p>
                )}
              </div>
            ) : <div className="py-3 text-center text-xs text-ink-faint">{t("crud.noSession")}</div>}
          </td>
        );
      })}
    </tr>
  );

  const renderShiftTable = (group: { key: string; heading: string | null; rows: Period[] }) => (
    <div key={group.key}>
      {group.heading && (
        <div className="flex items-center justify-between border-b border-t border-line bg-sidebar/40 px-3 py-2 first:border-t-0">
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{group.heading}</h3>
          {canManagePeriods && (
            <button type="button" onClick={() => startAddPeriod(group.key === "shared" ? "" : group.key)} disabled={editingPeriodId !== null}
              className="text-xs font-medium text-navy hover:underline disabled:opacity-50 disabled:no-underline">
              + {t("timetable.addPeriod")}
            </button>
          )}
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-navy-wash">
            <th className="w-24 border-b border-line px-3 py-3 text-left text-ink-soft">{t("crud.time")}</th>
            {DAYS.map((dow) => <th key={dow} className="border-b border-l border-line px-3 py-3 text-center font-bold text-navy">{weekdays[dow]}</th>)}
          </tr>
        </thead>
        <tbody>
          {group.rows.map(renderPeriodRow)}
          {editingPeriodId === "__new__" && (periodDraft.shift || "shared") === group.key && (
            <tr>
              <td className="border-b border-line px-3 py-2 align-top text-xs font-semibold text-ink">{renderPeriodForm()}</td>
              {DAYS.map((dow) => <td key={dow} className="border-b border-l border-line" />)}
            </tr>
          )}
          {!group.rows.length && (editingPeriodId !== "__new__" || (periodDraft.shift || "shared") !== group.key) && (
            <tr><td colSpan={DAYS.length + 1} className="py-8 text-center text-xs text-ink-faint">{t("crud.noSlots")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

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
            {selectedClass?.shift && (
              <span className="rounded-pill bg-navy-wash px-2.5 py-1 text-xs font-medium text-navy">
                {t(`hr.shiftOption.${selectedClass.shift}`)}
              </span>
            )}
          </>
        )}
        {view === "Teacher View" && (
          <>
            <span className="text-sm text-ink-soft">{t("timetable.teacher")}</span>
            <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink">
              <option value="">{t("timetable.selectTeacher")}</option>
              {teachers?.map((tc) => <option key={tc.id} value={tc.id}>{tc.users?.full_name ?? tc.staff_no}</option>)}
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
          {canManagePeriods && (isDoubleShift ? (!hasMorningPeriods || !hasAfternoonPeriods) : true) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
              <div className="flex flex-wrap gap-2">
                {isDoubleShift && !hasMorningPeriods && (
                  <Button variant="ghost" className="border border-line text-xs" onClick={() => seedShiftPeriods.mutate("morning")} disabled={seedShiftPeriods.isPending}>
                    {t("timetable.addStandardMorning")}
                  </Button>
                )}
                {isDoubleShift && !hasAfternoonPeriods && (
                  <Button variant="ghost" className="border border-line text-xs" onClick={() => seedShiftPeriods.mutate("afternoon")} disabled={seedShiftPeriods.isPending}>
                    {t("timetable.addStandardAfternoon")}
                  </Button>
                )}
              </div>
              {!isDoubleShift && (
                <Button variant="ghost" className="border border-line text-xs" onClick={() => startAddPeriod()} disabled={editingPeriodId !== null}>
                  + {t("timetable.addPeriod")}
                </Button>
              )}
            </div>
          )}
          {periodError && <p className="border-b border-line bg-danger-tint px-3 py-2 text-xs text-danger">{periodError}</p>}
          {groupedPeriods.map(renderShiftTable)}
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
