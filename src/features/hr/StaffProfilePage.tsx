// Staff Profile — replaces the single-card EmployeeDetailPage.
//
// Same shape as StudentDetailPage: this page owns the header and the core
// employees row, each tab owns its own query against the tables it actually
// reads. Sensitive identifiers (tin_number, pension_no, bank_account) go
// through hr_employee_sensitive (security_invoker view, base-table RLS still
// governs row visibility) exactly as EmployeeDetailPage already did — that
// gate is reused here, not reinvented.
import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
import { EditProfileModal } from "./EditProfileModal";
import { MessageStaffModal } from "./MessageStaffModal";
import { buildStaffProfilePdf } from "./staff-profile-pdf";
import { formatEth } from "@/lib/ethiopian-date";

const TABS = ["overview", "professional", "employment", "payroll", "documents"] as const;
type Tab = (typeof TABS)[number];

export function StaffProfilePage() {
  const { t, i18n } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [showEdit, setShowEdit] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const canSeeSensitive = !!profile && ["school_admin", "hr_officer", "accountant"].includes(profile.role);

  const { data: employee, isLoading, error } = useQuery({
    queryKey: ["staff-profile", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select(`
          id, tenant_id, employee_no, full_name, job_title, department, campus, photo_path, office_location,
          employee_type, hire_date, status, personal_email, institutional_email, phone, work_phone,
          user_id, reporting_manager_id, manager:employees!reporting_manager_id(full_name),
          first_name, first_name_am, father_name, father_name_am, last_name, last_name_am,
          gender, date_of_birth, nationality, national_id,
          region, zone, woreda, city, kebele, house_number,
          highest_qualification, major, institution_name, graduation_year_ec, languages,
          moe_verified
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

  // School name for the PDF letterhead -- same branding record the ID card
  // and academic transcript renderers read, so all three stay consistent.
  const { data: brand } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });

  const printProfile = async () => {
    if (!employee) return;
    setPrintError(null);
    setPrintBusy(true);
    try {
      const branding = brand?.settings?.branding as { nameEn?: string; nameAm?: string; nameOm?: string; logoPath?: string | null } | undefined;
      const lang = i18n.resolvedLanguage;
      const schoolName =
        (lang === "am" ? branding?.nameAm : lang === "om" ? branding?.nameOm : branding?.nameEn) ||
        branding?.nameEn || t("app.name");
      const fmt = (iso: string | null) => iso
        ? formatEth(new Date(iso + "T00:00:00Z"), { monthNames: tc("months", { returnObjects: true }) as string[], eraSuffix: tc("eraSuffix") })
        : "-";
      const photoPngBytes = photoUrl ? new Uint8Array(await (await fetch(photoUrl)).arrayBuffer()) : null;
      const logoUrl = branding?.logoPath ? supabase.storage.from("branding").getPublicUrl(branding.logoPath).data.publicUrl : null;
      const logoImageBytes = logoUrl ? new Uint8Array(await (await fetch(logoUrl)).arrayBuffer()) : null;
      const blob = await buildStaffProfilePdf({
        schoolName,
        photoPngBytes,
        logoImageBytes,
        fullName: employee.full_name,
        employeeNo: employee.employee_no,
        jobTitle: employee.job_title ?? "",
        department: employee.department ?? "",
        status: t(`hr.employeeStatus.${employee.status}`),
        hireDateEc: fmt(employee.hire_date),
        issuedOn: fmt(new Date().toISOString().slice(0, 10)),
        personal: [
          [t("staffReg.gender"), employee.gender ? t(`students.${employee.gender}`) : "-"],
          [t("staffReg.dob"), fmt(employee.date_of_birth)],
          [t("staffReg.nationality"), employee.nationality ?? "-"],
          [t("staffReg.nationalId"), employee.national_id ?? "-"],
          [t("staffReg.phone"), employee.phone ?? "-"],
          [t("staffReg.personalEmail"), employee.personal_email ?? "-"],
        ],
        address: [
          [t("staffReg.region"), employee.region ?? "-"], [t("staffReg.zone"), employee.zone ?? "-"],
          [t("staffReg.woreda"), employee.woreda ?? "-"], [t("staffReg.city"), employee.city ?? "-"],
          [t("staffReg.kebele"), employee.kebele ?? "-"], [t("staffReg.houseNumber"), employee.house_number ?? "-"],
        ],
        professional: [
          [t("staffReg.highestQualification"), employee.highest_qualification ? t(`staffReg.qualification.${employee.highest_qualification}`) : "-"],
          [t("staffReg.yearOfGraduation"), employee.graduation_year_ec ? String(employee.graduation_year_ec) : "-"],
          [t("staffReg.majorSpecialization"), employee.major ?? "-"],
          [t("staffReg.institutionName"), employee.institution_name ?? "-"],
          [t("staffReg.languageProficiency"), ((employee.languages ?? []) as string[]).map((l) => t(`staffReg.language.${l}`)).join(", ") || "-"],
        ],
        employment: [
          [t("staffProfile.officeLocation"), employee.office_location ?? "-"],
          [t("staffProfile.campus"), employee.campus ?? "-"],
          [t("staffReg.institutionalEmail"), employee.institutional_email ?? "-"],
          [t("staffReg.workPhone"), employee.work_phone ?? "-"],
          [t("staffProfile.lineManager"), employee.manager?.[0]?.full_name ?? "-"],
          [t("hr.type"), t(`hr.employeeType.${employee.employee_type}`)],
        ],
        labels: {
          title: t("staffProfile.profileDocTitle"), employeeNo: t("hr.employeeNo"),
          jobTitle: t("staffProfile.jobTitle"), department: t("staffReg.department"),
          status: t("students.status"), hireDate: t("staffProfile.joinedDateEc"),
          personalSection: t("staffProfile.groupIdentity"), addressSection: t("staffProfile.groupAddress"),
          professionalSection: t("staffProfile.groupProfessional"), employmentSection: t("staffProfile.employmentDetails"),
          issued: t("idCards.issued"), photo: t("staffProfile.photo"),
        },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `staff-profile-${employee.employee_no.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPrintError(e instanceof Error ? e.message : t("staffProfile.printFailed"));
    } finally {
      setPrintBusy(false);
    }
  };

  if (isLoading) return <p className="text-ink-faint">…</p>;
  if (error) {
    return (
      <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">
        {error instanceof Error ? error.message : t("staffProfile.printFailed")}
      </Card>
    );
  }
  if (!employee) return null;

  const tabLabels: Record<Tab, string> = {
    overview: t("staffProfile.tabOverview"), professional: t("staffProfile.tabProfessional"),
    employment: t("staffProfile.tabEmployment"), payroll: t("staffProfile.tabPayroll"),
    documents: t("staffProfile.tabDocuments"),
  };

  const breadcrumbMiddle = employee.department || employee.job_title || t(`hr.employeeType.${employee.employee_type}`);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-faint">
        <Link to="/hr/employees" className="hover:underline">{t("hr.employees")}</Link> › {breadcrumbMiddle} › <span className="text-navy">{t("students.profile.breadcrumb")}</span>
      </p>
      {printError && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{printError}</Card>}
      <Card className="bg-navy-wash/40">
        <div className="flex flex-wrap items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-line bg-card">
            {photoUrl && <img src={photoUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold text-ink">{employee.full_name}</h1>
              {employee.moe_verified && <Badge tone="ok">{t("staffProfile.moeVerified")}</Badge>}
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
            {!employee.user_id && (
              <Button variant="ghost" onClick={() => navigate(`/hr/employees/${employee.id}/invite`)}>
                {t("staffReg.sendInvitationNow")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => navigate(`/hr/employees/${employee.id}/id-card`)}>
              {t("staffIdCard.title")}
            </Button>
            <Button variant="ghost" onClick={() => setShowMessage(true)} disabled={!employee.user_id}
              title={!employee.user_id ? t("staffProfile.messageNoAccount") : undefined}>
              {t("staffProfile.message")}
            </Button>
            <Button variant="ghost" onClick={printProfile} disabled={printBusy}>
              {printBusy ? t("academicRecord.preparing") : t("staffProfile.printProfile")}
            </Button>
            <Button onClick={() => setShowEdit(true)}>{t("staffProfile.editProfile")}</Button>
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

      <EditProfileModal employee={employee} open={showEdit} onClose={() => setShowEdit(false)} />
      {employee.user_id && (
        <MessageStaffModal
          open={showMessage} onClose={() => setShowMessage(false)}
          recipientUserId={employee.user_id} recipientName={employee.full_name}
        />
      )}
    </div>
  );
}
