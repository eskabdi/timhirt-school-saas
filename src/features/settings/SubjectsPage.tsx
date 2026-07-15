import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

export function SubjectsPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [nameEn, setNameEn] = useState("");
  const [nameAm, setNameAm] = useState("");
  const [code, setCode] = useState("");

  const { data: subjects } = useQuery({ queryKey: ["subjects-admin"], queryFn: async () => (await supabase.from("subjects").select("id,name_i18n,code")).data ?? [] });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("subjects").insert({
        tenant_id: profile!.tenant_id, code, name_i18n: { en: nameEn, am: nameAm },
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subjects-admin"] }); setNameEn(""); setNameAm(""); setCode(""); },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Subjects</h1>
      <Card className="flex flex-wrap gap-2">
        <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} /></Field>
        <Field label="Name (English)"><Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} maxLength={80} /></Field>
        <Field label="ስም (Amharic)"><Input value={nameAm} onChange={(e) => setNameAm(e.target.value)} maxLength={80} /></Field>
        <Button onClick={() => create.mutate()} disabled={!code || !nameEn}>Add</Button>
      </Card>
      <div className="grid gap-2 md:grid-cols-3">
        {subjects?.map((s) => <Card key={s.id} className="text-sm"><span className="font-mono text-xs text-ink-faint">{s.code}</span> {s.name_i18n?.en}</Card>)}
      </div>
    </div>
  );
}
