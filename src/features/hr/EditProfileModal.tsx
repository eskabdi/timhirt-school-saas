// Edit Profile for a staff member. Scoped to columns that live directly on
// employees AND aren't already editable somewhere more specific:
// probation_status/notice_period_days are EmploymentTab's contract editor,
// tin_number/pension_no/bank_account are PayrollTab's sensitive-identifiers
// gate (hr_employee_sensitive), status is a workflow transition set by
// registration/termination flows, not a casual profile field. Everything
// else on the row that isn't system-managed (id, tenant_id, employee_no,
// user_id, created_at/updated_at) belongs here.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { EthDatePicker } from "@/components/EthDatePicker";
import { toIsoDate } from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";
import { STAFF_PHOTO_MIME_TYPES, uploadStaffPhoto } from "./staffApi";

const GENDERS = ["male", "female", "other"] as const;
const QUALIFICATIONS = ["below_grade_12", "high_school", "certificate", "diploma", "bachelor", "masters", "phd", "other"] as const;
const LANGUAGES = ["amharic", "english", "oromo", "tigrinya", "somali", "arabic", "french"] as const;
const EMPLOYEE_TYPES = ["teacher", "admin_staff", "support"] as const;
const SELECT_CLS = "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink";

export interface EmployeeLike {
  id: string; tenant_id: string;
  first_name: string | null; first_name_am: string | null;
  father_name: string | null; father_name_am: string | null;
  last_name: string | null; last_name_am: string | null;
  gender: string | null; date_of_birth: string | null;
  nationality: string | null; national_id: string | null;
  phone: string | null; personal_email: string | null; photo_path: string | null;
  region: string | null; zone: string | null; woreda: string | null; city: string | null;
  kebele: string | null; house_number: string | null;
  highest_qualification: string | null; major: string | null; institution_name: string | null;
  graduation_year_ec: number | null; languages: string[] | null;
  job_title: string | null; department: string | null; office_location: string | null; campus: string | null;
  institutional_email: string | null; work_phone: string | null; reporting_manager_id: string | null;
  employee_type: string; hire_date: string;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="border-b border-line pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      {children}
    </div>
  );
}

