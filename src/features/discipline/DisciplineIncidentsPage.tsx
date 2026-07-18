import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthDate } from "@/components/EthDate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { toIsoDate } from "@/lib/ethiopian-date";

const SEVERITIES = ["minor", "moderate", "major"] as const;

export function DisciplineIncidentsPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const [date, setDate] = useState<Date | null>(new Date());
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>("minor");

  const { data: students } = useQuery({ queryKey: ["students-brief"], queryFn: async () => (await supabase.from("students").select("id,first_name,last_name")).data ?? [] });
  const { data: incidents } = useQuery({
    queryKey: ["discipline"],
    queryFn: async () => {
      const { data, error } = await supabase.from("discipline_incidents")
        .select("id, incident_date, description, severity, students(first_name,last_name)")
        .order("incident_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("discipline_incidents").insert({
        tenant_id: profile!.tenant_id, student_id: studentId, incident_date: toIsoDate(date!),
        description, severity, reported_by: profile!.id,
        points: severity === "major" ? -3 : severity === "moderate" ? -2 : -1,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["discipline"] }); setOpen(false); setDescription(""); },
  });

  const severityColor = { minor: "text-ink-faint", moderate: "text-late", major: "text-danger" };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("discipline.title")}</h1>
        <Button onClick={() => setOpen((v) => !v)}>{open ? t("discipline.cancel") : t("discipline.logIncident")}</Button>
      </div>

      {open && (
        <Card className="max-w-xl space-y-3">
          <Field label={t("discipline.student")}>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              <option value="">—</option>
              {students?.map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
            </select>
          </Field>
          <Field label={t("discipline.date")}><EthDatePicker value={date} onChange={setDate} /></Field>
          <Field label={t("discipline.severity")}>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              {SEVERITIES.map((s) => <option key={s} value={s}>{t(`discipline.severityLevel.${s}`)}</option>)}
            </select>
          </Field>
          <Field label={t("discipline.description")}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </Field>
          <Button onClick={() => create.mutate()} disabled={!studentId || !description || create.isPending}>{t("discipline.save")}</Button>
        </Card>
      )}

      <div className="space-y-2">
        {incidents?.map((i) => (
          <Card key={i.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ink">{(i.students as any)?.first_name} {(i.students as any)?.last_name}</p>
              <p className="text-sm text-ink-faint">{i.description.slice(0, 80)}</p>
            </div>
            <div className="text-right text-sm">
              <p className={severityColor[i.severity as keyof typeof severityColor]}>{t(`discipline.severityLevel.${i.severity}`)}</p>
              <p className="text-ink-faint"><EthDate value={i.incident_date} /></p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
