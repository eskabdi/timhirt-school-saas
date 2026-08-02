// Portal Invitation — standalone page for (re)sending a staff member's
// portal login, reached from the profile once registration itself has
// already offered the inline invite. Email only, same as the registration
// wizard's own invite call: the design's temp password, mandatory 2FA and
// SMS delivery aren't built — no SMS provider is wired and none of it
// exists in auth today, so they're left out rather than shown as switches
// that do nothing. "Expiry" and "bilingual preview" are real to the extent
// the underlying invite-staff/Supabase invite actually supports: a locale
// picker that is genuinely passed through (drives default_locale), and a
// factual note about how long the link stays valid, rather than a
// configurable expiry the Edge Function has no parameter for.
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { inviteAndLink } from "./staffApi";

const PORTAL_ROLES = ["teacher", "registrar", "hr_officer", "accountant"] as const;
type PortalRole = (typeof PORTAL_ROLES)[number];
// Mirrors invite-staff's own HR_OFFICER_ASSIGNABLE_ROLES: an hr_officer
// caller is rejected server-side for any role outside this set.
const HR_OFFICER_ASSIGNABLE_ROLES: readonly PortalRole[] = ["teacher", "registrar"];

// A language's own name is always shown in its own script, not translated
// per the viewer's active locale — same convention as LanguageSwitcher.
const LOCALE_LABELS: Record<"en" | "am" | "om", string> = { en: "English", am: "አማርኛ", om: "Afaan Oromoo" };

// What each built-in role's own route guards actually admit (router.tsx) —
// a factual summary of real access, not a fabricated permissions matrix.
const ROLE_ACCESS: Record<PortalRole, string[]> = {
  teacher: ["nav.myClasses", "nav.myTimetable", "nav.myPayslips", "nav.myLeave", "nav.gradebook"],
  registrar: ["nav.students", "nav.admissions", "nav.idCards"],
  hr_officer: ["nav.employees", "hr.payrollRuns", "nav.leave"],
  accountant: ["hr.payrollRuns", "nav.invoices"],
};

export function PortalInvitationPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile } = useSession();
  const assignableRoles = profile?.role === "hr_officer" ? HR_OFFICER_ASSIGNABLE_ROLES : PORTAL_ROLES;
  const [role, setRole] = useState<PortalRole>("teacher");
  const [locale, setLocale] = useState<"en" | "am" | "om">("en");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: employee } = useQuery({
    queryKey: ["invite-employee", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("id, tenant_id, full_name, employee_no, job_title, institutional_email, personal_email, user_id")
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const email = employee?.institutional_email || employee?.personal_email || "";

  const invite = useMutation({
    mutationFn: async () => {
      if (!employee) throw new Error("not_loaded");
      if (!email) throw new Error(t("invitePortal.noEmailOnFile"));
      await inviteAndLink({
        tenantId: employee.tenant_id, employeeId: employee.id, email, fullName: employee.full_name,
        role, staffNo: employee.employee_no, locale,
      });
    },
    onSuccess: () => { setSent(true); setError(null); },
    onError: (err: Error) => setError(err.message),
  });

  if (!employee) return null;

  const alreadyLinked = !!employee.user_id;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-ink-faint">
        <Link to={`/hr/employees/${employee.id}`} className="hover:underline">{employee.full_name}</Link> › <span className="text-navy">{t("invitePortal.title")}</span>
      </p>
      <div>
        <h1 className="font-display text-xl font-bold text-ink">{t("invitePortal.title")}</h1>
        <p className="text-sm text-ink-faint">{t("invitePortal.subtitle", { name: employee.full_name })}</p>
      </div>

      {alreadyLinked && (
        <Card className="border-ok bg-ok-tint/40">
          <p className="text-sm text-ok">{t("invitePortal.alreadyLinked")}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("invitePortal.accessConfig")} />
            <div className="space-y-4 p-4">
              <Field label={t("staffReg.portalRole")}>
                <select value={role} onChange={(e) => setRole(e.target.value as PortalRole)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {assignableRoles.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </select>
              </Field>
              <Field label={t("invitePortal.locale")}>
                <select value={locale} onChange={(e) => setLocale(e.target.value as typeof locale)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {(["en", "am", "om"] as const).map((l) => <option key={l} value={l}>{LOCALE_LABELS[l]}</option>)}
                </select>
              </Field>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t("invitePortal.permissionsPreview")} />
            <div className="flex flex-wrap gap-1.5 p-4">
              {ROLE_ACCESS[role].map((key) => (
                <span key={key} className="rounded-pill bg-navy-wash px-2.5 py-1 text-xs font-medium text-navy">{t(key)}</span>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t("invitePortal.credentials")} />
            <div className="space-y-2 p-4 text-sm">
              <p className="text-ink">{t("invitePortal.credentialsNote")}</p>
              <p className="text-xs text-ink-faint">{t("invitePortal.expiryNote")}</p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title={t("invitePortal.invitePreview")} />
            <dl className="grid grid-cols-2 gap-4 p-4 text-sm">
              <div><dt className="text-xs text-ink-faint">{t("teachers.fullName")}</dt><dd className="font-medium text-ink">{employee.full_name}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("teachers.email")}</dt><dd className="font-medium text-ink">{email || "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.portalRole")}</dt><dd className="font-medium text-ink">{t(`roles.${role}`)}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("invitePortal.locale")}</dt><dd className="font-medium text-ink">{locale.toUpperCase()}</dd></div>
            </dl>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("hr.employee")} />
            <dl className="space-y-2 p-4 text-sm">
              <div><dt className="text-xs text-ink-faint">{t("hr.employeeNo")}</dt><dd className="font-medium text-ink">{employee.employee_no}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffProfile.jobTitle")}</dt><dd className="font-medium text-ink">{employee.job_title || "—"}</dd></div>
              <div>
                <dt className="text-xs text-ink-faint">{t("hr.statusLabel")}</dt>
                <dd><Badge tone={alreadyLinked ? "ok" : "late"}>{alreadyLinked ? t("staffReg.portalAccessGranted") : t("staffReg.portalNotInvited")}</Badge></dd>
              </div>
            </dl>
          </Panel>

          {!sent ? (
            <Button className="w-full justify-center" onClick={() => invite.mutate()} disabled={invite.isPending || !email}>
              {invite.isPending ? "…" : t("invitePortal.send")}
            </Button>
          ) : (
            <Card className="border-ok bg-ok-tint/40 text-center text-sm text-ok">{t("invitePortal.sent")}</Card>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {!email && <p className="text-xs text-danger">{t("invitePortal.noEmailOnFile")}</p>}
        </div>
      </div>
    </div>
  );
}
