// Payroll tab. Base salary is real, editable state (this is where the
// registration wizard's explicit basic_salary: 0 placeholder gets fixed).
// Allowances/deductions are read-only here — a full component-picker UI is
// the RolesPage-sized undertaking the plan explicitly deferred. The net
// breakdown is a client-side estimate (badge says so): the authoritative
// number is whatever run-payroll computed, which is what Recent Payments
// shows. Telebirr wallet and Bank Name/Branch aren't columns anywhere in the
// schema and are left out; only Bank Account (hr_employee_sensitive) is real.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { formatETB } from "@/lib/i18n";

const HR_WRITE_ROLES = ["school_admin", "hr_officer"];

export function PayrollTab({ employeeId, tenantId, canSeeSensitive }: {
  employeeId: string; tenantId: string; canSeeSensitive: boolean;
}) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { profile } = useSession();
  const canEdit = !!profile && HR_WRITE_ROLES.includes(profile.role);
  const [editingSalary, setEditingSalary] = useState(false);
  const [salaryInput, setSalaryInput] = useState("0");
  const [editingBank, setEditingBank] = useState(false);
  const [bankInput, setBankInput] = useState("");

  const { data: contract } = useQuery({
    queryKey: ["staff-contract-payroll", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employment_contracts")
        .select("id, basic_salary").eq("employee_id", employeeId).eq("status", "active").maybeSingle();
      return data;
    },
  });

  const { data: components } = useQuery({
    queryKey: ["staff-salary-components", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employee_salary_components")
        .select("id, amount, salary_components(name_i18n, kind, calc_type)").eq("employee_id", employeeId);
      return (data ?? []) as unknown as {
        id: string; amount: number;
        salary_components: { name_i18n: Record<string, string>; kind: "allowance" | "deduction"; calc_type: string } | null;
      }[];
    },
  });

  const { data: sensitive } = useQuery({
    queryKey: ["staff-sensitive-payroll", employeeId],
    enabled: canSeeSensitive,
    queryFn: async () => {
      const { data } = await supabase.from("hr_employee_sensitive").select("bank_account").eq("id", employeeId).maybeSingle();
      return data;
    },
  });

  const { data: payslips } = useQuery({
    queryKey: ["staff-payslips", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("payslips")
        .select("id, gross, net_pay, generated_at, payroll_runs(ec_year, ec_month, status)")
        .eq("employee_id", employeeId).order("generated_at", { ascending: false }).limit(6);
      return (data ?? []) as unknown as {
        id: string; gross: number; net_pay: number; generated_at: string;
        payroll_runs: { ec_year: number; ec_month: number; status: string } | null;
      }[];
    },
  });

  const basic = Number(contract?.basic_salary ?? 0);
  const hasSalary = basic > 0;
  const allowances = (components ?? []).filter((c) => c.salary_components?.kind === "allowance");
  const deductions = (components ?? []).filter((c) => c.salary_components?.kind === "deduction");
  const componentAmount = (c: (typeof allowances)[number]) =>
    c.salary_components?.calc_type === "percent_of_basic" ? (basic * Number(c.amount)) / 100 : Number(c.amount);
  const totalAllowances = allowances.reduce((s, c) => s + componentAmount(c), 0);
  const totalDeductions = deductions.reduce((s, c) => s + componentAmount(c), 0);
  const totalGross = basic + totalAllowances;
  const estimatedNet = totalGross - totalDeductions;

  const saveSalary = useMutation({
    mutationFn: async () => {
      const value = Math.max(0, Number(salaryInput) || 0);
      if (contract) {
        const { error } = await supabase.from("employment_contracts").update({ basic_salary: value }).eq("id", contract.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employment_contracts").insert({
          tenant_id: tenantId, employee_id: employeeId, contract_type: "contract",
          basic_salary: value, starts_on: new Date().toISOString().slice(0, 10),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-contract-payroll", employeeId] }); setEditingSalary(false); },
  });

  const saveBank = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employees").update({ bank_account: bankInput.trim() || null }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-sensitive-payroll", employeeId] }); setEditingBank(false); },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader title={t("staffProfile.salaryStructure")} action={
            canEdit && !editingSalary && <Button variant="ghost" onClick={() => { setSalaryInput(String(basic)); setEditingSalary(true); }}>{t("staffProfile.editBaseSalary")}</Button>
          } />
          <div className="p-4">
            {!editingSalary ? (
              <div>
                <p className="text-xs text-ink-faint">{t("staffProfile.baseSalary")}</p>
                <p className="font-display text-2xl font-bold text-ink">
                  {hasSalary ? formatETB(basic, i18n.resolvedLanguage!) : <span className="text-late">{t("staffProfile.baseSalaryNotSet")}</span>}
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <input type="number" min={0} step="0.01" value={salaryInput} onChange={(e) => setSalaryInput(e.target.value)}
                  className="w-40 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
                <Button onClick={() => saveSalary.mutate()} disabled={saveSalary.isPending}>{t("staffProfile.saveBaseSalary")}</Button>
                <Button variant="ghost" onClick={() => setEditingSalary(false)}>{t("staffProfile.cancel")}</Button>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title={t("staffProfile.allowancesDeductions")} />
          <ul className="divide-y divide-line">
            {!components?.length ? (
              <li className="px-4 py-6 text-center text-sm text-ink-faint">{t("staffProfile.noComponents")}</li>
            ) : components.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <span className="text-ink">{(c.salary_components?.name_i18n as Record<string, string>)?.en}</span>
                <span className={c.salary_components?.kind === "allowance" ? "text-ok" : "text-danger"}>
                  {c.salary_components?.kind === "allowance" ? "+" : "−"}{formatETB(componentAmount(c), i18n.resolvedLanguage!)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel>
          <PanelHeader title={t("staffProfile.recentPayments")} action={
            <Link to="/hr/payroll" className="text-xs font-semibold text-navy hover:underline">{t("staffProfile.fullHistory")}</Link>
          } />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
                <tr>
                  <th className="px-4 py-2">{t("staffProfile.payPeriod")}</th>
                  <th className="px-4 py-2">{t("staffProfile.grossAmount")}</th>
                  <th className="px-4 py-2">{t("staffProfile.netPaid")}</th>
                  <th className="px-4 py-2">{t("hr.statusLabel")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!payslips?.length ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-faint">{t("staffProfile.noPayslipsYet")}</td></tr>
                ) : payslips.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2 text-ink">{p.payroll_runs?.ec_year} / {String(p.payroll_runs?.ec_month).padStart(2, "0")}</td>
                    <td className="px-4 py-2 text-ink-faint">{formatETB(Number(p.gross), i18n.resolvedLanguage!)}</td>
                    <td className="px-4 py-2 font-medium text-ink">{formatETB(Number(p.net_pay), i18n.resolvedLanguage!)}</td>
                    <td className="px-4 py-2 text-ink-faint">{t(`hr.${p.payroll_runs?.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <div className="space-y-2 rounded-panel bg-navy p-4 text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide">{t("staffProfile.netSalaryBreakdown")}</h2>
            <span className="rounded-pill bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide">{t("staffProfile.estimatedNet")}</span>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-white/70">{t("staffProfile.monthlyAllowances")}</dt><dd>{formatETB(totalAllowances, i18n.resolvedLanguage!)}</dd></div>
            <div className="flex justify-between"><dt className="text-white/70">{t("staffProfile.deductions")}</dt><dd>{formatETB(totalDeductions, i18n.resolvedLanguage!)}</dd></div>
            <div className="flex justify-between border-t border-white/20 pt-1.5"><dt className="text-white/70">{t("staffProfile.totalGross")}</dt><dd>{formatETB(totalGross, i18n.resolvedLanguage!)}</dd></div>
            <div className="flex justify-between"><dt className="text-white/70">{t("staffProfile.totalDeductions")}</dt><dd>{formatETB(totalDeductions, i18n.resolvedLanguage!)}</dd></div>
            <div className="flex justify-between border-t border-white/20 pt-1.5 text-base font-bold"><dt>{t("staffProfile.netPayable")}</dt><dd>{formatETB(estimatedNet, i18n.resolvedLanguage!)} <span className="text-xs font-normal text-white/60">{t("staffProfile.perMonth")}</span></dd></div>
          </dl>
        </div>

        {canSeeSensitive && (
          <Panel>
            <PanelHeader title={t("staffProfile.disbursementDetails")} action={
              canEdit && !editingBank && <Button variant="ghost" onClick={() => { setBankInput(sensitive?.bank_account ?? ""); setEditingBank(true); }}>{t("staffProfile.editBaseSalary")}</Button>
            } />
            <div className="p-4">
              {!editingBank ? (
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.accountNumber")}</dt><dd className="font-mono text-sm text-ink">{sensitive?.bank_account ?? "—"}</dd></div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <input value={bankInput} onChange={(e) => setBankInput(e.target.value)}
                    className="w-40 rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
                  <Button onClick={() => saveBank.mutate()} disabled={saveBank.isPending}>{t("staffProfile.saveBaseSalary")}</Button>
                  <Button variant="ghost" onClick={() => setEditingBank(false)}>{t("staffProfile.cancel")}</Button>
                </div>
              )}
              {saveBank.isError && <p className="mt-1 text-xs text-danger">{(saveBank.error as Error).message}</p>}
            </div>
          </Panel>
        )}

        <Link to="/settings/audit-logs" className="block rounded-panel border border-line bg-card px-4 py-3 text-center text-sm font-semibold text-navy hover:bg-sidebar">
          {t("staffProfile.auditLog")}
        </Link>
      </div>
    </div>
  );
}
