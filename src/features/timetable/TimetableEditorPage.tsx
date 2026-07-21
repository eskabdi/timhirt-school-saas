import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import { useTranslation } from "react-i18next";

const DAYS = [
  { dow: 2, label: "MONDAY" }, { dow: 3, label: "TUESDAY" }, { dow: 4, label: "WEDNESDAY" },
  { dow: 5, label: "THURSDAY" }, { dow: 6, label: "FRIDAY" },
];
// Subject → colour family (left border + tint), matching the reference cards.
const PALETTE = [
  { bar: "#1a56db", bg: "#eff4ff", text: "#1a56db" },
  { bar: "#006c4a", bg: "#e8f6f0", text: "#006c4a" },
  { bar: "#b45309", bg: "#faf3e8", text: "#92400e" },
  { bar: "#b91c1c", bg: "#fdeeee", text: "#b91c1c" },
  { bar: "#6d28d9", bg: "#f3eefb", text: "#6d28d9" },
];
const colorFor = (key: string) => PALETTE[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
const initials = (s: string) => s.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

interface Slot {
  id: string; day_of_week: number; starts_at: string; ends_at: string; room: string | null;
  class_id: string; teacher_id: string;
  subjects: { name_i18n: Record<string, string>; code: string } | null;
  teachers: { staff_no: string; users: { full_name: string } | null } | null;
  classes: { name: string; section: string | null } | null;
}

export function TimetableEditorPage() {
  const { i18n } = useTranslation();
  const [view, setView] = useState<"Weekly" | "Teacher View" | "Room View">("Weekly");
  const [classId, setClassId] = useState("");

  const { data: classes } = useQuery({ queryKey: ["tt-classes"], queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level").order("grade_level")).data ?? [] });
  const { data: slots } = useQuery({
    queryKey: ["tt-master"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timetable_slots")
        .select("id, day_of_week, starts_at, ends_at, room, class_id, teacher_id, subjects(name_i18n, code), teachers(staff_no, users(full_name)), classes(name, section)")
        .order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as Slot[];
    },
  });

  const filtered = useMemo(() => (slots ?? []).filter((s) => !classId || s.class_id === classId), [slots, classId]);

  // Period rows = distinct start times in the filtered set.
  const periods = useMemo(() => [...new Set(filtered.map((s) => s.starts_at))].sort(), [filtered]);

  const conflicts = useMemo(() => {
    const seen = new Map<string, Slot>(); const out: { title: string; detail: string; day: string; time: string }[] = [];
    for (const s of slots ?? []) {
      const key = `${s.teacher_id}-${s.day_of_week}-${s.starts_at}`;
      if (seen.has(key)) {
        const other = seen.get(key)!;
        out.push({
          title: "Teacher Double Booking",
          detail: `${s.teachers?.users?.full_name ?? s.teachers?.staff_no ?? "Teacher"} assigned to ${other.classes?.name ?? ""} and ${s.classes?.name ?? ""} simultaneously.`,
          day: DAYS.find((d) => d.dow === s.day_of_week)?.label ?? "", time: s.starts_at.slice(0, 5),
        });
      } else seen.set(key, s);
    }
    return out;
  }, [slots]);

  const health = useMemo(() => {
    const cells = periods.length * DAYS.length;
    const coverage = cells ? Math.round((filtered.length / cells) * 100) : 0;
    const teachers = new Set(filtered.map((s) => s.teacher_id));
    const util = filtered.length ? Math.min(100, Math.round((filtered.length / (teachers.size * periods.length || 1)) * 100)) : 0;
    return { coverage, util };
  }, [filtered, periods]);

  const cellFor = (dow: number, time: string) => filtered.find((s) => s.day_of_week === dow && s.starts_at === time);
  const fmt = (t: string) => { const parts = t.split(":").map(Number); const h = parts[0] ?? 0; const m = parts[1] ?? 0; const ap = h >= 12 ? "PM" : "AM"; const hh = h % 12 || 12; return `${hh}:${m.toString().padStart(2, "0")} ${ap}`; };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Timetable Master / የጊዜ ሰሌዳ</h1>
          <p className="text-sm text-ink-faint">Academic Year 2016 EC • Semester 1</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-control border border-line">
            {(["Weekly", "Teacher View", "Room View"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium ${view === v ? "bg-navy-wash text-navy" : "bg-card text-ink-soft"}`}>{v}</button>
            ))}
          </div>
          <Button variant="ghost" className="border border-line">⬇ Export PDF</Button>
          <Button variant="ghost" className="border border-line">🖨 Print</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-ink-soft">Grade</span>
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="rounded-control border border-line bg-card px-3 py-1.5 text-sm text-ink">
          <option value="">All grades</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Grid */}
        <Card className="overflow-x-auto p-0 lg:col-span-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-navy-wash">
                <th className="w-24 border-b border-line px-3 py-3 text-left text-ink-soft">Time</th>
                {DAYS.map((d) => <th key={d.dow} className="border-b border-l border-line px-3 py-3 text-center font-bold text-navy">{d.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.length ? periods.map((time) => (
                <tr key={time}>
                  <td className="border-b border-line px-3 py-4 align-top text-xs font-semibold text-ink">{fmt(time)}</td>
                  {DAYS.map((d) => {
                    const s = cellFor(d.dow, time);
                    const c = s ? colorFor(s.subjects?.code ?? "") : null;
                    return (
                      <td key={d.dow} className="border-b border-l border-line p-1.5 align-top">
                        {s && c ? (
                          <div className="rounded-md p-2" style={{ background: c.bg, borderLeft: `3px solid ${c.bar}` }}>
                            <p className="text-sm font-semibold" style={{ color: c.text }}>{tField(s.subjects?.name_i18n, i18n.resolvedLanguage!) || s.subjects?.code}</p>
                            <p className="mt-1 flex justify-between text-xs text-ink-faint">
                              <span>{initials(s.teachers?.users?.full_name ?? s.teachers?.staff_no ?? "")}</span>
                              <span>{s.room ?? ""}</span>
                            </p>
                          </div>
                        ) : <div className="py-3 text-center text-xs text-ink-faint">No Session</div>}
                      </td>
                    );
                  })}
                </tr>
              )) : <tr><td colSpan={6} className="py-16 text-center text-ink-faint">No timetable slots. Add them in the timetable editor.</td></tr>}
            </tbody>
          </table>
        </Card>

        {/* Side panel */}
        <div className="space-y-4">
          <Card className="border-danger/40">
            <h2 className="flex items-center gap-2 font-bold text-danger">⚠ CONFLICTS &amp; WARNINGS ({conflicts.length})</h2>
            <div className="mt-3 space-y-3">
              {conflicts.length ? conflicts.slice(0, 4).map((c, i) => (
                <div key={i} className="rounded-lg border border-line p-3">
                  <p className="font-semibold text-ink">{c.title}</p>
                  <p className="mt-1 text-sm text-ink-soft">{c.detail}</p>
                  <div className="mt-2 flex gap-2 text-xs"><span className="rounded bg-danger-tint px-2 py-0.5 text-danger">{c.day}</span><span className="text-ink-faint">{c.time}</span></div>
                </div>
              )) : <p className="text-sm text-ink-faint">No conflicts detected.</p>}
            </div>
          </Card>
          <Card>
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink">Timetable Health</h2>
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">Class Coverage</span><span className="font-bold text-navy">{health.coverage}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-navy-wash"><div className="h-2 rounded-full bg-navy" style={{ width: `${health.coverage}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-sm"><span className="text-ink-soft">Teacher Utilization</span><span className="font-bold text-ok">{health.util}%</span></div>
                <div className="mt-1 h-2 rounded-full bg-ok-tint"><div className="h-2 rounded-full bg-ok" style={{ width: `${health.util}%` }} /></div>
              </div>
            </div>
            <Button variant="ghost" className="mt-4 w-full border border-line text-navy">Auto-Resolve Conflicts</Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
