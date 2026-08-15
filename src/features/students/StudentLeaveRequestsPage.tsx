// Admin/teacher decision queue for parent-submitted student leave requests.
// No module gate -- RLS (school_admin, or the student's own class teacher)
// is the real access boundary here, same "not a toggleable module" call
// already made for messages (router.tsx).
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";

interface PendingLeaveRow {
  id: string; starts_on: string; ends_on: string; reason: string;
  student: { first_name: string; last_name: string; class: { name: string; section: string | null } | null } | null;
}

export function StudentLeaveRequestsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data: pending, isLoading } = useQuery({
    queryKey: ["student-leave-requests-pending"],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_leave_requests")
        .select("id, starts_on, ends_on, reason, student:students(first_name, last_name, class:classes(name, section))")
        .eq("status", "pending").order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as PendingLeaveRow[];
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const { error } = await supabase.rpc("decide_student_leave_request", { p_request_id: id, p_approve: approve });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["student-leave-requests-pending"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("studentLeave.queueTitle")}</h1>
      <p className="max-w-2xl text-sm text-ink-faint">{t("studentLeave.queueSubtitle")}</p>
      {isLoading && <p className="text-sm text-ink-faint">…</p>}
      {!isLoading && !pending?.length && (
        <Card className="py-12 text-center text-ink-faint">{t("studentLeave.queueEmpty")}</Card>
      )}
      <div className="space-y-2">
        {pending?.map((r) => (
          <Card key={r.id} className="flex items-center justify-between gap-4 text-sm">
            <div>
              <p className="font-medium text-ink">
                {r.student?.first_name} {r.student?.last_name}
                {r.student?.class ? ` — ${r.student.class.name} ${r.student.class.section ?? ""}` : ""}
              </p>
              <p className="text-ink-faint"><EthDate value={r.starts_on} /> – <EthDate value={r.ends_on} /></p>
              <p className="text-xs text-ink-faint">{r.reason}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="tertiary" onClick={() => decide.mutate({ id: r.id, approve: false })} disabled={decide.isPending}>
                {t("studentLeave.reject")}
              </Button>
              <Button onClick={() => decide.mutate({ id: r.id, approve: true })} disabled={decide.isPending}>
                {t("studentLeave.approve")}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
