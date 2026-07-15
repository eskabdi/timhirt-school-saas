import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { todayEthiopian } from "@/lib/ethiopian-date";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-chalk-sunken text-ink-faint", approved: "bg-meskel-wash text-meskel-deep",
  paid: "bg-ok/10 text-ok", void: "bg-danger/10 text-danger",
};

export function PayrollRunsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const today = todayEthiopian();
  const [ecYear, setEcYear] = useState(today.year);
  const [ecMonth, setEcMonth] = useState(today.month);

  const { data: runs } = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_runs")
        .select("id, ec_year, ec_month, status, prepared_by, approved_by")
        .order("ec_year", { ascending: false }).order("ec_month", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-runs"] }),
  });

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">{t("hr.payrollRuns")}</h1>

      <Card className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-ink-faint">EC Year</label>
          <input type="number" value={ecYear} onChange={(e) => setEcYear(Number(e.target.value))}
            className="w-24 rounded-card border border-line px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-ink-faint">EC Month</label>
          <input type="number" min={1} max={13} value={ecMonth} onChange={(e) => setEcMonth(Number(e.target.value))}
            className="w-20 rounded-card border border-line px-3 py-2 text-sm" />
        </div>
        <Button onClick={() => runPayroll.mutate()} disabled={runPayroll.isPending}>
          {runPayroll.isPending ? "…" : t("hr.runPayroll")}
        </Button>
        {runPayroll.isError && <p className="text-sm text-danger">{(runPayroll.error as Error).message}</p>}
        {runPayroll.isSuccess && (
          <p className="text-sm text-ok">
            {t("hr.employeesCount", { count: runPayroll.data.employees })} · {t("hr.grossTotal")}: {runPayroll.data.gross_total} ETB
          </p>
        )}
      </Card>

      <div className="space-y-2">
        {runs?.map((r) => (
          <Link key={r.id} to={`/hr/payroll/${r.id}`}>
            <Card className="flex items-center justify-between hover:border-meskel">
              <span className="font-medium">{r.ec_year} / {String(r.ec_month).padStart(2, "0")}</span>
              <span className={cn("rounded-card px-2.5 py-1 text-xs font-medium capitalize", STATUS_COLOR[r.status])}>
                {t(`hr.${r.status}`)}
              </span>
            </Card>
          </Link>
        ))}
      </div>
      <p className="text-xs text-ink-faint">{t("hr.sodNote")}</p>
    </div>
  );
}
