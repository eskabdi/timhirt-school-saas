// M-1 fix: `select("*")` on employees threw "permission denied for column
// tin_number" once the column-level revoke took effect (migration 010),
// because there was no re-exposing view. Now: select an explicit
// non-sensitive column list from `employees`, and — only for roles that can
// legitimately see them — a second query against the `hr_employee_sensitive`
// view (security_invoker, so base-table RLS still governs row visibility).
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { EthDate } from "@/components/EthDate";

const HR_ROLES = ["school_admin", "hr_officer", "accountant"];

export function EmployeeDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile } = useSession();
  const canSeeSensitive = !!profile && HR_ROLES.includes(profile.role);

  const { data } = useQuery({
    queryKey: ["employee", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id, employee_no, full_name, employee_type, hire_date, status, employment_contracts(basic_salary, contract_type, starts_on, status)")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: sensitive } = useQuery({
    queryKey: ["employee-sensitive", id],
    enabled: !!id && canSeeSensitive,
    queryFn: async () => {
      const { data, error } = await supabase.from("hr_employee_sensitive")
        .select("tin_number, pension_no, bank_account").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (!data) return null;
  return (
    <Card className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-ink">{data.full_name}</h1>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-faint">{t("hr.employeeNo")}</dt><dd className="font-medium text-ink">{data.employee_no}</dd></div>
        <div><dt className="text-ink-faint">{t("hr.hired")}</dt><dd className="font-medium text-ink"><EthDate value={data.hire_date} /></dd></div>
        <div><dt className="text-ink-faint">{t("hr.type")}</dt><dd className="font-medium text-ink">{t(`hr.employeeType.${data.employee_type}`)}</dd></div>
        <div><dt className="text-ink-faint">{t("hr.statusLabel")}</dt><dd className="font-medium text-ink">{t(`hr.employeeStatus.${data.status}`)}</dd></div>
      </dl>
      {data.employment_contracts?.[0] && (
        <div className="mt-6 border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">{t("hr.currentContract")}</h2>
          <p className="text-sm text-ink-faint">
            {t(`hr.contractType.${(data.employment_contracts[0] as any).contract_type}`)} · {t("hr.started")} <EthDate value={(data.employment_contracts[0] as any).starts_on} />
          </p>
        </div>
      )}
      {canSeeSensitive && sensitive && (
        <div className="mt-6 border-t border-line pt-4">
          <h2 className="mb-2 text-sm font-semibold text-ink">🔒 {t("hr.restrictedIdentifiers")}</h2>
          <dl className="grid grid-cols-3 gap-4 text-sm">
            <div><dt className="text-ink-faint">{t("hr.tin")}</dt><dd className="font-mono text-ink">{sensitive.tin_number ?? "—"}</dd></div>
            <div><dt className="text-ink-faint">{t("hr.pensionNo")}</dt><dd className="font-mono text-ink">{sensitive.pension_no ?? "—"}</dd></div>
            <div><dt className="text-ink-faint">{t("hr.bankAccount")}</dt><dd className="font-mono text-ink">{sensitive.bank_account ?? "—"}</dd></div>
          </dl>
        </div>
      )}
    </Card>
  );
}
