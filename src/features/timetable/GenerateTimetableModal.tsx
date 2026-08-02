// Loads the real inputs (assignments with a periods-per-week target, the
// tenant's teaching periods, and every already-placed slot so the engine
// never touches them) for the chosen scope, runs the pure generateTimetable()
// engine, and bulk-inserts whatever it placed.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import { generateTimetable, type GenUnplaced } from "./generateTimetable";

const DAYS = [2, 3, 4, 5, 6];

export function GenerateTimetableModal({ open, onClose, tenantId, classId }: {
  open: boolean; onClose: () => void; tenantId: string; classId: string;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [result, setResult] = useState<{ placed: number; unplaced: (GenUnplaced & { classLabel: string; subjectLabel: string; teacherLabel: string })[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const assignmentsQuery = supabase.from("class_subject_teachers")
        .select("class_id, subject_id, teacher_id, periods_per_week, subjects(name_i18n, code), classes(name, section), teachers(staff_no, users(full_name))")
        .not("periods_per_week", "is", null);
      const { data: assignments, error: aErr } = classId ? await assignmentsQuery.eq("class_id", classId) : await assignmentsQuery;
      if (aErr) throw aErr;
      if (!assignments?.length) throw new Error(t("timetable.noTargetsToGenerate"));

      const { data: periods, error: pErr } = await supabase.from("periods")
        .select("id").eq("tenant_id", tenantId).eq("is_break", false);
      if (pErr) throw pErr;
      if (!periods?.length) throw new Error(t("timetable.noPeriods"));

      const { data: existing, error: sErr } = await supabase.from("timetable_slots")
        .select("class_id, subject_id, teacher_id, day_of_week, period_id").eq("tenant_id", tenantId);
      if (sErr) throw sErr;

      const { placements, unplaced } = generateTimetable({
        requirements: assignments.map((a) => ({
          classId: a.class_id, subjectId: a.subject_id, teacherId: a.teacher_id, periodsPerWeek: a.periods_per_week!,
        })),
        periods: periods.map((p) => ({ id: p.id })),
        days: DAYS,
        existingSlots: (existing ?? []).map((s) => ({
          classId: s.class_id, subjectId: s.subject_id, teacherId: s.teacher_id, dayOfWeek: s.day_of_week, periodId: s.period_id,
        })),
      });

      if (placements.length) {
        const { error: iErr } = await supabase.from("timetable_slots").insert(
          placements.map((p) => ({
            tenant_id: tenantId, class_id: p.classId, subject_id: p.subjectId, teacher_id: p.teacherId,
            day_of_week: p.dayOfWeek, period_id: p.periodId,
          })),
        );
        if (iErr) throw iErr;
      }

      const labelFor = (classId2: string, subjectId: string, teacherId: string) => {
        const a = assignments.find((x) => x.class_id === classId2 && x.subject_id === subjectId && x.teacher_id === teacherId);
        const cls = a?.classes as any;
        return {
          classLabel: cls ? `${cls.name} ${cls.section ?? ""}`.trim() : "",
          subjectLabel: tField((a?.subjects as any)?.name_i18n, i18n.resolvedLanguage!) || (a?.subjects as any)?.code || "",
          teacherLabel: (a?.teachers as any)?.users?.full_name ?? (a?.teachers as any)?.staff_no ?? "",
        };
      };

      return {
        placed: placements.length,
        unplaced: unplaced.map((u) => ({ ...u, ...labelFor(u.classId, u.subjectId, u.teacherId) })),
      };
    },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["timetable-slots"] }); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("timetable.generateFailed")),
  });

  const handleClose = () => { setResult(null); setError(null); onClose(); };

  return (
    <Modal open={open} onClose={handleClose} title={t("timetable.generateTimetable")}>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {!result ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {classId ? t("timetable.generateScopeClass") : t("timetable.generateScopeAll")}
          </p>
          <p className="text-xs text-ink-faint">{t("timetable.generateExplain")}</p>
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <Button variant="ghost" onClick={handleClose}>{t("common.cancel")}</Button>
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? t("timetable.generating") : t("timetable.generateTimetable")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ok">{t("timetable.generatePlacedCount", { count: result.placed })}</p>
          {result.unplaced.length > 0 && (
            <div className="rounded-control border border-late/40 bg-late-tint/40 p-3">
              <p className="text-sm font-semibold text-ink">{t("timetable.generateUnplacedTitle")}</p>
              <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                {result.unplaced.map((u, i) => (
                  <li key={i}>{u.classLabel} · {u.subjectLabel} · {u.teacherLabel} — {t("timetable.generateMissing", { count: u.missing })}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end border-t border-line pt-3">
            <Button onClick={handleClose}>{t("actions.close")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
