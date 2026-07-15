import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

const STAGES = ["applied", "shortlisted", "offered", "registered"] as const;
const STAGE_LABEL: Record<string, string> = { applied: "Applied", shortlisted: "Shortlisted", offered: "Offered", registered: "Registered" };

export function AdmissionsKanbanPage() {
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
      <h1 className="font-display text-2xl font-bold">Admissions</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        {STAGES.map((stage) => (
          <div key={stage} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{STAGE_LABEL[stage]}</h2>
            {apps?.filter((a) => a.stage === stage).map((a) => (
              <Card key={a.id} className="space-y-1 p-3">
                <p className="text-sm font-medium">{a.applicant_name}</p>
                <p className="text-xs text-ink-faint"><EthDate value={a.date_of_birth} /></p>
                <div className="flex gap-1 pt-1">
                  {STAGES.filter((s) => s !== stage).map((s) => (
                    <button key={s} onClick={() => move.mutate({ id: a.id, stage: s })}
                      className="rounded bg-chalk-sunken px-1.5 py-0.5 text-[10px] text-ink-faint hover:bg-line">
                      → {STAGE_LABEL[s]}
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
