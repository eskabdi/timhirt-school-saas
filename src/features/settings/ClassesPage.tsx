import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";

export function ClassesPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [section, setSection] = useState("");

  const { data: years } = useQuery({ queryKey: ["academic-years"], queryFn: async () => (await supabase.from("academic_years").select("id,ec_year").eq("status", "active")).data ?? [] });
  const { data: classes } = useQuery({ queryKey: ["classes-admin"], queryFn: async () => (await supabase.from("classes").select("id,name,section")).data ?? [] });

  const create = useMutation({
    mutationFn: async () => {
      if (!years?.[0]) return;
      const { error } = await supabase.from("classes").insert({ tenant_id: profile!.tenant_id, academic_year_id: years[0].id, name, section });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["classes-admin"] }); setName(""); setSection(""); },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Classes</h1>
      <Card className="flex gap-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
        <Field label="Section"><Input value={section} onChange={(e) => setSection(e.target.value)} maxLength={10} /></Field>
        <Button onClick={() => create.mutate()} disabled={!name}>Add</Button>
      </Card>
      <div className="grid gap-2 md:grid-cols-3">
        {classes?.map((c) => <Card key={c.id} className="text-sm font-medium">{c.name} {c.section}</Card>)}
      </div>
    </div>
  );
}
