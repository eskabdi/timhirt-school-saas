import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { toIsoDate } from "@/lib/ethiopian-date";

export function AssignmentFormPage() {
  const nav = useNavigate();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [dueDate, setDueDate] = useState<Date | null>(null);

  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: async () => (await supabase.from("classes").select("id,name,section")).data ?? [] });
  const { data: subjects } = useQuery({ queryKey: ["subjects"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n")).data ?? [] });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("assignments").insert({
        tenant_id: profile!.tenant_id, class_id: classId, subject_id: subjectId,
        title, due_date: toIsoDate(dueDate!), created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assignments"] }); nav("/assignments"); },
  });

  return (
    <Card className="max-w-lg space-y-4">
      <h1 className="font-display text-xl font-bold">New assignment</h1>
      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required /></Field>
      <Field label="Class">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm">
          <option value="">—</option>{classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
        </select>
      </Field>
      <Field label="Subject">
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="w-full rounded-control border border-line px-3 py-2 text-sm">
          <option value="">—</option>{subjects?.map((s) => <option key={s.id} value={s.id}>{s.name_i18n?.en}</option>)}
        </select>
      </Field>
      <Field label="Due date"><EthDatePicker value={dueDate} onChange={setDueDate} /></Field>
      <Button onClick={() => create.mutate()} disabled={!title || !classId || !subjectId || !dueDate}>Create</Button>
    </Card>
  );
}
