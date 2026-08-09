// Professional tab — academic background, subject specializations, licenses,
// document verification snapshot, contact info, and role/permissions. The
// design's Avg Student Performance and Evaluation Score metrics have no cheap
// real backing (they'd need a gradebook-wide aggregate this session doesn't
// have time to build correctly) and are left out rather than faked; Years of
// Service and Attendance Rate are both real aggregates so they stay.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { todayEthiopian, toEthiopian } from "@/lib/ethiopian-date";

// Mirrors STAFF_DOC_TYPES' keys in staffApi.ts — that's where doc_type values
// are minted, this just maps them to the labels staffReg already defines.
const DOC_TYPE_LABEL_KEY: Record<string, string> = {
  cv_resume: "staffReg.docCvResume",
  id_passport_copy: "staffReg.docIdPassportCopy",
  degree_certificate: "staffReg.docDegreeCertificate",
  professional_license: "staffReg.docProfessionalLicense",
};
// Mirrors DocumentsTab's HR_WRITE_ROLES: who may attest MoE verification.
const HR_WRITE_ROLES = ["school_admin", "hr_officer"];

interface StaffEmployee {
  id: string; user_id: string | null; phone: string | null; work_phone: string | null;
  personal_email: string | null; institutional_email: string | null; hire_date: string;
}