export function EditProfileModal({ employee, open, onClose }: {
  employee: EmployeeLike; open: boolean; onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const photoInput = useRef<HTMLInputElement>(null);

  const [f, setF] = useState({
    first_name: employee.first_name ?? "", first_name_am: employee.first_name_am ?? "",
    father_name: employee.father_name ?? "", father_name_am: employee.father_name_am ?? "",
    last_name: employee.last_name ?? "", last_name_am: employee.last_name_am ?? "",
    gender: employee.gender ?? "",
    dob: employee.date_of_birth ? new Date(employee.date_of_birth + "T00:00:00Z") : null as Date | null,
    nationality: employee.nationality ?? "", national_id: employee.national_id ?? "",
    phone: employee.phone ?? "", personal_email: employee.personal_email ?? "",
    region: employee.region ?? "", zone: employee.zone ?? "", woreda: employee.woreda ?? "",
    city: employee.city ?? "", kebele: employee.kebele ?? "", house_number: employee.house_number ?? "",
    highest_qualification: employee.highest_qualification ?? "", major: employee.major ?? "",
    institution_name: employee.institution_name ?? "",
    graduation_year_ec: employee.graduation_year_ec ? String(employee.graduation_year_ec) : "",
    job_title: employee.job_title ?? "", department: employee.department ?? "",
    office_location: employee.office_location ?? "", campus: employee.campus ?? "",
    institutional_email: employee.institutional_email ?? "", work_phone: employee.work_phone ?? "",
    reporting_manager_id: employee.reporting_manager_id ?? "",
    employee_type: employee.employee_type, hire_date: new Date(employee.hire_date + "T00:00:00Z") as Date | null,
  });
  const [languages, setLanguages] = useState<string[]>(employee.languages ?? []);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: colleagues } = useQuery({
    queryKey: ["edit-staff-colleagues", employee.tenant_id],
    enabled: open,
    queryFn: async () =>
      (await supabase.from("employees").select("id, full_name").neq("id", employee.id).order("full_name")).data ?? [],
  });

  const { data: currentPhotoUrl } = useQuery({
    queryKey: ["staff-photo-url", employee.photo_path],
    enabled: open && !!employee.photo_path,
    queryFn: async () => (await supabase.storage.from("avatars").createSignedUrl(employee.photo_path!, 3600)).data?.signedUrl ?? null,
  });

  const pickPhoto = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!STAFF_PHOTO_MIME_TYPES.includes(file.type)) { setError(t("students.photo.badType")); return; }
    setPhoto(file);
  };

  const save = useMutation({
    mutationFn: async () => {
      const fullName = [f.first_name, f.father_name, f.last_name].filter(Boolean).join(" ").trim();
      const { error: eErr } = await supabase.from("employees").update({
        first_name: f.first_name || null, first_name_am: f.first_name_am || null,
        father_name: f.father_name || null, father_name_am: f.father_name_am || null,
        last_name: f.last_name || null, last_name_am: f.last_name_am || null,
        full_name: fullName || employee.first_name || "—",
        gender: f.gender || null, date_of_birth: f.dob ? toIsoDate(f.dob) : null,
        nationality: f.nationality || null, national_id: f.national_id || null,
        phone: f.phone || null, personal_email: f.personal_email || null,
        region: f.region || null, zone: f.zone || null, woreda: f.woreda || null,
        city: f.city || null, kebele: f.kebele || null, house_number: f.house_number || null,
        highest_qualification: f.highest_qualification || null, major: f.major || null,
        institution_name: f.institution_name || null,
        graduation_year_ec: f.graduation_year_ec ? Number(f.graduation_year_ec) : null,
        languages: languages.length ? languages : null,
        job_title: f.job_title || null, department: f.department || null,
        office_location: f.office_location || null, campus: f.campus || null,
        institutional_email: f.institutional_email || null, work_phone: f.work_phone || null,
        reporting_manager_id: f.reporting_manager_id || null,
        employee_type: f.employee_type, hire_date: f.hire_date ? toIsoDate(f.hire_date) : employee.hire_date,
      }).eq("id", employee.id);
      if (eErr) throw eErr;

      if (photo) await uploadStaffPhoto(employee.tenant_id, employee.id, photo);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-profile"] });
      qc.invalidateQueries({ queryKey: ["staff-photo-url"] });
      qc.invalidateQueries({ queryKey: ["staff-employment-extra"] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("staffProfile.editFailed")),
  });

  return (
    <Modal open={open} onClose={onClose} title={t("staffProfile.editProfileTitle")} size="lg">
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      <div className="max-h-[65vh] space-y-5 overflow-y-auto pr-1">
        <Group title={t("staffProfile.photo")}>
          <div className="flex items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border border-line bg-navy-wash">
              {(photo ? URL.createObjectURL(photo) : currentPhotoUrl)
                ? <img src={photo ? URL.createObjectURL(photo) : currentPhotoUrl!} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-3xl text-ink-faint">👤</div>}
            </div>
            <div className="space-y-1">
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="border border-line" onClick={() => photoInput.current?.click()}>
                  {currentPhotoUrl || photo ? t("staffProfile.changePhoto") : t("staffProfile.choosePhoto")}
                </Button>
                {photo && <Button type="button" variant="ghost" onClick={() => { setPhoto(null); if (photoInput.current) photoInput.current.value = ""; }}>{t("staffProfile.removePhoto")}</Button>}
              </div>
            </div>
            <input ref={photoInput} type="file" accept={STAFF_PHOTO_MIME_TYPES.join(",")} className="hidden"
              onChange={(e) => pickPhoto(e.target.files?.[0])} />
          </div>
        </Group>

        <Group title={t("staffProfile.groupIdentity")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("staffReg.firstName")}><Input value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} maxLength={80} /></Field>
            <Field label={`${t("staffReg.firstName")} (${t("students.labels.amharic")})`}><Input value={f.first_name_am} onChange={(e) => setF({ ...f, first_name_am: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.fatherName")}><Input value={f.father_name} onChange={(e) => setF({ ...f, father_name: e.target.value })} maxLength={80} /></Field>
            <Field label={`${t("staffReg.fatherName")} (${t("students.labels.amharic")})`}><Input value={f.father_name_am} onChange={(e) => setF({ ...f, father_name_am: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.lastName")}><Input value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} maxLength={80} /></Field>
            <Field label={`${t("staffReg.lastName")} (${t("students.labels.amharic")})`}><Input value={f.last_name_am} onChange={(e) => setF({ ...f, last_name_am: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.gender")}>
              <select className={SELECT_CLS} value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
                <option value="">—</option>
                {GENDERS.map((g) => <option key={g} value={g}>{t(`students.${g}`)}</option>)}
              </select>
            </Field>
            <Field label={t("staffReg.dob")}><EthDatePicker value={f.dob} onChange={(d) => setF({ ...f, dob: d })} /></Field>
            <Field label={t("staffReg.nationality")}><Input value={f.nationality} onChange={(e) => setF({ ...f, nationality: e.target.value })} maxLength={60} /></Field>
            <Field label={t("staffReg.nationalId")}><Input value={f.national_id} onChange={(e) => setF({ ...f, national_id: e.target.value })} maxLength={40} /></Field>
            <Field label={t("staffReg.phone")}><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+251911223344" /></Field>
            <Field label={t("staffReg.personalEmail")}><Input type="email" value={f.personal_email} onChange={(e) => setF({ ...f, personal_email: e.target.value })} /></Field>
          </div>
        </Group>

        <Group title={t("staffProfile.groupAddress")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("staffReg.region")}><Input value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.zone")}><Input value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.woreda")}><Input value={f.woreda} onChange={(e) => setF({ ...f, woreda: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.city")}><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.kebele")}><Input value={f.kebele} onChange={(e) => setF({ ...f, kebele: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.houseNumber")}><Input value={f.house_number} onChange={(e) => setF({ ...f, house_number: e.target.value })} maxLength={40} /></Field>
          </div>
        </Group>

        <Group title={t("staffProfile.groupProfessional")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("staffReg.highestQualification")}>
              <select className={SELECT_CLS} value={f.highest_qualification} onChange={(e) => setF({ ...f, highest_qualification: e.target.value })}>
                <option value="">—</option>
                {QUALIFICATIONS.map((q) => <option key={q} value={q}>{t(`staffReg.qualification.${q}`)}</option>)}
              </select>
            </Field>
            <Field label={t("staffReg.yearOfGraduation")}>
              <Input inputMode="numeric" value={f.graduation_year_ec} onChange={(e) => setF({ ...f, graduation_year_ec: e.target.value.replace(/\D/g, "") })} placeholder="2018" />
            </Field>
            <Field label={t("staffReg.majorSpecialization")}><Input value={f.major} onChange={(e) => setF({ ...f, major: e.target.value })} maxLength={120} /></Field>
            <Field label={t("staffReg.institutionName")}><Input value={f.institution_name} onChange={(e) => setF({ ...f, institution_name: e.target.value })} maxLength={120} /></Field>
          </div>
          <Field label={t("staffReg.languageProficiency")}>
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
          </Field>
        </Group>

        <Group title={t("staffProfile.employmentDetails")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t("staffProfile.jobTitle")}><Input value={f.job_title} onChange={(e) => setF({ ...f, job_title: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.department")}><Input value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffProfile.officeLocation")}><Input value={f.office_location} onChange={(e) => setF({ ...f, office_location: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffProfile.campus")}><Input value={f.campus} onChange={(e) => setF({ ...f, campus: e.target.value })} maxLength={80} /></Field>
            <Field label={t("staffReg.institutionalEmail")}><Input type="email" value={f.institutional_email} onChange={(e) => setF({ ...f, institutional_email: e.target.value })} /></Field>
            <Field label={t("staffReg.workPhone")}><Input value={f.work_phone} onChange={(e) => setF({ ...f, work_phone: e.target.value })} placeholder="+251911223344" /></Field>
            <Field label={t("staffReg.reportingManager")}>
              <select className={SELECT_CLS} value={f.reporting_manager_id} onChange={(e) => setF({ ...f, reporting_manager_id: e.target.value })}>
                <option value="">{t("staffReg.noManager")}</option>
                {colleagues?.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </Field>
            <Field label={t("hr.type")}>
              <select className={SELECT_CLS} value={f.employee_type} onChange={(e) => setF({ ...f, employee_type: e.target.value })}>
                {EMPLOYEE_TYPES.map((v) => <option key={v} value={v}>{t(`hr.employeeType.${v}`)}</option>)}
              </select>
            </Field>
            <Field label={t("staffReg.dateOfJoining")}><EthDatePicker value={f.hire_date} onChange={(d) => setF({ ...f, hire_date: d })} /></Field>
          </div>
        </Group>
      </div>

      <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onClose}>{t("staffProfile.cancel")}</Button>
        <Button onClick={() => save.mutate()} disabled={!f.first_name || !f.last_name || save.isPending}>
          {save.isPending ? t("staffProfile.savingProfile") : t("staffProfile.saveProfile")}
        </Button>
      </div>
    </Modal>
  );
}
