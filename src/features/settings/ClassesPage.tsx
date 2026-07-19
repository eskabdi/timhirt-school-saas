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
  const [gradeLevel, setGradeLevel] = useState("");
  const [capacity, setCapacity] = useState("");

  const { data: years } = useQuery({ queryKey: ["academic-years"], queryFn: async () => (await supabase.from("academic_years").select("id,ec_year").eq("status", "active")).data ?? [] });
  const { data: classes } = useQuery({
    queryKey: ["classes-admin"],
    queryFn: async () => (await supabase.from("classes").select("id,name,section,grade_level,capacity")).data ?? [],
  });
  const { data: enrolledCounts } = useQuery({
    queryKey: ["classes-admin-enrolled"],
    queryFn: async () => {
      const { data } = await supabase.from("students").select("class_id").eq("status", "active");
      const counts = new Map<string, number>();
      for (const s of data ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
      return counts;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!years?.[0]) return;
      const { error } = await supabase.from("classes").insert({
        tenant_id: profile!.tenant_id,
        academic_year_id: years[0].id,
        name, section,
        grade_level: gradeLevel === "" ? null : Number(gradeLevel),
        capacity: capacity === "" ? null : Number(capacity),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["classes-admin"] });
      setName(""); setSection(""); setGradeLevel(""); setCapacity("");
    },
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Classes</h1>
      <Card className="flex flex-wrap items-end gap-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Grade 5" /></Field>
        <Field label="Section"><Input value={section} onChange={(e) => setSection(e.target.value)} maxLength={10} placeholder="A" /></Field>
        <Field label="Grade level (0-12)">
          <Input type="number" min={0} max={12} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className="w-24" />
        </Field>
        <Field label="Capacity">
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="w-24" placeholder="Unlimited" />
        </Field>
        <Button onClick={() => create.mutate()} disabled={!name}>Add</Button>
      </Card>
      <div className="grid gap-2 md:grid-cols-3">
        {classes?.map((c) => {
          const enrolled = enrolledCounts?.get(c.id) ?? 0;
          return (
            <Card key={c.id} className="space-y-1 text-sm">
              <p className="font-medium">{c.name} {c.section}</p>
              <p className="text-xs text-ink-faint">
                {c.capacity != null ? `${enrolled}/${c.capacity} enrolled` : `${enrolled} enrolled`}
                {c.grade_level != null ? ` · grade ${c.grade_level}` : ""}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
