import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

export function LeaveApprovalsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: requests } = useQuery({
    queryKey: ["leave-requests", "pending"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_requests")
        .select("id, starts_on, ends_on, status, employees(full_name), leave_types(name_i18n)")
        .eq("status", "pending").order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase.from("leave_requests").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave-requests"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("hr.leaveRequests")}</h1>
      {!requests?.length ? (
        <Card className="py-12 text-center text-ink-faint">{t("hr.pending")}: 0</Card>
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Card key={r.id} className="flex items-center justify-between">
              <div>
                <p className="font-medium text-ink">{(r.employees as any)?.full_name}</p>
                <p className="text-sm text-ink-faint"><EthDate value={r.starts_on} /> — <EthDate value={r.ends_on} /></p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => decide.mutate({ id: r.id, status: "rejected" })}>{t("hr.reject")}</Button>
                <Button onClick={() => decide.mutate({ id: r.id, status: "approved" })}>{t("hr.approveLeave")}</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
