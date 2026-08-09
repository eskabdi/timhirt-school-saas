// Employment & Contract tab. The design's "Contract Integrity" gauge has no
// real metric behind it and is left out; "Generate Letter" needs a letter
// template system that doesn't exist and is left out too. Editing the
// contract here is real: it writes employment_contracts (contract type,
// dates) and employees (probation status, notice period) together, since the
// design's one "Edit Contract" affordance spans both tables.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";

const CONTRACT_TYPES = ["permanent", "contract", "part_time"] as const;
const PROBATION_STATUSES = ["not_applicable", "in_progress", "passed", "extended", "failed"] as const;

interface StaffEmployee {
  id: string; tenant_id: string; job_title: string | null; department: string | null;
  employee_type: string; employee_no: string; office_location: string | null;
  manager: { full_name: string }[] | null;
}

export function EmploymentTab({ employeeId, employee }: { employeeId: string; employee: StaffEmployee }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [contractType, setContractType] = useState<string>("permanent");
  const [startsOn, setStartsOn] = useState<Date | null>(null);
  const [endsOn, setEndsOn] = useState<Date | null>(null);
  const [probation, setProbation] = useState<string>("not_applicable");
  const [noticeDays, setNoticeDays] = useState<number>(30);

  const { data: contract } = useQuery({
    queryKey: ["staff-contract", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employment_contracts")
        .select("id, contract_type, starts_on, ends_on, status")
        .eq("employee_id", employeeId).eq("status", "active").maybeSingle();
      return data;
    },
  });

  const { data: extra } = useQuery({
    queryKey: ["staff-employment-extra", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("probation_status, notice_period_days").eq("id", employeeId).single();
      if (error) throw error;
      return data;
    },
  });

  const startEdit = () => {
    setContractType(contract?.contract_type ?? "permanent");
    setStartsOn(contract?.starts_on ? new Date(contract.starts_on) : new Date());
    setEndsOn(contract?.ends_on ? new Date(contract.ends_on) : null);
    setProbation(extra?.probation_status ?? "not_applicable");
    setNoticeDays(extra?.notice_period_days ?? 30);
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (contract) {
        const { error } = await supabase.from("employment_contracts").update({
          contract_type: contractType,
          starts_on: startsOn!.toISOString().slice(0, 10),
          ends_on: endsOn ? endsOn.toISOString().slice(0, 10) : null,
        }).eq("id", contract.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employment_contracts").insert({
          tenant_id: employee.tenant_id, employee_id: employeeId, contract_type: contractType,
          basic_salary: 0, starts_on: startsOn!.toISOString().slice(0, 10),
          ends_on: endsOn ? endsOn.toISOString().slice(0, 10) : null,
        });
        if (error) throw error;
      }
      const { error: empErr } = await supabase.from("employees")
        .update({ probation_status: probation, notice_period_days: noticeDays }).eq("id", employeeId);
      if (empErr) throw empErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-contract", employeeId] });
      qc.invalidateQueries({ queryKey: ["staff-employment-extra", employeeId] });
      setEditing(false);
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel>
          <PanelHeader title={t("staffProfile.employmentDetails")} action={
            <Link to="/settings/audit-logs" className="text-xs font-semibold text-navy hover:underline">{t("staffProfile.viewHistory")}</Link>
          } />
          <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-ink-faint">{t("staffProfile.jobTitle")}</dt><dd className="font-medium text-ink">{employee.job_title || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffReg.department")}</dt><dd className="font-medium text-ink">{employee.department || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("hr.type")}</dt><dd className="font-medium text-ink">{t(`hr.employeeType.${employee.employee_type}`)}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffProfile.lineManager")}</dt><dd className="font-medium text-ink">{employee.manager?.[0]?.full_name || "—"}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("hr.employeeNo")}</dt><dd className="font-medium text-ink">{employee.employee_no}</dd></div>
            <div><dt className="text-xs text-ink-faint">{t("staffProfile.officeLocation")}</dt><dd className="font-medium text-ink">{employee.office_location || "—"}</dd></div>
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title={t("staffProfile.contractInformation")} action={
            !editing && <Button variant="ghost" onClick={startEdit}>{t("staffProfile.editContract")}</Button>
          } />
          {!editing ? (
            contract ? (
              <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
                <div><dt className="text-xs text-ink-faint">{t("staffReg.contractTypeLabel")}</dt><dd className="font-medium text-ink">{t(`hr.contractType.${contract.contract_type}`)}</dd></div>
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.startDateEc")}</dt><dd className="font-medium text-ink"><EthDate value={contract.starts_on} /></dd></div>
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.startDateGc")}</dt><dd className="font-medium text-ink">{contract.starts_on}</dd></div>
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.endDate")}</dt><dd className="font-medium text-ink">{contract.ends_on ? <EthDate value={contract.ends_on} /> : "—"}</dd></div>
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.probationStatus")}</dt><dd className="font-medium text-ink">{t(`staffProfile.probation.${extra?.probation_status ?? "not_applicable"}`)}</dd></div>
                <div><dt className="text-xs text-ink-faint">{t("staffProfile.noticePeriod")}</dt><dd className="font-medium text-ink">{extra?.notice_period_days ?? "—"}</dd></div>
              </dl>
            ) : (
              <p className="px-4 py-6 text-center text-sm text-ink-faint">{t("staffProfile.noContract")}</p>
            )
          ) : (
            <div className="space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("staffReg.contractTypeLabel")}>
                  <select value={contractType} onChange={(e) => setContractType(e.target.value)}
                    className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                    {CONTRACT_TYPES.map((ct) => <option key={ct} value={ct}>{t(`hr.contractType.${ct}`)}</option>)}
                  </select>
                </Field>
                <Field label={t("staffProfile.probationStatus")}>
                  <select value={probation} onChange={(e) => setProbation(e.target.value)}
                    className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                    {PROBATION_STATUSES.map((p) => <option key={p} value={p}>{t(`staffProfile.probation.${p}`)}</option>)}
                  </select>
                </Field>
                <Field label={t("staffProfile.startDateEc")}>
                  <EthDatePicker value={startsOn} onChange={setStartsOn} />
                </Field>
                <Field label={t("staffProfile.endDate")}>
                  <EthDatePicker value={endsOn} onChange={setEndsOn} />
                </Field>
                <Field label={t("staffProfile.noticePeriod")}>
                  <input type="number" min={0} value={noticeDays} onChange={(e) => setNoticeDays(Number(e.target.value))}
                    className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
                </Field>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => save.mutate()} disabled={save.isPending || !startsOn}>{t("staffProfile.saveContract")}</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>{t("staffProfile.cancel")}</Button>
              </div>
              {save.isError && <p className="text-xs text-danger">{(save.error as Error).message}</p>}
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <div className="space-y-2 rounded-panel bg-navy p-4 text-white">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">{t("staffProfile.workSchedule")}</h2>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between rounded-control border border-white/20 px-3 py-2">
              <span>{t("staffProfile.monFri")}</span><span className="text-white/70">8:00 – 17:00</span>
            </div>
            <div className="flex justify-between rounded-control border border-white/20 px-3 py-2">
              <span>{t("staffProfile.saturday")}</span><span className="text-white/70">{t("staffProfile.offDuty")}</span>
            </div>
            <div className="flex justify-between rounded-control border border-white/20 px-3 py-2">
              <span>{t("staffProfile.sunday")}</span><span className="text-white/70">{t("staffProfile.offDuty")}</span>
            </div>
          </div>
          <p className="text-xs text-white/60">{t("staffProfile.scheduleNote")}</p>
        </div>
      </div>
    </div>
  );
}
