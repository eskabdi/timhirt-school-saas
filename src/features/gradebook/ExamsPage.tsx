import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

export function ExamsPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [maxScore, setMaxScore] = useState(100);
  const [start, setStart] = useState<Date | null>(null);

  const { data: terms } = useQuery({ queryKey: ["terms"], queryFn: async () => (await supabase.from("academic_terms").select("id,name_i18n")).data ?? [] });
  const { data: exams } = useQuery({
    queryKey: ["exams-list"],
    queryFn: async () => (await supabase.from("exams").select("id,name_i18n,max_score,weight")).data ?? [],
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!terms?.[0]) return;
      const { error } = await supabase.from("exams").insert({
        tenant_id: profile!.tenant_id, academic_term_id: terms[0].id, name_i18n: { en: name }, max_score: maxScore,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["exams-list"] }); setName(""); },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Exams</h1>
      <Card className="max-w-md space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
        <Field label="Max score"><Input type="number" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} /></Field>
        <Field label="Window start (EC)"><EthDatePicker value={start} onChange={setStart} /></Field>
        <Button onClick={() => create.mutate()} disabled={!name}>Create exam</Button>
      </Card>
      <div className="space-y-2">
        {exams?.map((e) => (
          <Card key={e.id} className="flex justify-between text-sm"><span>{e.name_i18n?.en}</span><span className="text-ink-faint">/{e.max_score}</span></Card>
        ))}
      </div>
    </div>
  );
}
