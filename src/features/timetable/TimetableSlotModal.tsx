// Create/edit/clear a single timetable cell. Subject+teacher choices are
// restricted to that class's own class_subject_teachers rows -- picking an
// unassigned pair here would just be a slot nobody can actually teach.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { tField } from "@/lib/i18n";

export interface ExistingSlot { id: string; subjectId: string; teacherId: string; room: string | null }

export function TimetableSlotModal({ open, onClose, tenantId, classId, className, dayOfWeek, dayLabel, periodId, periodLabel, existing }: {
  open: boolean; onClose: () => void; tenantId: string;
  classId: string; className: string; dayOfWeek: number; dayLabel: string;
  periodId: string; periodLabel: string; existing: ExistingSlot | null;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [cstId, setCstId] = useState("");
  const [room, setRoom] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRoom(existing?.room ?? "");
  }, [open, existing]);

  const { data: assignments } = useQuery({
    // Distinct from TimetableEditorPage's ["class-subject-teachers", classId]
    // query -- that one's select omits teacher_id/teachers and this one's
    // omits periods_per_week, so sharing a key let whichever fetch ran last
    // silently blank out the other's fields in the shared cache entry.
    queryKey: ["class-subject-teachers-for-slot", classId],
    enabled: open && !!classId,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("class_subject_teachers")
        .select("id, subject_id, teacher_id, subjects(name_i18n, code), teachers(staff_no, users(full_name))")
        .eq("class_id", classId);
      if (err) throw err;
      return (data as unknown as {
        id: string; subject_id: string; teacher_id: string;
        subjects: { name_i18n: Record<string, string>; code: string } | null;
        teachers: { staff_no: string; users: { full_name: string } | null } | null;
      }[] | null) ?? [];
    },
  });

  // Resolve once assignments load, rather than being passed in -- the parent
  // grid only has subject_id/teacher_id per slot, not the class_subject_teachers
  // row id itself.
  useEffect(() => {
    if (!existing || !assignments) { if (!existing) setCstId(""); return; }
    const match = assignments.find((a) => a.subject_id === existing.subjectId && a.teacher_id === existing.teacherId);
    setCstId(match?.id ?? "");
  }, [existing, assignments]);

  const save = useMutation({
    mutationFn: async () => {
      const cst = assignments?.find((a) => a.id === cstId);
      if (!cst) throw new Error(t("timetable.pickSubjectTeacher"));
      const row = {
        tenant_id: tenantId, class_id: classId, subject_id: cst.subject_id, teacher_id: cst.teacher_id,
        day_of_week: dayOfWeek, period_id: periodId, room: room.trim() || null,
      };
      const { error: err } = existing
        ? await supabase.from("timetable_slots").update(row).eq("id", existing.id)
        : await supabase.from("timetable_slots").insert(row);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timetable-slots"] }); onClose(); },
    onError: (e: unknown) => {
      const code = (e as { code?: string })?.code;
      setError(code === "23505" ? t("timetable.conflictError") : (e instanceof Error ? e.message : t("timetable.saveFailed")));
    },
  });

  const clear = useMutation({
    mutationFn: async () => {
      const { error: err } = await supabase.from("timetable_slots").delete().eq("id", existing!.id);
      if (err) throw err;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["timetable-slots"] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("timetable.saveFailed")),
  });

  return (
    <Modal open={open} onClose={onClose} title={`${className} — ${dayLabel}, ${periodLabel}`}>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="space-y-4">
        <Field label={t("timetable.subjectTeacher")}>
          <select value={cstId} onChange={(e) => setCstId(e.target.value)}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            <option value="">{t("timetable.selectSubjectTeacher")}</option>
            {assignments?.map((a) => (
              <option key={a.id} value={a.id}>
                {tField(a.subjects?.name_i18n, i18n.resolvedLanguage!) || a.subjects?.code}
                {" — "}
                {a.teachers?.users?.full_name ?? a.teachers?.staff_no}
              </option>
            ))}
          </select>
          {!assignments?.length && <p className="mt-1 text-xs text-ink-faint">{t("timetable.noAssignments")}</p>}
        </Field>
        <Field label={t("timetable.roomLabel")}>
          <Input value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} placeholder={t("timetable.roomPlaceholder")} />
        </Field>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
        {existing ? (
          <Button variant="ghost" className="text-danger" onClick={() => clear.mutate()} disabled={clear.isPending}>
            {t("timetable.clearSlot")}
          </Button>
        ) : <span />}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !cstId}>
            {save.isPending ? t("timetable.saving") : t("timetable.save")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
