import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthDate } from "@/components/EthDate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { toIsoDate } from "@/lib/ethiopian-date";

export function MyLeavePage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [starts, setStarts] = useState<Date | null>(null);
  const [ends, setEnds] = useState<Date | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState("");

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => (await supabase.from("leave_types").select("id, name_i18n")).data ?? [],
  });
  const { data: myRequests } = useQuery({
    queryKey: ["my-leave", profile?.id],
    enabled: !!profile,
    queryFn: async () => {
      const { data: emp } = await supabase.from("employees").select("id").eq("user_id", profile!.id).maybeSingle();
      if (!emp) return [];
      const { data } = await supabase.from("leave_requests")
        .select("id, starts_on, ends_on, status").eq("employee_id", emp.id).order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const file = useMutation({
    mutationFn: async () => {
      const { data: emp, error: empErr } = await supabase.from("employees").select("id, tenant_id").eq("user_id", profile!.id).single();
      if (empErr || !emp) throw empErr ?? new Error("employee_not_found");
      const { error } = await supabase.from("leave_requests").insert({
        tenant_id: emp.tenant_id, employee_id: emp.id, leave_type_id: leaveTypeId,
        starts_on: toIsoDate(starts!), ends_on: toIsoDate(ends!),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-leave"] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t("nav.leave")}</h1>
      <Card className="max-w-lg space-y-3">
        <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}
          className="w-full rounded-control border border-line px-3 py-2 text-sm">
          <option value="">Leave type</option>
          {leaveTypes?.map((lt) => <option key={lt.id} value={lt.id}>{lt.name_i18n?.en ?? lt.id}</option>)}
        </select>
        <div className="flex gap-3">
          <EthDatePicker value={starts} onChange={setStarts} />
          <EthDatePicker value={ends} onChange={setEnds} />
        </div>
        <Button onClick={() => file.mutate()} disabled={!starts || !ends || !leaveTypeId || file.isPending}>
          Submit request
        </Button>
      </Card>
      <div className="space-y-2">
        {myRequests?.map((r) => (
          <Card key={r.id} className="flex items-center justify-between text-sm">
            <span><EthDate value={r.starts_on} /> — <EthDate value={r.ends_on} /></span>
            <span className="capitalize">{t(`hr.${r.status === "approved" ? "approved" : r.status === "rejected" ? "void" : "pending"}`)}</span>
          </Card>
        ))}
      </div>
    </div>
  );
}
