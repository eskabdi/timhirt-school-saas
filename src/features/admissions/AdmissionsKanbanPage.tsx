import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

const STAGES = ["applied", "shortlisted", "offered", "registered", "rejected"] as const;

export function AdmissionsKanbanPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: apps } = useQuery({
    queryKey: ["admissions"],
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_applications")
        .select("id, applicant_name, date_of_birth, stage, created_at").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const move = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const { error } = await supabase.from("admission_applications").update({ stage }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admissions"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("admissions.title")}</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {STAGES.map((stage) => (
          <div key={stage} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t(`admissions.stage.${stage}`)}</h2>
            {apps?.filter((a) => a.stage === stage).map((a) => (
              <Card key={a.id} className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{a.applicant_name}</p>
                  <Link to={`/admissions/${a.id}`} className="shrink-0 text-xs text-navy hover:underline">{t("admissions.view")}</Link>
                </div>
                <p className="text-xs text-ink-faint"><EthDate value={a.date_of_birth} /></p>
                <div className="flex flex-wrap gap-1 pt-1">
                  {STAGES.filter((s) => s !== stage).map((s) => (
                    <button key={s} onClick={() => move.mutate({ id: a.id, stage: s })}
                      className="rounded-control bg-sidebar px-1.5 py-0.5 text-[10px] text-ink-faint hover:bg-line">
                      → {t(`admissions.stage.${s}`)}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
