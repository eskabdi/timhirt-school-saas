// Staff Profile — replaces the single-card EmployeeDetailPage.
//
// Same shape as StudentDetailPage: this page owns the header and the core
// employees row, each tab owns its own query against the tables it actually
// reads. Sensitive identifiers (tin_number, pension_no, bank_account) go
// through hr_employee_sensitive (security_invoker view, base-table RLS still
// governs row visibility) exactly as EmployeeDetailPage already did — that
// gate is reused here, not reinvented.
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { OverviewTab } from "./tabs/OverviewTab";
import { ProfessionalTab } from "./tabs/ProfessionalTab";
import { EmploymentTab } from "./tabs/EmploymentTab";
import { PayrollTab } from "./tabs/PayrollTab";
import { DocumentsTab } from "./tabs/DocumentsTab";

const TABS = ["overview", "professional", "employment", "payroll", "documents"] as const;
type Tab = (typeof TABS)[number];

export function StaffProfilePage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const canSeeSensitive = !!profile && ["school_admin", "hr_officer", "accountant"].includes(profile.role);

  const { data: employee } = useQuery({
    queryKey: ["staff-profile", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select(`
          id, tenant_id, employee_no, full_name, job_title, department, campus, photo_path, office_location,
          employee_type, hire_date, status, personal_email, institutional_email, phone, work_phone,
          user_id, reporting_manager_id, manager:employees!reporting_manager_id(full_name)
        `)
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: photoUrl } = useQuery({
    queryKey: ["staff-photo-url", employee?.photo_path],
    enabled: !!employee?.photo_path,
    queryFn: async () => {
      const { data } = await supabase.storage.from("avatars")
        .createSignedUrl(employee!.photo_path!, 3600);
      return data?.signedUrl ?? null;
    },
  });

  if (!employee) return null;

  const tabLabels: Record<Tab, string> = {
    overview: t("staffProfile.tabOverview"), professional: t("staffProfile.tabProfessional"),
    employment: t("staffProfile.tabEmployment"), payroll: t("staffProfile.tabPayroll"),
    documents: t("staffProfile.tabDocuments"),
  };

  return (
    <div className="space-y-4">
      <Card className="bg-navy-wash/40">
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-line bg-card">
            {photoUrl && <img src={photoUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold text-ink">{employee.full_name}</h1>
              <Badge tone="ok">{t("staffProfile.moeVerified")}</Badge>
            </div>
            <p className="text-sm text-ink-soft">{employee.job_title || t(`hr.employeeType.${employee.employee_type}`)}</p>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-faint">
              <span className="rounded-pill border border-line bg-card px-2 py-0.5">
                {t("staffProfile.employeeIdLabel")}: {employee.employee_no}
              </span>
              <span className="rounded-pill border border-line bg-card px-2 py-0.5">
                {t("staffProfile.joinedDateEc")}: <EthDate value={employee.hire_date} />
              </span>
              {employee.campus && (
                <span className="rounded-pill border border-line bg-card px-2 py-0.5">{employee.campus}</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost">{t("staffProfile.message")}</Button>
            <Button variant="ghost">{t("staffProfile.printTranscript")}</Button>
            <Button>{t("staffProfile.editProfile")}</Button>
          </div>
        </div>
      </Card>

      <div className="flex gap-6 border-b border-line">
        {TABS.map((tb) => (
          <button key={tb} type="button" onClick={() => setTab(tb)}
            className={`border-b-2 pb-2 text-sm font-semibold transition-colors ${
              tab === tb ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink"
            }`}>
            {tabLabels[tb]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab employeeId={employee.id} tenantId={employee.tenant_id} />}
      {tab === "professional" && (
        <ProfessionalTab employeeId={employee.id} employee={employee} canSeeSensitive={canSeeSensitive} />
      )}
      {tab === "employment" && <EmploymentTab employeeId={employee.id} employee={employee} />}
      {tab === "payroll" && (
        <PayrollTab employeeId={employee.id} tenantId={employee.tenant_id} canSeeSensitive={canSeeSensitive} />
      )}
      {tab === "documents" && <DocumentsTab employeeId={employee.id} tenantId={employee.tenant_id} />}

      <p className="text-xs text-ink-faint">
        <Link to="/hr/employees" className="hover:underline">← {t("hr.employees")}</Link>
      </p>
    </div>
  );
}
