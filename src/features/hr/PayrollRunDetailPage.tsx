import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { formatETB } from "@/lib/i18n";

const STATUS_TONE = { draft: "neutral", approved: "navy", paid: "ok", void: "danger" } as const;

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
        .select("id, employee_id, gross, net_pay, income_tax, pension_employee, employees(full_name)")
        .eq("run_id", runId);
      if (error) throw error;
      return data;
    },
  });

  // Account numbers live behind hr_employee_sensitive (§ column-level grants)
  // -- same view PayrollTab.tsx reads for the single-employee case. Only
  // fetched once the run has left draft, matching when the bank file button
  // itself appears.
  const { data: bankAccounts } = useQuery({
    queryKey: ["payslips-bank-accounts", runId],
    enabled: run?.status !== "draft" && !!payslips?.length,
    queryFn: async () => {
      const ids = (payslips ?? []).map((p) => p.employee_id);
      const { data, error } = await supabase.from("hr_employee_sensitive")
        .select("id, bank_account").in("id", ids);
      if (error) throw error;
      return new Map(data.map((r) => [r.id, r.bank_account]));
    },
  });

  const grossTotal = useMemo(
    () => (payslips ?? []).reduce((sum, p) => sum + Number(p.gross), 0),
    [payslips],
  );

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

  const downloadBankFile = () => {
    const header = ["account_number", "employee_name", "net_pay_etb"];
    const lines = (payslips ?? []).map((p) => {
      const employee = p.employees as unknown as { full_name: string } | null;
      return [
        csvCell(bankAccounts?.get(p.employee_id) ?? ""),
        csvCell(employee?.full_name ?? ""),
        csvCell(Number(p.net_pay).toFixed(2)),
      ].join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bank-file-${run!.ec_year}-${String(run!.ec_month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!run) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-faint">
        <Link to="/hr/payroll" className="hover:underline">{t("hr.payrollRuns")}</Link> › <span className="text-navy">{t("students.profile.breadcrumb")}</span>
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink">{run.ec_year} / {String(run.ec_month).padStart(2, "0")}</h1>
          <Badge tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`hr.${run.status}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {run.status !== "draft" && (
            <Button variant="ghost" className="border border-line" onClick={downloadBankFile} disabled={!payslips?.length}>
              ⬇ {t("hr.downloadBankFile")}
            </Button>
          )}
          {canApprove && <Button onClick={() => approve.mutate()} disabled={approve.isPending}>{t("hr.approve")}</Button>}
        </div>
      </div>
      {approve.isError && <p className="text-sm text-danger">{t("hr.sodNote")}</p>}

      <Card className="bg-gradient-to-br from-navy to-navy-container text-white">
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">{t("hr.grossTotal")}</p>
        <p className="mt-2 font-display text-3xl font-bold tabular-nums">
          {formatETB(grossTotal, i18n.resolvedLanguage!)}
        </p>
      </Card>

      <Panel>
        <PanelHeader title={t("hr.payrollRuns")} />
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-5 py-3">{t("hr.employee")}</th><th className="px-5 py-3">{t("hr.gross")}</th><th className="px-5 py-3">{t("hr.tax")}</th><th className="px-5 py-3">{t("hr.pensionCol")}</th><th className="px-5 py-3">{t("hr.netPay")}</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {payslips?.map((p) => {
              const employee = p.employees as unknown as { full_name: string } | null;
              return (
              <tr key={p.id}>
                <td className="px-5 py-3 font-medium text-ink">{employee?.full_name}</td>
                <td className="px-5 py-3 tabular-nums text-ink">{formatETB(Number(p.gross), i18n.resolvedLanguage!)}</td>
                <td className="px-5 py-3 tabular-nums text-ink-faint">{formatETB(Number(p.income_tax), i18n.resolvedLanguage!)}</td>
                <td className="px-5 py-3 tabular-nums text-ink-faint">{formatETB(Number(p.pension_employee), i18n.resolvedLanguage!)}</td>
                <td className="px-5 py-3 tabular-nums font-semibold text-ink">{formatETB(Number(p.net_pay), i18n.resolvedLanguage!)}</td>
                <td className="px-5 py-3"><PayslipLink payslipId={p.id} /></td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
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
  if (mutation.data?.url) return <a href={mutation.data.url} target="_blank" rel="noreferrer" className="text-navy hover:underline">{t("hr.open")}</a>;
  return <button onClick={() => mutation.mutate()} className="text-sm text-ink-faint hover:text-ink">{t("hr.payslip")}</button>;
}
