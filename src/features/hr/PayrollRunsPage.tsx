import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { todayEthiopian } from "@/lib/ethiopian-date";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";

const STATUS_TONE = { draft: "neutral", approved: "navy", paid: "ok", void: "danger" } as const;

export function PayrollRunsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = todayEthiopian();
  const [ecYear, setEcYear] = useState(today.year);
  const [ecMonth, setEcMonth] = useState(today.month);
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["payroll-runs", page],
    queryFn: async () => {
      const { data, error, count } = await supabase.from("payroll_runs")
        .select("id, ec_year, ec_month, status, prepared_by, approved_by", { count: "exact" })
        .order("ec_year", { ascending: false }).order("ec_month", { ascending: false })
        .range(...pageRange(page));
      if (error) throw error;
      return { rows: data ?? [], count: count ?? 0 };
    },
  });
  const runs = data?.rows;

  const runPayroll = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/run-payroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ ec_year: ecYear, ec_month: ecMonth }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
      return res.json();
    },
    onSuccess: () => { setPage(1); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); },
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-ink">{t("hr.payrollRuns")}</h1>

      <Card className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-ink-faint">{t("common.ecYear")}</label>
          <input type="number" value={ecYear} onChange={(e) => setEcYear(Number(e.target.value))}
            className="w-24 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-ink-faint">{t("common.ecMonth")}</label>
          <input type="number" min={1} max={13} value={ecMonth} onChange={(e) => setEcMonth(Number(e.target.value))}
            className="w-20 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
        </div>
        <Button onClick={() => runPayroll.mutate()} disabled={runPayroll.isPending}>
          {runPayroll.isPending ? "…" : t("hr.runPayroll")}
        </Button>
        {runPayroll.isError && <p className="text-sm text-danger">{(runPayroll.error as Error).message}</p>}
        {runPayroll.isSuccess && (
          <div className="text-sm">
            <p className="text-ok">
              {t("hr.employeesCount", { count: runPayroll.data.employees })} · {t("hr.grossTotal")}: {runPayroll.data.gross_total} ETB
            </p>
            {runPayroll.data.skipped_no_salary?.length > 0 && (
              <p className="text-late">{t("hr.skippedNoSalaryCount", { count: runPayroll.data.skipped_no_salary.length })}</p>
            )}
          </div>
        )}
      </Card>

      <div className="space-y-2">
        {runs?.map((r) => (
          <Link key={r.id} to={`/hr/payroll/${r.id}`}>
            <Card className="flex items-center justify-between hover:border-navy">
              <span className="font-medium text-ink">{r.ec_year} / {String(r.ec_month).padStart(2, "0")}</span>
              <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`hr.${r.status}`)}</Badge>
            </Card>
          </Link>
        ))}
      </div>
      <Pagination page={page} totalCount={data?.count ?? 0} onPageChange={setPage} />
      <p className="text-xs text-ink-faint">{t("hr.sodNote")}</p>
    </div>
  );
}
