import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { formatETB } from "@/lib/i18n";

export function PayrollRunDetailPage() {
  const { runId } = useParams();
  const { t, i18n } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ["payroll-run", runId],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_runs").select("*").eq("id", runId).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: payslips } = useQuery({
    queryKey: ["payslips", runId],
    queryFn: async () => {
      const { data, error } = await supabase.from("payslips")
        .select("id, gross, net_pay, income_tax, pension_employee, employees(full_name)")
        .eq("run_id", runId);
      if (error) throw error;
      return data;
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payroll_runs")
        .update({ status: "approved", approved_by: profile!.id }).eq("id", runId);
      if (error) throw error; // DB check constraint rejects if approver === preparer
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-run", runId] }),
  });

  const canApprove = run?.status === "draft" && run.prepared_by !== profile?.id
    && ["accountant", "school_admin"].includes(profile?.role ?? "");

  if (!run) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{run.ec_year} / {String(run.ec_month).padStart(2, "0")}</h1>
        {canApprove && <Button onClick={() => approve.mutate()} disabled={approve.isPending}>{t("hr.approve")}</Button>}
      </div>
      {approve.isError && <p className="text-sm text-danger">{t("hr.sodNote")}</p>}

      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">Employee</th><th className="px-4 py-2">Gross</th><th className="px-4 py-2">Tax</th><th className="px-4 py-2">Pension</th><th className="px-4 py-2">{t("hr.netPay")}</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payslips?.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">{(p.employees as any)?.full_name}</td>
                <td className="px-4 py-2">{formatETB(Number(p.gross), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(p.income_tax), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 text-ink-faint">{formatETB(Number(p.pension_employee), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2 font-semibold">{formatETB(Number(p.net_pay), i18n.resolvedLanguage!)}</td>
                <td className="px-4 py-2"><PayslipLink payslipId={p.id} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PayslipLink({ payslipId }: { payslipId: string }) {
  const { t, i18n } = useTranslation();
  const mutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-payslip-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ payslip_id: payslipId, locale: i18n.resolvedLanguage }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ url: string }>;
    },
  });
  if (mutation.data?.url) return <a href={mutation.data.url} target="_blank" rel="noreferrer" className="text-meskel-deep hover:underline">Open</a>;
  return <button onClick={() => mutation.mutate()} className="text-sm text-ink-faint hover:text-ink">{t("hr.payslip")}</button>;
}
