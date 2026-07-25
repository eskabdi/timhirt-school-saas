import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EthDate } from "@/components/EthDate";
import { EthDatePicker } from "@/components/EthDatePicker";
import { onRowDoubleClick } from "@/lib/utils";
import { toIsoDate } from "@/lib/ethiopian-date";

const STATUS_TONE = { active: "ok", on_leave: "late", terminated: "danger" } as const;
const TYPES = ["teacher", "admin_staff", "support"] as const;
type EmpType = (typeof TYPES)[number];

export function EmployeeListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<{ employeeNo: string; fullName: string; type: EmpType; hireDate: Date | null }>({
    employeeNo: "", fullName: "", type: "teacher", hireDate: null,
  });
  const [error, setError] = useState<string | null>(null);

  const { data: employees } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id, employee_no, full_name, employee_type, hire_date, status").order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employees").insert({
        tenant_id: profile!.tenant_id, employee_no: form.employeeNo, full_name: form.fullName,
        employee_type: form.type, hire_date: toIsoDate(form.hireDate!), status: "active",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["employees"] }); setShow(false); setForm({ employeeNo: "", fullName: "", type: "teacher", hireDate: null }); setError(null); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("hr.employees")}</h1>
        <Button onClick={() => setShow(true)}>+ {t("hrPages.addEmployee")}</Button>
      </div>

      {error && <Card className="border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      {!employees?.length ? (
        <Card className="py-12 text-center text-ink-faint">—</Card>
      ) : (
        <Panel>
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
              <tr><th className="px-4 py-2">{t("hr.employeeNo")}</th><th className="px-4 py-2">{t("hr.name")}</th><th className="px-4 py-2">{t("hr.type")}</th><th className="px-4 py-2">{t("hr.hired")}</th><th className="px-4 py-2">{t("hr.statusLabel")}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {employees.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-sidebar" onDoubleClick={onRowDoubleClick(navigate, `/hr/employees/${e.id}`)}>
                  <td className="px-4 py-2"><Link to={`/hr/employees/${e.id}`} className="font-medium text-navy hover:underline">{e.employee_no}</Link></td>
                  <td className="px-4 py-2 text-ink">{e.full_name}</td>
                  <td className="px-4 py-2 text-ink-faint">{t(`hr.employeeType.${e.employee_type}`)}</td>
                  <td className="px-4 py-2 text-ink-faint"><EthDate value={e.hire_date} /></td>
                  <td className="px-4 py-2">
                    <Badge tone={STATUS_TONE[e.status as keyof typeof STATUS_TONE] ?? "neutral"}>{t(`hr.employeeStatus.${e.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Modal open={show} onClose={() => setShow(false)} title={t("hrPages.addEmployee")}>
        <div className="space-y-3">
          <Field label={t("hrPages.employeeNo")}><Input value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value.toUpperCase() })} placeholder="EMP-001" /></Field>
          <Field label={t("hrPages.fullName")}><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
          <Field label={t("hrPages.type")}>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EmpType })} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              {TYPES.map((ty) => <option key={ty} value={ty}>{t(`hr.employeeType.${ty}`)}</option>)}
            </select>
          </Field>
          <Field label={t("hrPages.hireDate")}><EthDatePicker value={form.hireDate} onChange={(d) => setForm({ ...form, hireDate: d })} /></Field>
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={() => setShow(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => create.mutate()} disabled={!form.employeeNo || !form.fullName || !form.hireDate || create.isPending}>{t("hrPages.create")}</Button>
        </div>
      </Modal>
    </div>
  );
}
