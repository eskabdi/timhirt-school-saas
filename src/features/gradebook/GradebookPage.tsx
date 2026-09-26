import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { tField } from "@/lib/i18n";
import { fullName } from "@/lib/names";
import { approvalErrorKey, submitApproval } from "@/features/approvals/approvals";

// R6 WP-09 (M-06): once a term's results are published, a grade can no longer
// be edited directly (the database refuses it). Changed scores are sent as
// grade_edit_after_publish requests for a second person to approve; grades
// that do not exist yet can still be entered.
export function GradebookPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [examId, setExamId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const { data: exams } = useQuery({
    queryKey: ["exams"],
    queryFn: async () => (await supabase.from("exams").select("id,name_i18n,max_score,class_id,term:academic_terms(results_published)")).data ?? [],
  });
  const { data: subjects } = useQuery({ queryKey: ["subjects"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n")).data ?? [] });

  const selectedExam = exams?.find((e) => e.id === examId);
  const published = !!(selectedExam?.term as unknown as { results_published: boolean } | null)?.results_published;

  // Legacy exams created before class scoping existed have class_id = null
  // and fall back to the whole-school roster (§ see the fix's migration
  // comment) -- every exam created going forward always carries a class_id.
  const { data: students } = useQuery({
    queryKey: ["students-brief", selectedExam?.class_id ?? null],
    enabled: !!examId,
    queryFn: async () => {
      let query = supabase.from("students").select("id,first_name,middle_name,last_name");
      if (selectedExam?.class_id) query = query.eq("class_id", selectedExam.class_id);
      const { data } = await query;
      return data ?? [];
    },
  });

  const { data: existing } = useQuery({
    queryKey: ["grades", examId, subjectId],
    enabled: !!examId && !!subjectId,
    queryFn: async () => {
      const { data, error } = await supabase.from("grades").select("id,student_id,score").eq("exam_id", examId).eq("subject_id", subjectId);
      if (error) throw error;
      return new Map((data ?? []).map((g) => [g.student_id, { id: g.id, score: Number(g.score) }]));
    },
  });

  useEffect(() => { setScores({}); setResult(null); }, [examId, subjectId]);

  const changed = Object.entries(scores).filter(([sid, score]) => existing?.get(sid)?.score !== score);
  const corrections = published ? changed.filter(([sid]) => existing?.has(sid)) : [];
  const directWrites = changed.filter(([sid]) => !published || !existing?.has(sid));

  const save = useMutation({
    mutationFn: async () => {
      if (directWrites.length) {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: profile } = await supabase.from("users").select("tenant_id").eq("id", user!.id).single();
        const rows = directWrites.map(([student_id, score]) => ({
          tenant_id: profile!.tenant_id, student_id, exam_id: examId, subject_id: subjectId, score,
        }));
        const { error } = await supabase.from("grades").upsert(rows, { onConflict: "tenant_id,student_id,exam_id,subject_id" });
        if (error) throw error;
      }
      for (const [sid, score] of corrections) {
        await submitApproval("grade_edit_after_publish", existing!.get(sid)!.id, { score }, reason.trim());
      }
      return corrections.length ? "corrections" : "saved";
    },
    onSuccess: (outcome) => {
      setResult(outcome);
      setScores({});
      setReason("");
      qc.invalidateQueries({ queryKey: ["grades"] });
      qc.invalidateQueries({ queryKey: ["approvals-pending-count"] });
    },
  });

  const needsReason = corrections.length > 0 && !reason.trim();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("gradebook.title")}</h1>
      <div className="flex gap-3">
        <select value={examId} onChange={(e) => setExamId(e.target.value)} aria-label={t("gradebook.exam")}
          className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">{t("gradebook.exam")}</option>{exams?.map((e) => <option key={e.id} value={e.id}>{tField(e.name_i18n, i18n.resolvedLanguage!)} (/{e.max_score})</option>)}
        </select>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} aria-label={t("gradebook.subject")}
          className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
          <option value="">{t("gradebook.subject")}</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{tField(s.name_i18n, i18n.resolvedLanguage!)}</option>)}
        </select>
      </div>
      {examId && subjectId && (
        <Card>
          {published && <p className="mb-3 text-sm text-late">{t("gradebook.publishedNote")}</p>}
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {students?.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 font-medium text-ink">{fullName(s)}</td>
                  <td className="py-2">
                    <input type="number" min={0} max={selectedExam?.max_score ?? undefined} aria-label={t("gradebook.scoreFor", { name: fullName(s) })}
                      className="w-20 rounded-control border border-line bg-card px-2 py-1 text-sm text-ink"
                      value={scores[s.id] ?? existing?.get(s.id)?.score ?? ""}
                      onChange={(e) => { save.reset(); setScores((sc) => ({ ...sc, [s.id]: Number(e.target.value) })); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {corrections.length > 0 && (
            <label className="mt-3 block text-sm">
              <span className="text-ink">{t("gradebook.correctionReason")}</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} required
                className="mt-1 w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
            </label>
          )}
          <Button className="mt-3" onClick={() => save.mutate()} disabled={save.isPending || changed.length === 0 || needsReason}>
            {corrections.length ? t("gradebook.requestCorrection") : t("gradebook.saveGrades")}
          </Button>
          <p role="status" className="mt-2 text-sm text-ok">
            {result === "corrections" ? t("gradebook.correctionsSubmitted") : result === "saved" ? t("gradebook.saved") : ""}
          </p>
          {save.isError && <p role="alert" className="mt-1 text-sm text-danger">{t(`approvals.error.${approvalErrorKey(save.error)}`)}</p>}
        </Card>
      )}
    </div>
  );
}
