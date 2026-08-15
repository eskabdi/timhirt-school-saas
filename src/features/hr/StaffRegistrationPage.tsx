// Staff Registration — 4-step wizard, built to the supplied designs.
//
// Each step's "Continue" persists to the real employees row rather than
// holding everything in memory until a final submit: "Save as Draft" only
// makes sense if there is already something in the database to save, and
// step 4's document upload needs an employee_id to attach files to. The row
// is created (status: 'draft') the first time step 1 validates, and every
// later step updates that same row.
//
// employees.hire_date and employees.employee_type are NOT NULL but are not
// collected until step 3 — the draft row gets placeholder values (today,
// 'teacher') on creation and step 3 overwrites both with what the registrar
// actually enters. A 'draft' status row is not shown as a real employee
// anywhere that matters (payroll, headcounts), so the placeholder is never
// mistaken for a real hire date.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/ui/Toggle";
import { Stepper } from "@/components/ui/Stepper";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthDate } from "@/components/EthDate";
import { toIsoDate } from "@/lib/ethiopian-date";
import { tField } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GRADE_CYCLES, gradeCycleI18nKey } from "@/lib/gradeCycles";
import {
  STAFF_DOC_TYPES, STAFF_PHOTO_MIME_TYPES, callInviteStaff, inviteAndLink,
  replaceQualificationsFromText, replaceTeachingSubjects, uploadStaffDocument,
  uploadStaffPhoto, upsertEmergencyContact, type StaffDocType,
} from "./staffApi";

const QUALIFICATIONS = ["below_grade_12", "high_school", "certificate", "diploma", "bachelor", "masters", "phd", "other"] as const;
const LANGUAGES = ["amharic", "english", "oromo", "tigrinya", "somali", "arabic", "french"] as const;
const EMPLOYEE_TYPES = ["teacher", "admin_staff", "support"] as const;
const CONTRACT_TYPES = ["permanent", "contract", "part_time"] as const;
const PORTAL_ROLES = ["teacher", "registrar", "hr_officer", "accountant", "librarian"] as const;
type PortalRole = (typeof PORTAL_ROLES)[number];
// Mirrors invite-staff's own HR_OFFICER_ASSIGNABLE_ROLES: an hr_officer caller
// is rejected server-side for any role outside this set, so offering the rest
// here would just be a dead end after "Complete Registration."
const HR_OFFICER_ASSIGNABLE_ROLES: readonly PortalRole[] = ["teacher", "registrar"];

const step1Schema = z.object({
  first_name: z.string().trim().min(1, "required"),
  last_name: z.string().trim().min(1, "required"),
  gender: z.enum(["male", "female", "other"], { errorMap: () => ({ message: "required" }) }),
  dob: z.date({ errorMap: () => ({ message: "required" }) }),
});

const step3Schema = z.object({
  employee_type: z.enum(EMPLOYEE_TYPES),
  hire_date: z.date({ errorMap: () => ({ message: "required" }) }),
});

interface EmergencyContactState {
  full_name: string; relationship: string; phone: string; email: string;
  region: string; zone: string; woreda: string; city: string; kebele: string; house_number: string;
}
const EMPTY_EC: EmergencyContactState = {
  full_name: "", relationship: "", phone: "", email: "",
  region: "", zone: "", woreda: "", city: "", kebele: "", house_number: "",
};

/** Section wrapper matching the card style every step uses. */
function SectionCard({ title, icon, children, className }: {
  title: string; icon?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <Card className={cn("space-y-4", className)}>
      <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink">
        {icon && <span aria-hidden="true">{icon}</span>}
        {title}
      </h2>
      {children}
    </Card>
  );
}

function TwoScript({ label, en, am, onEn, onAm, error }: {
  label: string; en: string; am: string;
  onEn: (v: string) => void; onAm: (v: string) => void; error?: string;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} error={error}>
      <div className="grid grid-cols-2 gap-2">
        <Input value={en} onChange={(e) => onEn(e.target.value)} placeholder={t("staffReg.englishPh")} />
        <Input value={am} onChange={(e) => onAm(e.target.value)} placeholder={t("staffReg.amharicPh")} />
      </div>
    </Field>
  );
}

