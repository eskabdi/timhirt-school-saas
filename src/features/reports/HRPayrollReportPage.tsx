import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { tField } from "@/lib/i18n";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Pagination, pageRange } from "@/components/ui/Pagination";
import { ReportStat, ReportBarChart, ReportSection } from "./ReportComponents";

const EMPLOYEE_TYPE_LABEL: Record<string, string> = { teacher: "Teacher", admin_staff: "Admin Staff", support: "Support" };
const EMPLOYEE_STATUS_TONE = { active: "ok", on_leave: "late", terminated: "danger" } as const;

interface Employee { id: string; employee_type: string; status: string; }
interface PayrollRun { id: string; ec_year: number; ec_month: number; status: string; }
interface Payslip { run_id: string; gross: number; income_tax: number; net_pay: number; }
interface LeaveRequest { id: string; status: string; leave_type_id: string; }
interface LeaveType { id: string; name_i18n: Record<string, string>; }

function fmtEtb(n: number) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)} ETB`;
}

export function HRPayrollReportPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const [typePage, setTypePage] = useState(1);
  const [leavePage, setLeavePage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["hr-payroll-report"],
    queryFn: async () => {
      const [{ data: employees, error: e1 }, { data: runs, error: e2 }, { data: payslips, error: e3 },
        { data: leaves, error: e4 }, { data: leaveTypes, error: e5 }] = await Promise.all([
        supabase.from("employees").select("id, employee_type, status").limit(2000),
        supabase.from("payroll_runs").select("id, ec_year, ec_month, status").order("ec_year", { ascending: false }).order("ec_month", { ascending: false }).limit(6),
        supabase.from("payslips").select("run_id, gross, income_tax, net_pay").limit(5000),
        supabase.from("leave_requests").select("id, status, leave_type_id").eq("status", "pending").limit(2000),
        supabase.from("leave_types").select("id, name_i18n").limit(100),
      ]);
      if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4; if (e5) throw e5;
      return {
        employees: (employees ?? []) as Employee[],
        runs: (runs ?? []) as PayrollRun[],
        payslips: (payslips ?? []) as Payslip[],
        leaves: (leaves ?? []) as LeaveRequest[],
        leaveTypes: (leaveTypes ?? []) as LeaveType[],
      };
    },
  });

  const byType = useMemo(() => {
    const rows = new Map<string, number>();
    for (const e of data?.employees ?? []) rows.set(e.employee_type, (rows.get(e.employee_type) ?? 0) + 1);
    return Array.from(rows.entries());
  }, [data]);

  const byStatus = useMemo(() => {
    const rows = new Map<string, number>();
    for (const e of data?.employees ?? []) rows.set(e.status, (rows.get(e.status) ?? 0) + 1);
    return Array.from(rows.entries());
  }, [data]);

  const payrollTrend = useMemo(() => {
    if (!data) return [];
    const totalsByRun = new Map<string, number>();
    for (const p of data.payslips) totalsByRun.set(p.run_id, (totalsByRun.get(p.run_id) ?? 0) + Number(p.net_pay));
    return [...data.runs].reverse().map((r) => ({
      label: `${String(r.ec_month).padStart(2, "0")}/${r.ec_year}`,
      value: Math.round(totalsByRun.get(r.id) ?? 0),
    }));
  }, [data]);

  const latestRun = data?.runs?.[0];
  const latestTotals = useMemo(() => {
    if (!latestRun || !data) return null;
    const rows = data.payslips.filter((p) => p.run_id === latestRun.id);
    return {
      gross: rows.reduce((s, r) => s + Number(r.gross), 0),
      tax: rows.reduce((s, r) => s + Number(r.income_tax), 0),
      net: rows.reduce((s, r) => s + Number(r.net_pay), 0),
      count: rows.length,
    };
  }, [latestRun, data]);

  const pendingLeaveByType = useMemo(() => {
    if (!data) return [];
    const typeById = new Map(data.leaveTypes.map((lt) => [lt.id, tField(lt.name_i18n, locale) || "—"]));
    const rows = new Map<string, number>();
    for (const l of data.leaves) rows.set(l.leave_type_id, (rows.get(l.leave_type_id) ?? 0) + 1);
    return Array.from(rows.entries()).map(([id, count]) => ({ label: typeById.get(id) ?? "—", count }));
  }, [data, locale]);

  // Slicing here is display-only — byType/pendingLeaveByType (and the stat
  // cards above, sourced from the full data.employees/leaves arrays) keep
  // reporting the complete totals.
  const [typeFrom, typeTo] = pageRange(typePage);
  const visibleByType = byType.slice(typeFrom, typeTo + 1);
  const [leaveFrom, leaveTo] = pageRange(leavePage);
  const visiblePendingLeaveByType = pendingLeaveByType.slice(leaveFrom, leaveTo + 1);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("reportPages.hrTitle")}</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <ReportStat label={t("reportPages.totalEmployees")} value={isLoading ? "—" : (data?.employees.length ?? 0)} />
        <ReportStat label={`${t("reportPages.latestRunGross")}${latestRun ? ` (${latestRun.ec_month}/${latestRun.ec_year})` : ""}`} value={isLoading ? "—" : latestTotals ? fmtEtb(latestTotals.gross) : "—"} />
        <ReportStat label={t("reportPages.latestRunNet")} value={isLoading ? "—" : latestTotals ? fmtEtb(latestTotals.net) : "—"} tone="ok" />
        <ReportStat label={t("reportPages.pendingLeave")} value={isLoading ? "—" : (data?.leaves.length ?? 0)} tone="late" />
      </div>

      <ReportSection title={t("reportPages.netPayrollLast6")}>
        {payrollTrend.length ? <ReportBarChart bars={payrollTrend} /> : <p className="text-sm text-ink-faint">{t("noRecordsYet")}</p>}
      </ReportSection>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.headcountByType")}</h2></div>
          {!byType.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {visibleByType.map(([type, count]) => (
                  <tr key={type}>
                    <td className="px-5 py-3 text-ink-soft">{EMPLOYEE_TYPE_LABEL[type] ?? type}</td>
                    <td className="px-5 py-3 text-right font-medium text-ink">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pagination page={typePage} totalCount={byType.length} onPageChange={setTypePage} className="px-5" />
        </Panel>

        <Panel>
          <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.headcountByStatus")}</h2></div>
          {!byStatus.length ? (
            <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
          ) : (
            <div className="flex flex-wrap gap-2 px-5 py-4">
              {byStatus.map(([status, count]) => (
                <Badge key={status} tone={EMPLOYEE_STATUS_TONE[status as keyof typeof EMPLOYEE_STATUS_TONE] ?? "neutral"}>
                  {status.replace("_", " ")}: {count}
                </Badge>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel>
        <div className="border-b border-line px-5 py-4"><h2 className="font-semibold text-ink">{t("reportPages.pendingLeaveByType")}</h2></div>
        {!pendingLeaveByType.length ? (
          <p className="px-5 py-8 text-center text-sm text-ink-faint">{t("noRecordsYet")}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {visiblePendingLeaveByType.map((row) => (
                <tr key={row.label}>
                  <td className="px-5 py-3 text-ink-soft">{row.label}</td>
                  <td className="px-5 py-3 text-right font-medium text-ink">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination page={leavePage} totalCount={pendingLeaveByType.length} onPageChange={setLeavePage} className="px-5" />
      </Panel>
    </div>
  );
}