export function ProfessionalTab({ employeeId, employee, canSeeSensitive }: {
  employeeId: string; employee: StaffEmployee; canSeeSensitive: boolean;
}) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const canWrite = !!profile && HR_WRITE_ROLES.includes(profile.role);
  const ecYear = todayEthiopian().year;

  const { data: academic } = useQuery({
    queryKey: ["staff-academic", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees")
        .select("highest_qualification, major, institution_name, graduation_year_ec, languages, moe_verified")
        .eq("id", employeeId).single();
      if (error) throw error;
      return data as {
        highest_qualification: string | null; major: string | null; institution_name: string | null;
        graduation_year_ec: number | null; languages: string[] | null; moe_verified: boolean;
      };
    },
  });

  // MoE verification is an admin attestation, not a derived fact, so it stays
  // off until school_admin/hr_officer deliberately flips it here -- same
  // verified/verified_by/verified_at shape as employee_documents.verified.
  const toggleMoeVerified = useMutation({
    mutationFn: async () => {
      const nowVerified = !academic?.moe_verified;
      const { error } = await supabase.from("employees").update({
        moe_verified: nowVerified,
        moe_verified_by: nowVerified ? (await supabase.auth.getUser()).data.user?.id : null,
        moe_verified_at: nowVerified ? new Date().toISOString() : null,
      }).eq("id", employeeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-academic", employeeId] });
      qc.invalidateQueries({ queryKey: ["staff-profile", employeeId] });
    },
  });

  const { data: subjects } = useQuery({
    queryKey: ["staff-subjects", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employee_subjects")
        .select("id, subject:subjects(name_i18n, code)").eq("employee_id", employeeId);
      return (data ?? []) as unknown as { id: string; subject: { name_i18n: Record<string, string>; code: string } | null }[];
    },
  });

  const { data: qualifications } = useQuery({
    queryKey: ["staff-qualifications", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employee_qualifications")
        .select("id, name, issuer, issued_on, expires_on").eq("employee_id", employeeId).order("issued_on", { ascending: false });
      return data ?? [];
    },
  });

  const { data: documents } = useQuery({
    queryKey: ["staff-doc-verification", employeeId],
    queryFn: async () => {
      const { data } = await supabase.from("employee_documents")
        .select("id, doc_type, verified").eq("employee_id", employeeId).order("uploaded_at", { ascending: false }).limit(6);
      return data ?? [];
    },
  });

  const { data: attendanceRate } = useQuery({
    queryKey: ["staff-attendance-rate", employeeId, ecYear],
    queryFn: async () => {
      const { data } = await supabase.from("staff_attendance")
        .select("status").eq("employee_id", employeeId)
        .gte("att_date", `${ecYear - 8}-09-01`); // coarse EC-year floor, good enough for a rolling rate
      if (!data?.length) return null;
      const counted = data.filter((r) => r.status === "present" || r.status === "absent" || r.status === "sick");
      if (!counted.length) return null;
      const present = counted.filter((r) => r.status === "present").length;
      return Math.round((present / counted.length) * 100);
    },
  });

  const { data: accountRole } = useQuery({
    queryKey: ["staff-account-role", employee.user_id],
    enabled: !!employee.user_id,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("role").eq("id", employee.user_id!).maybeSingle();
      return data?.role ?? null;
    },
  });

  const yearsOfService = Math.max(0, ecYear - toEthiopian(new Date(employee.hire_date)).year);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-panel border border-line bg-card p-4 text-center">
          <p className="text-xs text-ink-faint">{t("staffProfile.yearOfService")}</p>
          <p className="font-display text-2xl font-bold text-ink">{yearsOfService}</p>
        </div>
        <div className="rounded-panel border border-line bg-card p-4 text-center">
          <p className="text-xs text-ink-faint">{t("staffProfile.attendanceRate")}</p>
          <p className="font-display text-2xl font-bold text-ink">{attendanceRate != null ? `${attendanceRate}%` : "—"}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <PanelHeader title={t("staffReg.academicBackground")} />
            <dl className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-ink-faint">{t("staffReg.highestQualification")}</dt><dd className="font-medium text-ink">{academic?.highest_qualification ? t(`staffReg.qualification.${academic.highest_qualification}`) : "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.majorSpecialization")}</dt><dd className="font-medium text-ink">{academic?.major || "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.institutionName")}</dt><dd className="font-medium text-ink">{academic?.institution_name || "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.yearOfGraduation")}</dt><dd className="font-medium text-ink">{academic?.graduation_year_ec || "—"}</dd></div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-ink-faint">{t("staffProfile.subjectSpecializations")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {!subjects?.length ? <span className="text-sm text-ink-faint">{t("staffProfile.noSubjects")}</span> : subjects.map((s) => (
                    <span key={s.id} className="rounded-pill bg-navy-wash px-2.5 py-1 text-xs font-medium text-navy">
                      {(s.subject?.name_i18n as Record<string, string>)?.en ?? s.subject?.code}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-ink-faint">{t("staffReg.languageProficiency")}</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {!academic?.languages?.length ? <span className="text-sm text-ink-faint">—</span> : academic.languages.map((l) => (
                    <span key={l} className="rounded-pill border border-line px-2.5 py-1 text-xs font-medium text-ink">{t(`staffReg.language.${l}`, l)}</span>
                  ))}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title={t("staffProfile.teachingLicenses")} action={
              canWrite ? (
                <button type="button" onClick={() => toggleMoeVerified.mutate()} disabled={toggleMoeVerified.isPending}
                  className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${academic?.moe_verified ? "bg-ok-tint text-ok" : "bg-late-tint text-late"}`}>
                  {academic?.moe_verified ? t("staffProfile.moeVerified") : t("staffProfile.markMoeVerified")}
                </button>
              ) : (
                academic?.moe_verified ? <Badge tone="ok">{t("staffProfile.moeVerified")}</Badge> : null
              )
            } />
            <ul className="divide-y divide-line">
              {!qualifications?.length ? (
                <li className="px-4 py-6 text-center text-sm text-ink-faint">{t("staffProfile.noCertifications")}</li>
              ) : qualifications.map((q) => (
                <li key={q.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{q.name}</p>
                    <p className="text-xs text-ink-faint">{q.issuer || "—"}</p>
                  </div>
                  <span className="text-xs text-ink-faint">{q.expires_on ?? ""}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel>
            <PanelHeader title={t("staffProfile.documentVerification")} action={
              <Link to="#documents" className="text-xs font-semibold text-navy hover:underline">{t("staffProfile.tabDocuments")}</Link>
            } />
            <ul className="divide-y divide-line">
              {!documents?.length ? (
                <li className="px-4 py-6 text-center text-sm text-ink-faint">{t("staffProfile.noDocuments")}</li>
              ) : documents.map((d) => {
                const labelKey = DOC_TYPE_LABEL_KEY[d.doc_type];
                return (
                  <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="text-ink">{labelKey ? t(labelKey) : d.doc_type}</span>
                    <Badge tone={d.verified ? "ok" : "late"}>{d.verified ? "✓" : "…"}</Badge>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title={t("staffProfile.contactInformation")} />
            <dl className="space-y-3 p-4 text-sm">
              <div><dt className="text-xs text-ink-faint">{t("staffReg.institutionalEmail")}</dt><dd className="font-medium text-ink">{employee.institutional_email || "—"}</dd></div>
              {canSeeSensitive && <div><dt className="text-xs text-ink-faint">{t("staffReg.personalEmail")}</dt><dd className="font-medium text-ink">{employee.personal_email || "—"}</dd></div>}
              <div><dt className="text-xs text-ink-faint">{t("staffReg.workPhone")}</dt><dd className="font-medium text-ink">{employee.work_phone || "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.phone")}</dt><dd className="font-medium text-ink">{employee.phone || "—"}</dd></div>
            </dl>
          </Panel>

          <Panel>
            <PanelHeader title={t("staffProfile.rolePermissions")} />
            <div className="space-y-2 p-4 text-sm">
              {employee.user_id ? (
                <>
                  <Badge tone="navy">{accountRole ? t(`roles.${accountRole}`) : "—"}</Badge>
                  <p className="text-xs text-ink-faint">
                    <Link to="/settings/roles" className="hover:underline">{t("staffProfile.rolePermissions")} →</Link>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-ink-faint">{t("staffReg.portalNotInvited")}</p>
                  <p className="text-xs">
                    <Link to={`/hr/employees/${employeeId}/invite`} className="text-navy hover:underline">{t("staffReg.sendInvitationNow")} →</Link>
                  </p>
                </>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
