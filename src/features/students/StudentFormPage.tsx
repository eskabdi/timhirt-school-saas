// Admin-side Student Registration — 4-step wizard matching the public
// admission form 1:1 (same step names, same Stepper, same Panel-per-step
// layout, same bilingual-field pattern). Diverges only where the schema
// forces it: students.class_id is NOT NULL, so the student row is created
// at the end of Step 1 rather than Step 2, and Step 4 shows the applicable
// fee structures read-only — this form enrolls a student directly, it does
// not collect an online payment, so there is no payment-method picker or
// receipt upload the way the public applicant flow has one.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { studentSchema, type StudentInput } from "./schemas";
import {
  createStudent, createGuardian, listClasses, listApplicableFees,
  uploadStudentPhoto, PHOTO_MIME_TYPES, type GuardianInput,
} from "./api";
import { useSession } from "@/features/auth/useSession";
import { formatETB, tField } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Field } from "@/components/ui/Field";
import { Card } from "@/components/ui/Card";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { Stepper } from "@/components/ui/Stepper";
import { EthDatePicker } from "@/components/EthDatePicker";
import { EthnicitySelect } from "./EthnicitySelect";

const RELATIONSHIPS = ["father", "mother", "guardian", "other"] as const;

/** Bilingual name field — an input per script with its language captioned
 *  underneath, exactly matching the public form's BilingualField. */
