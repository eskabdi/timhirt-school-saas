import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export function GradebookPage() {
  const qc = useQueryClient();
  const [examId, setExamId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});

  const { data: exams } = useQuery({ queryKey: ["exams"], queryFn: async () => (await supabase.from("exams").select("id,name_i18n,max_score")).data ?? [] });
  const { data: subjects } = useQuery({ queryKey: ["subjects"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n")).data ?? [] });
  const { data: students } = useQuery({ queryKey: ["students-brief"], queryFn: async () => (await supabase.from("students").select("id,first_name,last_name")).data ?? [] });

  const save = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from("users").select("tenant_id").eq("id", user!.id).single();
      const rows = Object.entries(scores).map(([student_id, score]) => ({
        tenant_id: profile!.tenant_id, student_id, exam_id: examId, subject_id: subjectId, score,
      }));
      const { error } = await supabase.from("grades").upsert(rows, { onConflict: "tenant_id,student_id,exam_id,subject_id" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["grades"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Gradebook</h1>
      <div className="flex gap-3">
        <select value={examId} onChange={(e) => setExamId(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
          <option value="">Exam</option>{exams?.map((e) => <option key={e.id} value={e.id}>{e.name_i18n?.en} (/{e.max_score})</option>)}
        </select>
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="rounded-control border border-line px-3 py-2 text-sm">
          <option value="">Subject</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{s.name_i18n?.en}</option>)}
        </select>
      </div>
      {examId && subjectId && (
        <Card>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {students?.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 font-medium">{s.first_name} {s.last_name}</td>
                  <td className="py-2">
                    <input type="number" min={0} className="w-20 rounded-control border border-line px-2 py-1 text-sm"
                      value={scores[s.id] ?? ""} onChange={(e) => setScores((sc) => ({ ...sc, [s.id]: Number(e.target.value) }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button className="mt-3" onClick={() => save.mutate()} disabled={save.isPending}>Save grades</Button>
        </Card>
      )}
    </div>
  );
}
