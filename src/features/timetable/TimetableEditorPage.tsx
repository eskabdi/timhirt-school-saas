import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { tField } from "@/lib/i18n";

// day_of_week is 1=Sunday..7=Saturday; the school week shows Monday(2)-Friday(6).
const WEEKDAY_INDEXES = [2, 3, 4, 5, 6];

interface Slot {
  id: string; day_of_week: number; starts_at: string; ends_at: string; room: string | null;
  class_id: string; subject_id: string; teacher_id: string;
  classes: { name: string; section: string | null } | null;
  subjects: { name_i18n: Record<string, string> } | null;
  teachers: { staff_no: string } | null;
}
type SlotForm = { classId: string; subjectId: string; teacherId: string; day: number; start: string; end: string; room: string };
const emptyForm: SlotForm = { classId: "", subjectId: "", teacherId: "", day: 2, start: "08:00", end: "08:45", room: "" };

export function TimetableEditorPage() {
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<SlotForm>(emptyForm);
  const [editing, setEditing] = useState<Slot | null>(null);
  const [editForm, setEditForm] = useState<SlotForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const { data: slots } = useQuery({
    queryKey: ["timetable"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timetable_slots")
        .select("id, day_of_week, starts_at, ends_at, room, class_id, subject_id, teacher_id, classes(name,section), subjects(name_i18n), teachers(staff_no)")
        .order("day_of_week").order("starts_at");
      if (error) throw error;
      return (data ?? []) as unknown as Slot[];
    },
  });
  const { data: classes } = useQuery({ queryKey: ["tt_classes"], queryFn: async () => (await supabase.from("classes").select("id,name,section").order("grade_level")).data ?? [] });
  const { data: subjects } = useQuery({ queryKey: ["tt_subjects"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n,code").order("code")).data ?? [] });
  const { data: teachers } = useQuery({ queryKey: ["tt_teachers"], queryFn: async () => (await supabase.from("teachers").select("id,staff_no").order("staff_no")).data ?? [] });

  const payload = (f: SlotForm) => ({
    class_id: f.classId, subject_id: f.subjectId, teacher_id: f.teacherId,
    day_of_week: f.day, starts_at: f.start, ends_at: f.end, room: f.room || null,
  });

  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("timetable_slots").insert({ tenant_id: profile!.tenant_id, ...payload(form) }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timetable"] }); setShowCreate(false); setForm(emptyForm); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const update = useMutation({
    mutationFn: async () => { const { error } = await supabase.from("timetable_slots").update(payload(editForm)).eq("id", editing!.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timetable"] }); setEditing(null); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("timetable_slots").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["timetable"] }),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  const openEdit = (s: Slot) => {
    setEditing(s);
    setEditForm({ classId: s.class_id, subjectId: s.subject_id, teacherId: s.teacher_id, day: s.day_of_week, start: s.starts_at.slice(0, 5), end: s.ends_at.slice(0, 5), room: s.room ?? "" });
  };

  const fields = (f: SlotForm, set: (f: SlotForm) => void) => (
    <div className="space-y-3">
      <Field label="Class">
        <select value={f.classId} onChange={(e) => set({ ...f, classId: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">Select class</option>
          {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
        </select>
      </Field>
      <Field label="Subject">
        <select value={f.subjectId} onChange={(e) => set({ ...f, subjectId: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">Select subject</option>
          {subjects?.map((s) => <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!) || s.code}</option>)}
        </select>
      </Field>
      <Field label="Teacher">
        <select value={f.teacherId} onChange={(e) => set({ ...f, teacherId: e.target.value })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">Select teacher</option>
          {teachers?.map((tt) => <option key={tt.id} value={tt.id}>{tt.staff_no}</option>)}
        </select>
      </Field>
      <Field label="Day">
        <select value={f.day} onChange={(e) => set({ ...f, day: Number(e.target.value) })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          {WEEKDAY_INDEXES.map((d) => <option key={d} value={d}>{weekdays[d]}</option>)}
        </select>
      </Field>
      <div className="flex gap-3">
        <Field label="Start"><Input type="time" value={f.start} onChange={(e) => set({ ...f, start: e.target.value })} /></Field>
        <Field label="End"><Input type="time" value={f.end} onChange={(e) => set({ ...f, end: e.target.value })} /></Field>
      </div>
      <Field label="Room"><Input value={f.room} onChange={(e) => set({ ...f, room: e.target.value })} placeholder="Room 12" /></Field>
    </div>
  );

  const valid = (f: SlotForm) => f.classId && f.subjectId && f.teacherId && f.end > f.start;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("nav.timetable")}</h1>
        <Button onClick={() => { setForm(emptyForm); setShowCreate(true); }}>+ Add slot</Button>
      </div>

      {error && <Card className="border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {WEEKDAY_INDEXES.map((dow) => (
          <div key={dow} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase text-ink-faint">{weekdays[dow]}</h2>
            {slots?.filter((s) => s.day_of_week === dow).map((s) => (
              <Card key={s.id} className="group p-3">
                <p className="text-sm font-medium text-ink">{tField(s.subjects?.name_i18n, i18n.resolvedLanguage!)}</p>
                <p className="text-xs text-ink-faint">{s.classes?.name} {s.classes?.section} · {s.starts_at?.slice(0, 5)}–{s.ends_at?.slice(0, 5)}</p>
                {s.room && <p className="text-xs text-ink-faint">{t("timetable.room", { room: s.room })}</p>}
                <div className="mt-2 flex gap-1">
                  <Button variant="ghost" className="px-2 py-0.5 text-xs" onClick={() => openEdit(s)}>Edit</Button>
                  <Button variant="ghost" className="px-2 py-0.5 text-xs text-danger" onClick={() => remove.mutate(s.id)}>Delete</Button>
                </div>
              </Card>
            ))}
          </div>
        ))}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add timetable slot">
        {fields(form, setForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!valid(form) || create.isPending}>Create</Button>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit slot">
        {fields(editForm, setEditForm)}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={() => update.mutate()} disabled={!valid(editForm) || update.isPending}>Save</Button>
        </div>
      </Modal>
    </div>
  );
}