export function StaffRegistrationPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { profile } = useSession();
  const qc = useQueryClient();
  const tenantId = profile!.tenant_id!;
  const locale = (i18n.resolvedLanguage ?? "en") as "en" | "am" | "om";

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeNo, setEmployeeNo] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ---------- Step 1: Personal Info ------------------------------------------
  const [s1, setS1] = useState({
    first_name: "", first_name_am: "", father_name: "", father_name_am: "",
    last_name: "", last_name_am: "", gender: "", dob: null as Date | null,
    nationality: "Ethiopian", national_id: "", phone: "", personal_email: "",
    region: "", zone: "", woreda: "", city: "", kebele: "", house_number: "",
  });
  const [s1Errors, setS1Errors] = useState<Record<string, string>>({});
  const [ec, setEc] = useState<EmergencyContactState>(EMPTY_EC);

  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // ---------- Step 2: Professional --------------------------------------------
  const [s2, setS2] = useState({
    highest_qualification: "", major: "", institution_name: "", graduation_year_ec: "",
    certificates_text: "",
  });
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  // Collected here regardless of the eventual role -- employee_type isn't
  // chosen until Step 3, same as the subject-specialization picker just
  // above. Only actually applied if this person ends up invited as a
  // teacher (teachers.teaching_cycle_key, 20260819000001); harmless no-op
  // state otherwise.
  const [teachingCycleKey, setTeachingCycleKey] = useState("");

  const { data: subjects } = useQuery({
    queryKey: ["hr-subjects", tenantId],
    queryFn: async () => (await supabase.from("subjects").select("id, name_i18n, code").order("code")).data ?? [],
  });

  // ---------- Step 3: Employment -----------------------------------------------
  const [s3, setS3] = useState({
    job_title: "", department: "", campus: "", office_location: "",
    employee_type: "teacher" as (typeof EMPLOYEE_TYPES)[number],
    contract_type: "permanent" as (typeof CONTRACT_TYPES)[number],
    hire_date: null as Date | null,
    institutional_email: "", work_phone: "", reporting_manager_id: "",
    contract_duration_months: "",
  });
  const [s3Errors, setS3Errors] = useState<Record<string, string>>({});
  const [inviteToPortal, setInviteToPortal] = useState(true);
  const [portalRole, setPortalRole] = useState<PortalRole>("teacher");

  const { data: managers } = useQuery({
    queryKey: ["hr-managers", tenantId],
    queryFn: async () => (await supabase.from("employees")
      .select("id, full_name").neq("status", "draft").order("full_name")).data ?? [],
  });

  // ---------- Step 4: Documents -------------------------------------------------
  const [docs, setDocs] = useState<Record<StaffDocType, { path: string | null; busy: boolean; error: string | null }>>(
    () => Object.fromEntries(STAFF_DOC_TYPES.map((d) => [d.key, { path: null, busy: false, error: null }])) as never,
  );

  // ---------- Success ------------------------------------------------------------
  const [invitedUserId, setInvitedUserId] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const fullName = () => [s1.first_name, s1.father_name, s1.last_name].filter(Boolean).join(" ").trim();

  // ---------- Persistence -------------------------------------------------------
  /** Creates the draft row on first call, updates it on every later one. */
  const persistEmployee = async (patch: Record<string, unknown>): Promise<string> => {
    if (employeeId) {
      const { error } = await supabase.from("employees").update(patch).eq("id", employeeId);
      if (error) throw error;
      return employeeId;
    }
    const { data, error } = await supabase.from("employees").insert({
      tenant_id: tenantId,
      status: "draft",
      employee_type: "teacher", // placeholder; step 3 sets the real value
      hire_date: toIsoDate(new Date()), // placeholder; step 3 sets the real value
      ...patch,
    }).select("id, employee_no").single();
    if (error) throw error;
    setEmployeeId(data.id);
    setEmployeeNo(data.employee_no);
    return data.id;
  };

  const saveStep1 = useMutation({
    mutationFn: async () => {
      const parsed = step1Schema.safeParse({ ...s1, dob: s1.dob });
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
        setS1Errors(errs);
        throw new Error("validation");
      }
      setS1Errors({});
      const id = await persistEmployee({
        first_name: s1.first_name || null, first_name_am: s1.first_name_am || null,
        father_name: s1.father_name || null, father_name_am: s1.father_name_am || null,
        last_name: s1.last_name || null, last_name_am: s1.last_name_am || null,
        full_name: fullName(),
        gender: s1.gender, date_of_birth: toIsoDate(s1.dob!),
        nationality: s1.nationality || null, national_id: s1.national_id || null,
        phone: s1.phone || null, personal_email: s1.personal_email || null,
        region: s1.region || null, zone: s1.zone || null, woreda: s1.woreda || null,
        city: s1.city || null, kebele: s1.kebele || null, house_number: s1.house_number || null,
      });
      if (photo && !photoPath) {
        try {
          const path = await uploadStaffPhoto(tenantId, id, photo);
          setPhotoPath(path);
        } catch (e) {
          setPhotoError(e instanceof Error && e.message === "photo_too_large"
            ? t("students.photo.tooLarge") : t("students.photo.failed"));
        }
      }
      await upsertEmergencyContact(tenantId, id, {
        full_name: ec.full_name, relationship: ec.relationship || undefined,
        phone: ec.phone || undefined, email: ec.email || undefined,
        region: ec.region || undefined, zone: ec.zone || undefined, woreda: ec.woreda || undefined,
        city: ec.city || undefined, kebele: ec.kebele || undefined, house_number: ec.house_number || undefined,
      });
    },
    onSuccess: () => setStep(2),
    onError: (e) => { if (e instanceof Error && e.message !== "validation") setSaveError(t("staffReg.saveFailed")); },
  });

  const saveStep2 = useMutation({
    mutationFn: async () => {
      const id = await persistEmployee({
        highest_qualification: s2.highest_qualification || null,
        major: s2.major || null, institution_name: s2.institution_name || null,
        graduation_year_ec: s2.graduation_year_ec ? Number(s2.graduation_year_ec) : null,
        languages: languages.length ? languages : null,
      });
      await replaceQualificationsFromText(tenantId, id, s2.certificates_text);
      await replaceTeachingSubjects(tenantId, id, subjectIds);
    },
    onSuccess: () => setStep(3),
    onError: () => setSaveError(t("staffReg.saveFailed")),
  });

  const saveStep3 = useMutation({
    mutationFn: async () => {
      const parsed = step3Schema.safeParse({ employee_type: s3.employee_type, hire_date: s3.hire_date });
      if (!parsed.success) {
        setS3Errors({ hire_date: "required" });
        throw new Error("validation");
      }
      setS3Errors({});
      const id = await persistEmployee({
        job_title: s3.job_title || null, department: s3.department || null,
        campus: s3.campus || null, office_location: s3.office_location || null,
        institutional_email: s3.institutional_email || null, work_phone: s3.work_phone || null,
        reporting_manager_id: s3.reporting_manager_id || null,
        employee_type: s3.employee_type, hire_date: toIsoDate(s3.hire_date!),
        probation_status: "not_applicable",
      });

      // employment_contracts.basic_salary is NOT NULL, but salary is not
      // collected until the Payroll tab (profile, next commit). 0 is an
      // explicit "not yet set" marker HR corrects there — not a fabricated
      // figure, and the column has no NULL to fall back to.
      const endsOn = s3.contract_duration_months
        ? toIsoDate(new Date(s3.hire_date!.getTime() + Number(s3.contract_duration_months) * 30 * 86_400_000))
        : null;
      const { data: existing } = await supabase.from("employment_contracts")
        .select("id").eq("employee_id", id).order("starts_on", { ascending: false }).limit(1).maybeSingle();
      const contractPatch = {
        tenant_id: tenantId, employee_id: id, contract_type: s3.contract_type,
        starts_on: toIsoDate(s3.hire_date!), ends_on: endsOn, status: "active",
      };
      if (existing) {
        await supabase.from("employment_contracts").update(contractPatch).eq("id", existing.id);
      } else {
        await supabase.from("employment_contracts").insert({ ...contractPatch, basic_salary: 0 });
      }
    },
    onSuccess: () => setStep(4),
    onError: (e) => { if (e instanceof Error && e.message !== "validation") setSaveError(t("staffReg.saveFailed")); },
  });

  const uploadDoc = useMutation({
    mutationFn: async ({ docType, file }: { docType: StaffDocType; file: File }) => {
      setDocs((d) => ({ ...d, [docType]: { ...d[docType]!, busy: true, error: null } }));
      const path = await uploadStaffDocument(tenantId, employeeId!, docType, file);
      return { docType, path };
    },
    onSuccess: ({ docType, path }) => setDocs((d) => ({ ...d, [docType]: { path, busy: false, error: null } })),
    onError: (_e, { docType }) => setDocs((d) => ({
      ...d, [docType]: { ...d[docType]!, busy: false, error: t("staffReg.saveFailed") },
    })),
  });

  const complete = useMutation({
    mutationFn: async () => {
      await supabase.from("employees").update({ status: "active" }).eq("id", employeeId!);
      if (inviteToPortal) {
        const email = s3.institutional_email || s1.personal_email;
        if (!email) {
          setInviteNotice(t("staffReg.inviteFailedNotice"));
        } else {
          try {
            const uid = await inviteAndLink({
              tenantId, employeeId: employeeId!, email, fullName: fullName() || employeeNo!,
              role: portalRole, staffNo: employeeNo!, locale, teachingCycleKey,
            });
            setInvitedUserId(uid);
          } catch {
            setInviteNotice(t("staffReg.inviteFailedNotice"));
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      setStep(5);
    },
  });

  // ---------- Step 5: Success ---------------------------------------------------
  if (step === 5) {
    const docsDone = Object.values(docs).filter((d) => d.path).length;
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-col items-center gap-2 pt-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ok-tint text-ok" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-8 w-8">
              <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="font-display text-xl font-bold text-navy">{t("staffReg.successHeading")}</h1>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Panel className="p-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-sidebar">
                {photoPreview && <img src={photoPreview} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0">
                <Badge tone="ok" className="mb-1">{t("staffReg.activeRegistration")}</Badge>
                <p className="truncate font-display text-base font-bold text-ink">{fullName()}</p>
                <p className="truncate text-sm text-ink-faint">{s3.job_title}</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
              <div><dt className="text-xs text-ink-faint">{t("staffReg.staffIdNumber")}</dt><dd className="font-medium text-ink">{employeeNo}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.department")}</dt><dd className="font-medium text-ink">{s3.department || "—"}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.dateJoined")}</dt><dd className="font-medium text-ink">{s3.hire_date && <EthDate value={s3.hire_date} />}</dd></div>
              <div><dt className="text-xs text-ink-faint">{t("staffReg.contractTypeLabel")}</dt><dd className="font-medium text-ink">{t(`hr.contractType.${s3.contract_type}`)}</dd></div>
            </dl>
          </Panel>

          <Panel className="p-4">
            <h2 className="text-sm font-bold text-ink">{t("staffReg.portalAccessTitle")}</h2>
            {invitedUserId ? (
              <p className="mt-2 text-sm text-ok">{t("staffReg.portalAccessGranted")}</p>
            ) : (
              <>
                <p className="mt-2 text-sm text-ink-faint">{t("staffReg.portalNotInvited")}</p>
                <Button className="mt-3 w-full" onClick={() => sendInviteNow()}>{t("staffReg.sendInvitationNow")}</Button>
              </>
            )}
            {inviteNotice && <p className="mt-2 text-xs text-danger">{inviteNotice}</p>}
          </Panel>
        </div>

        <Panel className="p-4">
          <h2 className="mb-3 text-sm font-bold text-ink">{t("staffReg.suggestedNextSteps")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {!invitedUserId && (
              <NextStepCard title={t("staffReg.nextInvite")} desc={t("staffReg.nextInviteDesc")}
                onClick={() => sendInviteNow()} />
            )}
            <NextStepCard title={t("staffReg.nextViewProfile")} desc={t("staffReg.nextViewProfileDesc")}
              onClick={() => nav(`/hr/employees/${employeeId}`)} />
            <NextStepCard title={t("staffReg.nextPrintId")} desc={t("staffReg.nextPrintIdDesc")}
              onClick={() => nav(`/hr/employees/${employeeId}/id-card`)} />
            <NextStepCard title={t("staffReg.nextRegisterAnother")} desc={t("staffReg.nextRegisterAnotherDesc")}
              onClick={() => window.location.assign("/hr/employees/new")} />
          </div>
        </Panel>
        <p className="text-center text-xs text-ink-faint">
          {t("staffReg.documentChecklist")}: {docsDone}/{STAFF_DOC_TYPES.length}
        </p>
      </div>
    );
  }

  async function sendInviteNow() {
    const email = s3.institutional_email || s1.personal_email;
    if (!email || !employeeId) { setInviteNotice(t("staffReg.inviteFailedNotice")); return; }
    try {
      const { user_id } = await callInviteStaff({
        email, full_name: fullName() || employeeNo, role: portalRole,
        staff_no: portalRole === "teacher" ? employeeNo ?? undefined : undefined,
        default_locale: locale,
      });
      await supabase.from("employees").update({ user_id }).eq("id", employeeId);
      setInvitedUserId(user_id);
      setInviteNotice(null);
    } catch {
      setInviteNotice(t("staffReg.inviteFailedNotice"));
    }
  }

  const stepLabels = [t("staffReg.stepPersonal"), t("staffReg.stepProfessional"), t("staffReg.stepEmployment"), t("staffReg.stepDocuments")];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">{t("staffReg.pageTitle")}</h1>
        <Button variant="ghost" disabled={!employeeId} onClick={() => nav("/hr/employees")}>
          {t("staffReg.saveAsDraft")}
        </Button>
      </div>
      <Stepper step={step} labels={stepLabels} />
      {saveError && <Card className="border border-danger bg-danger-tint py-2 text-sm text-danger">{saveError}</Card>}

      {step === 1 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <SectionCard title={t("staffReg.basicDetails")} icon="👤">
              <TwoScript label={t("staffReg.firstName")} en={s1.first_name} am={s1.first_name_am}
                onEn={(v) => setS1({ ...s1, first_name: v })} onAm={(v) => setS1({ ...s1, first_name_am: v })}
                error={s1Errors.first_name && t(`students.errors.${s1Errors.first_name}`)} />
              <TwoScript label={t("staffReg.fatherName")} en={s1.father_name} am={s1.father_name_am}
                onEn={(v) => setS1({ ...s1, father_name: v })} onAm={(v) => setS1({ ...s1, father_name_am: v })} />
              <TwoScript label={t("staffReg.lastName")} en={s1.last_name} am={s1.last_name_am}
                onEn={(v) => setS1({ ...s1, last_name: v })} onAm={(v) => setS1({ ...s1, last_name_am: v })}
                error={s1Errors.last_name && t(`students.errors.${s1Errors.last_name}`)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("staffReg.gender")} error={s1Errors.gender && t(`students.errors.${s1Errors.gender}`)}>
                  <select value={s1.gender} onChange={(e) => setS1({ ...s1, gender: e.target.value })}
                    className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                    <option value="">—</option>
                    <option value="male">{t("students.male")}</option>
                    <option value="female">{t("students.female")}</option>
                    <option value="other">{t("students.other")}</option>
                  </select>
                </Field>
                <Field label={t("staffReg.dob")} error={s1Errors.dob && t(`students.errors.${s1Errors.dob}`)}>
                  <EthDatePicker value={s1.dob} onChange={(d) => setS1({ ...s1, dob: d })} />
                </Field>
                <Field label={t("staffReg.nationality")}>
                  <Input value={s1.nationality} onChange={(e) => setS1({ ...s1, nationality: e.target.value })} />
                </Field>
                <Field label={t("staffReg.nationalId")}>
                  <Input value={s1.national_id} onChange={(e) => setS1({ ...s1, national_id: e.target.value })} />
                </Field>
                <Field label={t("staffReg.phone")}>
                  <PhoneInput value={s1.phone} onChange={(v) => setS1({ ...s1, phone: v })} />
                </Field>
                <Field label={t("staffReg.personalEmail")}>
                  <Input type="email" value={s1.personal_email} onChange={(e) => setS1({ ...s1, personal_email: e.target.value })} />
                </Field>
              </div>
              <fieldset className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <legend className="col-span-full mb-1 text-xs font-medium uppercase tracking-wide text-ink-faint">{t("staffReg.address")}</legend>
                {(["region", "zone", "woreda", "city", "kebele", "house_number"] as const).map((k) => (
                  <Input key={k} value={s1[k]} onChange={(e) => setS1({ ...s1, [k]: e.target.value })}
                    placeholder={t(`staffReg.${k === "house_number" ? "houseNumber" : k}`)} />
                ))}
              </fieldset>
            </SectionCard>

            <SectionCard title={t("staffReg.emergencyContact")} icon="🚨">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("staffReg.firstName") + " / " + t("staffReg.lastName")}>
                  <Input value={ec.full_name} onChange={(e) => setEc({ ...ec, full_name: e.target.value })} />
                </Field>
                <Field label={t("staffReg.relationship")}>
                  <Input value={ec.relationship} onChange={(e) => setEc({ ...ec, relationship: e.target.value })} />
                </Field>
                <Field label={t("staffReg.phone")}>
                  <PhoneInput value={ec.phone} onChange={(v) => setEc({ ...ec, phone: v })} />
                </Field>
                <Field label={t("staffReg.personalEmail")}>
                  <Input type="email" value={ec.email} onChange={(e) => setEc({ ...ec, email: e.target.value })} />
                </Field>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-4">
            <Card className="flex flex-col items-center gap-3 text-center">
              <div className="h-28 w-28 overflow-hidden rounded-full border-2 border-dashed border-line bg-sidebar">
                {photoPreview && <img src={photoPreview} alt="" className="h-full w-full object-cover" />}
              </div>
              <input ref={photoInput} type="file" accept={STAFF_PHOTO_MIME_TYPES.join(",")} className="hidden"
                onChange={(e) => { setPhotoError(null); const f = e.target.files?.[0]; if (f) { setPhoto(f); setPhotoPath(null); } }} />
              <Button variant="ghost" onClick={() => photoInput.current?.click()}>{t("staffReg.uploadPhoto")}</Button>
              {photoError && <p className="text-xs text-danger">{photoError}</p>}
            </Card>
            <Card>
              <h3 className="mb-2 text-sm font-bold text-ink">{t("staffReg.documentChecklist")}</h3>
              <ul className="space-y-1 text-sm text-ink-faint">
                {STAFF_DOC_TYPES.map((d) => (
                  <li key={d.key}>· {t(`staffReg.doc${toPascal(d.key)}`)}</li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard title={t("staffReg.academicBackground")} icon="🎓" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("staffReg.highestQualification")}>
                <select value={s2.highest_qualification} onChange={(e) => setS2({ ...s2, highest_qualification: e.target.value })}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  <option value="">—</option>
                  {QUALIFICATIONS.map((q) => <option key={q} value={q}>{t(`staffReg.qualification.${q}`)}</option>)}
                </select>
              </Field>
              <Field label={t("staffReg.yearOfGraduation")}>
                <Input inputMode="numeric" value={s2.graduation_year_ec}
                  onChange={(e) => setS2({ ...s2, graduation_year_ec: e.target.value.replace(/\D/g, "") })} placeholder="2018" />
              </Field>
            </div>
            <Field label={t("staffReg.majorSpecialization")}>
              <Input value={s2.major} onChange={(e) => setS2({ ...s2, major: e.target.value })} />
            </Field>
            <Field label={t("staffReg.institutionName")}>
              <Input value={s2.institution_name} onChange={(e) => setS2({ ...s2, institution_name: e.target.value })} />
            </Field>
          </SectionCard>

          <SectionCard title={t("staffReg.certifications")} icon="🏅">
            <p className="text-xs text-ink-faint">{t("staffReg.certificationsHint")}</p>
            <textarea value={s2.certificates_text} onChange={(e) => setS2({ ...s2, certificates_text: e.target.value })}
              rows={6} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
          </SectionCard>

          <SectionCard title={t("staffReg.teachingSpecializations")} icon="🎯" className="lg:col-span-3">
            <Field label={t("staffReg.teachingCycle")}>
              <select value={teachingCycleKey} onChange={(e) => setTeachingCycleKey(e.target.value)}
                className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink sm:w-80">
                <option value="">{t("staffReg.teachingCycleNotSet")}</option>
                {GRADE_CYCLES.map((c) => <option key={c.key} value={c.key}>{t(`gradeCycles.${gradeCycleI18nKey(c.key)}`)}</option>)}
              </select>
            </Field>
            <p className="text-xs text-ink-faint">{t("staffReg.teachingCycleHint")}</p>
            <p className="text-xs text-ink-faint">{t("staffReg.selectSubjectsHint")}</p>
            <div className="flex flex-wrap gap-2">
              {subjectIds.map((id) => {
                const s = subjects?.find((x) => x.id === id);
                if (!s) return null;
                return (
                  <button key={id} type="button" onClick={() => setSubjectIds(subjectIds.filter((x) => x !== id))}
                    className="rounded-pill bg-navy-wash px-3 py-1 text-sm text-navy">
                    {tField(s.name_i18n as Record<string, string>, locale)} ×
                  </button>
                );
              })}
              {(subjects ?? [])
                .filter((s) => !subjectIds.includes(s.id))
                .filter((s) => !subjectSearch || tField(s.name_i18n as Record<string, string>, locale).toLowerCase().includes(subjectSearch.toLowerCase()))
                .slice(0, 8)
                .map((s) => (
                  <button key={s.id} type="button" onClick={() => setSubjectIds([...subjectIds, s.id])}
                    className="rounded-pill border border-line px-3 py-1 text-sm text-ink-soft hover:bg-sidebar">
                    + {tField(s.name_i18n as Record<string, string>, locale)}
                  </button>
                ))}
            </div>
            <Input value={subjectSearch} onChange={(e) => setSubjectSearch(e.target.value)}
              placeholder={t("staffReg.searchSubjects")} />
          </SectionCard>

          <SectionCard title={t("staffReg.languageProficiency")} icon="🗣" className="lg:col-span-3">
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => {
                const active = languages.includes(l);
                return (
                  <button key={l} type="button"
                    onClick={() => setLanguages(active ? languages.filter((x) => x !== l) : [...languages, l])}
                    className={cn("rounded-pill border px-3 py-1 text-sm",
                      active ? "border-navy bg-navy-wash text-navy" : "border-line text-ink-soft hover:bg-sidebar")}>
                    {t(`staffReg.language.${l}`)}
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SectionCard title={t("staffReg.coreEmploymentDetails")} icon="💼" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("staffReg.staffId")}>
                <Input value={employeeNo ?? ""} disabled placeholder="EMP-0001" />
              </Field>
              <Field label={t("staffReg.designationRole")}>
                <select value={s3.employee_type} onChange={(e) => setS3({ ...s3, employee_type: e.target.value as typeof s3.employee_type })}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {EMPLOYEE_TYPES.map((v) => <option key={v} value={v}>{t(`hr.employeeType.${v}`)}</option>)}
                </select>
              </Field>
              <Field label={t("staffReg.department")}>
                <Input value={s3.department} onChange={(e) => setS3({ ...s3, department: e.target.value })} />
              </Field>
              <Field label={t("staffReg.dateOfJoining")} error={s3Errors.hire_date && t(`students.errors.${s3Errors.hire_date}`)}>
                <EthDatePicker value={s3.hire_date} onChange={(d) => setS3({ ...s3, hire_date: d })} />
              </Field>
            </div>
            <Field label={t("staffReg.employmentType")}>
              <div className="grid grid-cols-3 gap-2">
                {CONTRACT_TYPES.map((v) => (
                  <button key={v} type="button" onClick={() => setS3({ ...s3, contract_type: v })}
                    className={cn("rounded-control border px-3 py-2 text-sm font-medium",
                      s3.contract_type === v ? "border-navy bg-navy-wash text-navy" : "border-line text-ink-soft")}>
                    {t(`hr.contractType.${v}`)}
                  </button>
                ))}
              </div>
            </Field>
          </SectionCard>

          <SectionCard title={t("staffReg.workContacts")} icon="✉️">
            <Field label={t("staffReg.institutionalEmail")}>
              <Input type="email" value={s3.institutional_email} onChange={(e) => setS3({ ...s3, institutional_email: e.target.value })} />
            </Field>
            <Field label={t("staffReg.workPhone")}>
              <PhoneInput value={s3.work_phone} onChange={(v) => setS3({ ...s3, work_phone: v })} />
            </Field>
          </SectionCard>

          <SectionCard title={t("staffReg.hierarchyReporting")} icon="🗂" className="lg:col-span-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("staffReg.reportingManager")}>
                <select value={s3.reporting_manager_id} onChange={(e) => setS3({ ...s3, reporting_manager_id: e.target.value })}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  <option value="">{t("staffReg.noManager")}</option>
                  {(managers ?? []).filter((m) => m.id !== employeeId).map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("staffReg.contractDuration")} hint={t("staffReg.contractDurationHint")}>
                <Input inputMode="numeric" value={s3.contract_duration_months}
                  onChange={(e) => setS3({ ...s3, contract_duration_months: e.target.value.replace(/\D/g, "") })} />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title={t("staffReg.portalAccessTitle")} icon="🔑" className="lg:col-span-3">
            <div className="flex items-center gap-3">
              <Toggle checked={inviteToPortal} onChange={setInviteToPortal} label={t("staffReg.invitePortal")} />
              <span className="text-sm text-ink">{t("staffReg.invitePortal")}</span>
            </div>
            {inviteToPortal && (
              <Field label={t("staffReg.portalRole")}>
                <select value={portalRole} onChange={(e) => setPortalRole(e.target.value as PortalRole)}
                  className="w-full max-w-xs rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {(profile?.role === "hr_officer" ? HR_OFFICER_ASSIGNABLE_ROLES : PORTAL_ROLES)
                    .map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                </select>
              </Field>
            )}
          </SectionCard>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <p className="text-sm text-ink-faint lg:col-span-3">{t("staffReg.documentsSubtitle")}</p>
          {STAFF_DOC_TYPES.map((d) => {
            const state = docs[d.key]!;
            return (
              <Card key={d.key} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-sm font-bold text-ink">{t(`staffReg.doc${toPascal(d.key)}`)}</p>
                    <p className="text-xs text-ink-faint">{t(`staffReg.doc${toPascal(d.key)}Desc`)}</p>
                  </div>
                  <Badge tone={state.path ? "ok" : "danger"}>{state.path ? t("staffReg.uploaded") : t("staffReg.missing")}</Badge>
                </div>
                <label className="block">
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                    disabled={!employeeId || state.busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc.mutate({ docType: d.key, file: f }); }} />
                  <span className={cn("inline-block cursor-pointer rounded-control px-3 py-1.5 text-sm font-medium",
                    state.path ? "border border-line text-ink-soft" : "bg-navy text-white")}>
                    {state.busy ? "…" : state.path ? t("staffReg.replace") : t("staffReg.upload")}
                  </span>
                </label>
                {state.error && <p className="text-xs text-danger">{state.error}</p>}
              </Card>
            );
          })}
          <Card className="lg:col-span-3">
            <h3 className="text-sm font-bold text-ink">{t("staffReg.completionStatus")}</h3>
            <p className="text-sm text-ink-faint">
              {t("staffReg.filesUploaded", {
                done: Object.values(docs).filter((d) => d.path).length, total: STAFF_DOC_TYPES.length,
              })}
            </p>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line pt-4">
        {step > 1 ? (
          <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as typeof step)}>{t("staffReg.back")}</Button>
        ) : <span />}
        <div className="flex items-center gap-3">
          {step === 2 && <span className="text-xs text-ink-faint">{t("staffReg.savingProgress")}</span>}
          {step === 1 && <Button disabled={saveStep1.isPending} onClick={() => saveStep1.mutate()}>{t("staffReg.continue")}</Button>}
          {step === 2 && <Button disabled={saveStep2.isPending} onClick={() => saveStep2.mutate()}>{t("staffReg.continue")}</Button>}
          {step === 3 && <Button disabled={saveStep3.isPending} onClick={() => saveStep3.mutate()}>{t("staffReg.continue")}</Button>}
          {step === 4 && <Button disabled={complete.isPending} onClick={() => complete.mutate()}>{t("staffReg.completeRegistration")}</Button>}
        </div>
      </div>
    </div>
  );
}

function NextStepCard({ title, desc, onClick }: { title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-control border border-line p-3 text-left transition-colors hover:bg-sidebar">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="text-xs text-ink-faint">{desc}</p>
    </button>
  );
}

/** employee_documents keys are snake_case; the i18n keys built from them
 *  (staffReg.docCvResume, staffReg.docCvResumeDesc, …) are PascalCase. */
function toPascal(key: string): string {
  return key.split("_").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
}
