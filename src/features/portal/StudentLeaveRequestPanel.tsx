import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthDate } from "@/components/EthDate";
import { toIsoDate } from "@/lib/ethiopian-date";

interface LeaveRequestRow {
  id: string; starts_on: string; ends_on: string; reason: string; status: "pending" | "approved" | "rejected" | "cancelled";
}

const STATUS_TONE = { pending: "late", approved: "ok", rejected: "danger", cancelled: "neutral" } as const;

export function StudentLeaveRequestPanel({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [starts, setStarts] = useState<Date | null>(null);
  const [ends, setEnds] = useState<Date | null>(null);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const { data: requests } = useQuery({
    queryKey: ["student-leave-requests", studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_leave_requests")
        .select("id, starts_on, ends_on, reason, status").eq("student_id", studentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LeaveRequestRow[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!starts || !ends || !reason.trim()) return;
      const { error } = await supabase.from("student_leave_requests").insert({
        tenant_id: profile!.tenant_id, student_id: studentId, requested_by: profile!.id,
        starts_on: toIsoDate(starts), ends_on: toIsoDate(ends), reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFormError(null);
      setStarts(null); setEnds(null); setReason("");
      qc.invalidateQueries({ queryKey: ["student-leave-requests", studentId] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("student_leave_requests").update({ status: "cancelled" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student-leave-requests", studentId] }),
  });

  return (
    <Panel>
      <div className="border-b border-line px-4 py-2.5">
        <p className="text-sm font-semibold text-ink">{t("studentLeave.title")}</p>
      </div>
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("studentLeave.startsOn")}><EthDatePicker value={starts} onChange={setStarts} /></Field>
          <Field label={t("studentLeave.endsOn")}><EthDatePicker value={ends} onChange={setEnds} /></Field>
        </div>
        <Field label={t("studentLeave.reason")}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
            className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </Field>
        {formError && <p className="text-sm text-danger">{formError}</p>}
        <Button onClick={() => create.mutate()} disabled={!starts || !ends || !reason.trim() || create.isPending}>
          {create.isPending ? t("studentLeave.submitting") : t("studentLeave.submit")}
        </Button>
      </div>
      {!!requests?.length && (
        <div className="divide-y divide-line border-t border-line">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div>
                <p className="text-ink"><EthDate value={r.starts_on} /> – <EthDate value={r.ends_on} /></p>
                <p className="text-xs text-ink-faint">{r.reason}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={STATUS_TONE[r.status]}>{t(`studentLeave.status.${r.status}`)}</Badge>
                {r.status === "pending" && (
                  <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={() => cancel.mutate(r.id)}>
                    {t("studentLeave.cancel")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