function BilingualField({ label, error, enValue, amValue, onEn, onAm }: {
  label: string; error?: string;
  enValue: string; amValue: string; onEn: (v: string) => void; onAm: (v: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={label} error={error}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Input value={enValue} maxLength={80} onChange={(e) => onEn(e.target.value)} />
          <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.english")}</p>
        </div>
        <div>
          <Input value={amValue} maxLength={80} onChange={(e) => onAm(e.target.value)} />
          <p className="mt-0.5 text-xs text-ink-faint">{t("students.labels.amharic")}</p>
        </div>
      </div>
    </Field>
  );
}

export function StudentFormPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { profile } = useSession();
  const tenantId = profile!.tenant_id!;
  const qc = useQueryClient();

  const { data: classes } = useQuery({ queryKey: ["classes"], queryFn: listClasses });

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [admissionNo, setAdmissionNo] = useState<string | null>(null);

  // ---------- Step 1: Student Info -------------------------------------------
  const [s1, setS1] = useState({
    first_name: "", first_name_am: "", middle_name: "", middle_name_am: "",
    last_name: "", last_name_am: "", gender: "" as "" | "male" | "female" | "other",
    ethnicity: "", class_id: "", prior_school_name: "", prior_grade: "",
  });
  const [dob, setDob] = useState<Date | null>(null);
  const [s1Errors, setS1Errors] = useState<Record<string, string>>({});

  // ---------- Step 2: Guardian Details ----------------------------------------
  const [s2, setS2] = useState<GuardianInput>({ full_name: "", relationship: "father", phone: "", email: "" });
  const [s2Error, setS2Error] = useState<string | null>(null);

  // ---------- Step 3: Documents (photo) ---------------------------------------
  const photoInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) { setPhotoPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  // ---------- Step 4: Fees (read-only) ----------------------------------------
  const { data: fees } = useQuery({
    queryKey: ["applicable-fees", s1.class_id],
    enabled: step === 4 && !!s1.class_id,
    queryFn: () => listApplicableFees(s1.class_id),
  });
  const feesTotal = (fees ?? []).reduce((sum, f) => sum + f.amount, 0);

  const errorText = (code?: string) => code && t(`students.errors.${code}`);

  const submitStep1 = useMutation({
    mutationFn: async () => {
      const input: StudentInput = {
        first_name: s1.first_name, first_name_am: s1.first_name_am,
        middle_name: s1.middle_name, middle_name_am: s1.middle_name_am,
        last_name: s1.last_name, last_name_am: s1.last_name_am,
        gender: s1.gender as StudentInput["gender"], ethnicity: s1.ethnicity,
        class_id: s1.class_id, date_of_birth: dob as Date,
      };
      const parsed = studentSchema.safeParse(input);
      if (!parsed.success) {
        const errs: Record<string, string> = {};
        for (const issue of parsed.error.issues) errs[String(issue.path[0])] = issue.message;
        setS1Errors(errs);
        throw new Error("validation");
      }
      setS1Errors({});
      const student = await createStudent(tenantId, parsed.data);
      if (s1.prior_school_name.trim() || s1.prior_grade.trim()) {
        await supabase.from("students").update({
          prior_school_name: s1.prior_school_name.trim() || null,
          prior_grade: s1.prior_grade.trim() || null,
        }).eq("id", student.id);
      }
      setStudentId(student.id);
      return student;
    },
    onSuccess: () => setStep(2),
  });

  const submitStep2 = useMutation({
    mutationFn: async () => {
      if (!s2.relationship) { setS2Error(t("students.errors.required")); throw new Error("validation"); }
      setS2Error(null);
      await createGuardian(tenantId, studentId!, s2);
    },
    onSuccess: () => setStep(3),
    onError: (e) => { if (e instanceof Error && e.message !== "validation") setS2Error(t("studentReg.saveFailed")); },
  });

  const uploadPhoto = useMutation({
    mutationFn: async () => {
      if (!photo) return;
      await uploadStudentPhoto(tenantId, studentId!, photo);
    },
    onSuccess: () => { setPhotoUploaded(!!photo); setStep(4); },
    onError: (e) => setPhotoError(e instanceof Error && e.message === "photo_too_large"
      ? t("students.photo.tooLarge") : t("students.photo.failed")),
  });

  const complete = useMutation({
    mutationFn: async () => {
      const { data } = await supabase.from("students").select("admission_no").eq("id", studentId!).single();
      setAdmissionNo(data?.admission_no ?? null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["students"] });
      setStep(5);
    },
  });

  const pickPhoto = (file: File | undefined) => {
    setPhotoError(null);
    if (!file) return;
    if (!PHOTO_MIME_TYPES.includes(file.type)) { setPhotoError(t("students.photo.badType")); return; }
    setPhoto(file);
  };

  if (step === 5) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="text-center">
          <Badge tone="ok" className="mx-auto">{t("studentReg.successBadge")}</Badge>
          <h1 className="mt-3 font-display text-xl font-bold text-ink">{t("studentReg.successHeading")}</h1>
          <p className="mt-2 text-sm text-ink-faint">{t("studentReg.successMessage")}</p>
          {admissionNo && (
            <div className="mt-4 rounded-control border border-line bg-page p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("studentReg.studentIdLabel")}</p>
              <p className="mt-1 font-mono text-lg font-bold tracking-widest text-navy">{admissionNo}</p>
            </div>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="ghost" onClick={() => window.location.assign("/students/new")}>
              {t("studentReg.registerAnother")}
            </Button>
            <Button onClick={() => nav(`/students/${studentId}`)}>{t("studentReg.viewProfile")}</Button>
          </div>
        </Card>
      </div>
    );
  }

  const stepLabels = [
    t("studentReg.stepStudentInfo"), t("studentReg.stepGuardianDetails"),
    t("studentReg.stepDocuments"), t("studentReg.stepFees"),
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h1 className="font-display text-3xl font-bold text-navy">{t("studentReg.pageTitle")}</h1>
      </div>

      <Stepper step={step} labels={stepLabels} />

      {step === 1 && (
        <Panel>
          <div className="border-b border-line px-6 py-5">
            <h2 className="font-display text-xl font-bold text-ink">{t("studentReg.studentInfoHeading")}</h2>
          </div>
          <div className="space-y-4 p-6">
            <BilingualField label={t("students.firstName")} error={errorText(s1Errors.first_name) || errorText(s1Errors.first_name_am)}
              enValue={s1.first_name} amValue={s1.first_name_am}
              onEn={(v) => setS1((s) => ({ ...s, first_name: v }))} onAm={(v) => setS1((s) => ({ ...s, first_name_am: v }))} />
            <BilingualField label={t("students.middleName")} error={errorText(s1Errors.middle_name) || errorText(s1Errors.middle_name_am)}
              enValue={s1.middle_name} amValue={s1.middle_name_am}
              onEn={(v) => setS1((s) => ({ ...s, middle_name: v }))} onAm={(v) => setS1((s) => ({ ...s, middle_name_am: v }))} />
            <BilingualField label={t("students.lastName")} error={errorText(s1Errors.last_name) || errorText(s1Errors.last_name_am)}
              enValue={s1.last_name} amValue={s1.last_name_am}
              onEn={(v) => setS1((s) => ({ ...s, last_name: v }))} onAm={(v) => setS1((s) => ({ ...s, last_name_am: v }))} />

            <Field label={t("students.dob")} error={errorText(s1Errors.date_of_birth)}>
              <EthDatePicker value={dob} onChange={setDob} />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("students.gender")} error={errorText(s1Errors.gender)}>
                <div className="flex gap-6 pt-2">
                  {(["male", "female", "other"] as const).map((g) => (
                    <label key={g} className="flex items-center gap-2 text-sm text-ink">
                      <input type="radio" name="gender" checked={s1.gender === g}
                        onChange={() => setS1((s) => ({ ...s, gender: g }))} /> {t(`students.${g}`)}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label={t("students.class")} error={errorText(s1Errors.class_id)}>
                <select value={s1.class_id} onChange={(e) => setS1((s) => ({ ...s, class_id: e.target.value }))}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  <option value="">—</option>
                  {classes?.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}
                </select>
              </Field>
            </div>

            <EthnicitySelect value={s1.ethnicity} onChange={(v) => setS1((s) => ({ ...s, ethnicity: v }))} />

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("students.priorSchoolName")}>
                <Input value={s1.prior_school_name} onChange={(e) => setS1((s) => ({ ...s, prior_school_name: e.target.value }))} maxLength={200} />
              </Field>
              <Field label={t("students.priorGrade")}>
                <Input value={s1.prior_grade} onChange={(e) => setS1((s) => ({ ...s, prior_grade: e.target.value }))} maxLength={30} />
              </Field>
            </div>
          </div>
          <div className="flex justify-between border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={() => nav("/students")}>{t("students.cancel")}</Button>
            <Button disabled={submitStep1.isPending} onClick={() => submitStep1.mutate()}>
              {submitStep1.isPending ? t("studentReg.saving") : t("studentReg.next")}
            </Button>
          </div>
        </Panel>
      )}

      {step === 2 && (
        <Panel>
          <div className="border-b border-line px-6 py-5">
            <h2 className="font-display text-xl font-bold text-ink">{t("studentReg.guardianDetailsHeading")}</h2>
          </div>
          <div className="space-y-4 p-6">
            <Field label={t("studentReg.guardianFullName")}>
              <Input value={s2.full_name} maxLength={120} onChange={(e) => setS2((s) => ({ ...s, full_name: e.target.value }))} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("admissions.relationship")}>
                <select value={s2.relationship} onChange={(e) => setS2((s) => ({ ...s, relationship: e.target.value as GuardianInput["relationship"] }))}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {RELATIONSHIPS.map((r) => <option key={r} value={r}>{t(`admissions.relationshipType.${r}`)}</option>)}
                </select>
              </Field>
              <Field label={t("admissions.phone")}>
                <PhoneInput value={s2.phone}
                  onChange={(v) => setS2((s) => ({ ...s, phone: v }))} />
              </Field>
            </div>
            <Field label={t("admissions.email")}>
              <Input type="email" value={s2.email} maxLength={254}
                onChange={(e) => setS2((s) => ({ ...s, email: e.target.value }))} />
            </Field>
            {s2Error && <p role="alert" className="text-sm text-danger">{s2Error}</p>}
          </div>
          <div className="flex justify-between border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={() => setStep(1)}>{t("studentReg.back")}</Button>
            <Button disabled={submitStep2.isPending} onClick={() => submitStep2.mutate()}>
              {submitStep2.isPending ? t("studentReg.saving") : t("studentReg.next")}
            </Button>
          </div>
        </Panel>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-ink-faint">{t("studentReg.documentsIntro")}</p>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-6 p-5">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base font-bold text-ink">{t("studentReg.photoUploadTitle")}</h3>
                <p className="mt-1 text-sm text-ink-faint">{t("studentReg.photoUploadDesc")}</p>
                <div className="mt-2">
                  {photoUploaded
                    ? <Badge tone="ok">{t("studentReg.uploaded")}</Badge>
                    : <Badge tone="neutral">{t("studentReg.optional")}</Badge>}
                </div>
                {photoError && <p role="alert" className="mt-2 text-sm text-danger">{photoError}</p>}
              </div>
              <div className="w-72 shrink-0">
                {photoPreview ? (
                  <div className="flex items-center gap-3">
                    <img src={photoPreview} alt="" className="h-16 w-16 rounded-control object-cover" />
                    <button type="button" className="text-sm text-ink-faint hover:text-danger"
                      onClick={() => { setPhoto(null); if (photoInput.current) photoInput.current.value = ""; }}>
                      {t("students.photo.remove")}
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center gap-1 rounded-control border-2 border-dashed border-line px-4 py-6 text-center hover:border-navy">
                    <span className="text-sm font-medium text-navy">{t("students.photo.choose")}</span>
                    <span className="text-xs text-ink-faint">{t("studentReg.maxSize2mb")}</span>
                    <input ref={photoInput} type="file" accept={PHOTO_MIME_TYPES.join(",")} className="hidden"
                      onChange={(e) => pickPhoto(e.target.files?.[0])} />
                  </label>
                )}
              </div>
            </div>
          </Panel>
          <div className="flex justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setStep(2)}>{t("studentReg.back")}</Button>
            <Button disabled={uploadPhoto.isPending} onClick={() => uploadPhoto.mutate()}>
              {uploadPhoto.isPending ? t("studentReg.saving") : t("studentReg.next")}
            </Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <Panel>
            <div className="border-b border-line px-6 py-5">
              <h2 className="font-display text-xl font-bold text-ink">{t("studentReg.feeBreakdown")}</h2>
              <p className="mt-1 text-sm text-ink-faint">{t("studentReg.feesManageNote")}</p>
            </div>
            <div className="divide-y divide-line px-6">
              {(fees ?? []).length === 0 && (
                <p className="py-3 text-sm text-ink-faint">{t("studentReg.noFeesPublished")}</p>
              )}
              {fees?.map((f) => (
                <div key={f.id} className="flex items-center justify-between py-3 text-sm text-ink">
                  <span>
                    {tField(f.name_i18n, i18n.resolvedLanguage!)}
                    <span className="ml-2 text-xs text-ink-faint">{t(`fees.cycle.${f.billing_cycle}`)}</span>
                  </span>
                  <span className="tabular-nums">{formatETB(f.amount, i18n.resolvedLanguage!)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between px-6 py-4 font-display text-lg font-bold text-navy">
              <span>{t("studentReg.totalAmount")}</span>
              <span className="tabular-nums">{formatETB(feesTotal, i18n.resolvedLanguage!)}</span>
            </div>
          </Panel>
          <div className="flex justify-between border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setStep(3)}>{t("studentReg.back")}</Button>
            <Button disabled={complete.isPending} onClick={() => complete.mutate()}>
              {complete.isPending ? t("studentReg.saving") : t("studentReg.completeRegistration")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
