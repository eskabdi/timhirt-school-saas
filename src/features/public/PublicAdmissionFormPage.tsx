// ============================================================================
// [INSA §5 PUBLIC] 4-step registration stepper (Student Info -> Guardian
// Details -> Documents -> Fees). Anonymous submissions never write to
// admission_applications or admission-documents directly — RLS has no anon
// policy on either. Steps 1+2 are submitted together via submit-admission
// once Step 2 validates (that's the only point both halves of the row are
// known); the returned application_id is then used by
// upload-admission-document for every file in Steps 3-4, gated server-side
// on the application still being in its initial 'applied' stage.
//
// Step 4's fees come from the tenant's own fee_structures, served by the same
// public GET on submit-admission that already supplies the grade list —
// fee_structures has no anon policy, so the Edge Function reads it with the
// service role and returns only name/amount/cycle/grade. The applicant is
// asked to pay this total and upload a receipt for it, so hardcoded figures
// (which is what this page shipped with) meant collecting real money against
// numbers that need not match the school's schedule.
//
// A fee with class_id null applies school-wide; one scoped to a class is keyed
// to that class's grade name and shown only to applicants who chose that grade
// in Step 1. Transport-like lines stay opt-in and are excluded from the total
// until ticked.
//
// Every string on this page routes through the "apply" i18n namespace so the
// LanguageSwitcher actually changes the page's content, not just currency
// formatting (§16.2). The applicant's name/guardian-name fields are the one
// exception: they collect two distinct DATA values — an English spelling and
// an Amharic spelling — regardless of UI language, so both inputs always
// stay, captioned by t("labels.english")/t("labels.amharic") rather than a
// language toggle. Zod messages are short stable codes ("required", not a
// full sentence) translated at error-collection time, since the schema
// itself is built once at module load and can't react to a later language
// switch.
// ============================================================================
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { formatETB, tField } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PhoneInput } from "@/components/ui/PhoneInput";
import { Field } from "@/components/ui/Field";
import { useEthnicityOptions } from "@/features/students/EthnicitySelect";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { EthDatePicker } from "@/components/EthDatePicker";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { toIsoDate } from "@/lib/ethiopian-date";
import { Stepper } from "@/components/ui/Stepper";
import { CopyButton } from "@/components/ui/CopyButton";
import { cn } from "@/lib/utils";

const step1Schema = z.object({
  applicant_first_name: z.string().trim().min(1, "required"),
  applicant_first_name_am: z.string().trim().min(1, "required"),
  applicant_middle_name: z.string().trim().min(1, "required"),
  applicant_middle_name_am: z.string().trim().min(1, "required"),
  applicant_last_name: z.string().trim().min(1, "required"),
  applicant_last_name_am: z.string().trim().min(1, "required"),
  gender: z.enum(["male", "female"], { errorMap: () => ({ message: "required" }) }),
  // Optional by design: a family that would rather not answer must still be
  // able to submit. Empty string is normalised to null by the Edge Function.
  ethnicity: z.string().optional(),
  desired_grade: z.string().trim().min(1, "select_grade"),
});
type Step1Fields = z.infer<typeof step1Schema>;
type Step1Draft = Record<keyof Step1Fields, string>;

const step2Schema = z.object({
  guardian_name: z.string().trim().min(1, "required"),
  guardian_name_am: z.string().trim().min(1, "required"),
  guardian_relationship: z.enum(["father", "mother", "guardian", "other"], { errorMap: () => ({ message: "required" }) }),
  guardian_occupation: z.string().trim().max(120).optional(),
  guardian_phone: z.string().regex(/^\+?[0-9]{7,15}$/, "invalid_phone"),
  guardian_email: z.string().email("invalid_email").optional().or(z.literal("")),
  guardian_region: z.string().trim().optional(),
  guardian_subcity: z.string().trim().optional(),
  guardian_woreda_kebele: z.string().trim().optional(),
  guardian_house_number: z.string().trim().optional(),
});

type DocType = "birth_certificate" | "transcript" | "photo" | "payment_receipt";
interface UploadState { status: "idle" | "uploading" | "done" | "error"; fileName?: string; fileSize?: number; }

function StepperHeader({ step, labels }: { step: number; labels: string[] }) {
  return <Stepper step={step} labels={labels} />;
}

/** A fee line as the public meta endpoint reports it. `grade` null means the
 *  fee applies school-wide; otherwise it names the grade it is scoped to. */
interface PublicFee {
  name_i18n: Record<string, string>;
  amount: number;
  billing_cycle: string;
  grade: string | null;
}

function BilingualField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <Field label={label} error={error}>{children}</Field>;
}

async function fetchAdmissionMeta(tenantSlug: string) {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-admission?tenant_slug=${encodeURIComponent(tenantSlug)}`);
  if (!res.ok) return { tenantName: null, grades: [], fees: [] as PublicFee[], bankVerifiableMethods: [] as string[] };
  const data = (await res.json()) as {
    tenant_name: string;
    grades: { name: string; grade_level: number | null }[];
    fees?: PublicFee[];
    bankVerifiableMethods?: string[];
  };
  return { tenantName: data.tenant_name, grades: data.grades, fees: data.fees ?? [], bankVerifiableMethods: data.bankVerifiableMethods ?? [] };
}

type BankUrlStatus = "idle" | "verifying" | "verified" | "failed";

/** Alongside the manual receipt-image upload (DocumentUploadSlot above), an
 *  applicant can instead paste a bank-generated verification URL -- a PDF
 *  the bank itself hosts. Only rendered for a payment method that has at
 *  least one super_admin-managed allow-listed hostname configured
 *  (meta.bankVerifiableMethods); verify-admission-bank-url fetches and
 *  checks it server-side (_shared/bank-verify.ts). Failure here blocks
 *  the registrant -- this establishes trust for an anonymous submitter
 *  before any human has reviewed the application. */
function BankVerifyUrlSlot({
  applicationId, paymentMethod, onVerified,
}: { applicationId: string; paymentMethod: "cbe" | "awash_bank" | "telebirr"; onVerified: (verified: boolean) => void }) {
  const { t } = useTranslation("apply");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<BankUrlStatus>("idle");
  const [reason, setReason] = useState<string | null>(null);

  const verify = async () => {
    if (!url.trim()) return;
    setStatus("verifying");
    setReason(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-admission-bank-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId, payment_method: paymentMethod, verification_url: url.trim() }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (res.ok && data.ok) {
        setStatus("verified");
        onVerified(true);
      } else {
        setStatus("failed");
        setReason(data.reason ?? "unknown");
        onVerified(false);
      }
    } catch {
      setStatus("failed");
      setReason("network");
      onVerified(false);
    }
  };

  return (
    <div className="mt-4 rounded-control border border-line p-4">
      <p className="text-sm font-medium text-ink">{t("step4.bankVerificationUrl")}</p>
      <p className="mt-1 text-xs text-ink-faint">{t("step4.bankVerificationUrlHint")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Input
          type="url" value={url} maxLength={2048}
          onChange={(e) => { setUrl(e.target.value); if (status !== "idle") { setStatus("idle"); onVerified(false); } }}
          placeholder="https://…" className="min-w-0 flex-1"
        />
        <Button type="button" variant="ghost" onClick={verify} disabled={!url.trim() || status === "verifying"}>
          {status === "verifying" ? t("step4.verifying") : t("step4.verifyUrl")}
        </Button>
      </div>
      {status === "verified" && <p className="mt-2 text-sm text-ok">{t("step4.verified")}</p>}
      {status === "failed" && (
        <p className="mt-2 text-sm text-danger">
          {t(`step4.verifyFailed.${reason}`, { defaultValue: t("step4.verifyFailed.unknown") })}
        </p>
      )}
    </div>
  );
}

function DocumentUploadSlot({
  applicationId, docType, title, description, accept, maxSizeLabel, required, extraFields, onUploaded,
}: {
  applicationId: string;
  docType: DocType;
  title: string;
  description: string;
  accept: string;
  maxSizeLabel: string;
  required?: boolean;
  extraFields?: () => Record<string, string> | null;
  onUploaded?: () => void;
}) {
  const { t } = useTranslation("apply");
  const [state, setState] = useState<UploadState>({ status: "idle" });

  const handleFile = async (file: File) => {
    const extra = extraFields?.();
    if (extraFields && !extra) return; // caller shows its own validation message
    setState({ status: "uploading" });
    const form = new FormData();
    form.append("application_id", applicationId);
    form.append("doc_type", docType);
    form.append("file", file);
    if (extra) for (const [k, v] of Object.entries(extra)) form.append(k, v);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/upload-admission-document`, {
        method: "POST", body: form,
      });
      if (!res.ok) throw new Error("upload failed");
      setState({ status: "done", fileName: file.name, fileSize: file.size });
      onUploaded?.();
    } catch {
      setState({ status: "error" });
    }
  };

  return (
    <Panel className={cn(state.status === "done" && "border-ok")}>
      <div className="flex flex-wrap items-center justify-between gap-6 p-5">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-bold text-ink">{title}</h3>
          <p className="mt-1 text-sm text-ink-faint">{description}</p>
          <div className="mt-2">
            {state.status === "done" ? <Badge tone="ok">{t("upload.uploaded")}</Badge>
              : state.status === "error" ? <Badge tone="danger">{t("upload.failed")}</Badge>
              : <Badge tone={required ? "danger" : "neutral"}>{required ? t("upload.notUploaded") : t("upload.optional")}</Badge>}
          </div>
        </div>
        <div className="w-72 shrink-0">
          {state.status === "done" ? (
            <div className="flex items-center justify-between rounded-control border border-line bg-card px-3 py-2 text-sm">
              <span className="truncate text-ink">{state.fileName}</span>
              <button type="button" aria-label={t("upload.remove")} className="text-ink-faint hover:text-danger"
                onClick={() => setState({ status: "idle" })}>✕</button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-1 rounded-control border-2 border-dashed border-line px-4 py-6 text-center hover:border-navy">
              <span className="text-sm font-medium text-navy">
                {state.status === "uploading" ? t("upload.uploading") : t("upload.clickOrDrag")}
              </span>
              <span className="text-xs text-ink-faint">{maxSizeLabel}</span>
              <input type="file" accept={accept} className="hidden" disabled={state.status === "uploading"}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
          )}
        </div>
      </div>
    </Panel>
  );
}

export function PublicAdmissionFormPage() {
  const { tenantSlug } = useParams();
  const { t, i18n } = useTranslation("apply");
  const ethnicityOptions = useEthnicityOptions();
  const [step, setStep] = useState(1);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [trackingCode, setTrackingCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  const [dob, setDob] = useState<Date | null>(null);
  const [s1, setS1] = useState<Step1Draft>({
    applicant_first_name: "", applicant_first_name_am: "",
    applicant_middle_name: "", applicant_middle_name_am: "",
    applicant_last_name: "", applicant_last_name_am: "",
    gender: "", ethnicity: "", desired_grade: "",
  });
  const [s1Errors, setS1Errors] = useState<Record<string, string>>({});

  const [s2, setS2] = useState({
    guardian_name: "", guardian_name_am: "", guardian_relationship: "", guardian_occupation: "",
    guardian_phone: "", guardian_email: "", guardian_region: "Addis Ababa", guardian_subcity: "",
    guardian_woreda_kebele: "", guardian_house_number: "",
  });
  const [s2Errors, setS2Errors] = useState<Record<string, string>>({});

  const [birthCertDone, setBirthCertDone] = useState(false);
  const [photoDone, setPhotoDone] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [busOpted, setBusOpted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cbe" | "awash_bank" | "telebirr">("cbe");
  const [receiptDone, setReceiptDone] = useState(false);
  const [bankUrlVerified, setBankUrlVerified] = useState(false);
  const [feesError, setFeesError] = useState<string | null>(null);

  const { data: meta } = useQuery({
    queryKey: ["public-admission-meta", tenantSlug],
    queryFn: () => fetchAdmissionMeta(tenantSlug!),
    enabled: !!tenantSlug,
  });
  const grades = meta?.grades;

  // The applicant pays this total and uploads a receipt for it, so it has to be
  // the school's own schedule — school-wide fees plus anything scoped to the
  // grade they picked in Step 1. Optional lines (transport) are opt-in and only
  // count toward the total when ticked.
  const applicableFees = useMemo(() => {
    const all = meta?.fees ?? [];
    return all.filter((f) => f.grade == null || f.grade === s1.desired_grade);
  }, [meta?.fees, s1.desired_grade]);

  const isOptional = (f: PublicFee) =>
    /bus|transport|ትራንስፖርት|አውቶቡስ|geejjiba|konkolaataa/i.test(
      Object.values(f.name_i18n ?? {}).join(" "),
    );

  const mandatoryFees = applicableFees.filter((f) => !isOptional(f));
  const optionalFees = applicableFees.filter(isOptional);
  const total = mandatoryFees.reduce((sum, f) => sum + f.amount, 0)
    + (busOpted ? optionalFees.reduce((sum, f) => sum + f.amount, 0) : 0);

  const submitStep1 = () => {
    const parsed = step1Schema.safeParse(s1);
    if (!dob) { setS1Errors({ date_of_birth: t("errors.required") }); return; }
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path[0] as string] = t(`errors.${issue.message}`);
      setS1Errors(errs);
      return;
    }
    setS1Errors({});
    setStep(2);
  };

  const submitStep2 = async () => {
    const parsed = step2Schema.safeParse(s2);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[issue.path[0] as string] = t(`errors.${issue.message}`);
      setS2Errors(errs);
      return;
    }
    setS2Errors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-admission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_slug: tenantSlug,
          ...s1,
          date_of_birth: toIsoDate(dob!),
          ...parsed.data,
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      const data = (await res.json()) as { application_id: string; tracking_code: string };
      setApplicationId(data.application_id);
      setTrackingCode(data.tracking_code);
      setStep(3);
    } catch {
      setSubmitError(t("errors.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const goToFees = () => {
    if (!birthCertDone || !photoDone) {
      setDocsError(t("errors.docsIncomplete"));
      return;
    }
    setDocsError(null);
    setStep(4);
  };

  const completeRegistration = () => {
    if (!receiptDone && !bankUrlVerified) { setFeesError(t("errors.receiptMissing")); return; }
    setFeesError(null);
    setCompleted(true);
  };

  if (completed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page px-4">
        <Card className="max-w-md text-center">
          <Badge tone="ok" className="mx-auto">{t("completed.badge")}</Badge>
          <h1 className="mt-3 font-display text-xl font-bold text-ink">{t("completed.heading")}</h1>
          <p className="mt-2 text-sm text-ink-faint">{t("completed.message")}</p>
          {trackingCode && (
            <div className="mt-4 rounded-control border border-line bg-page p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{t("completed.trackingCodeLabel")}</p>
              <div className="mt-1 flex items-center justify-center gap-2">
                <p className="font-mono text-lg font-bold tracking-widest text-navy">
                  {trackingCode.slice(0, 5)}-{trackingCode.slice(5)}
                </p>
                <CopyButton value={`${trackingCode.slice(0, 5)}-${trackingCode.slice(5)}`} label={t("completed.copyTrackingCode")} />
              </div>
              <p className="mt-2 text-xs text-ink-faint">{t("completed.trackingCodeHint")}</p>
            </div>
          )}
          <Link to={`/apply/${tenantSlug}/status`} className="mt-4 block text-sm text-navy hover:underline">
            {t("checkStatus")}
          </Link>
        </Card>
      </div>
    );
  }

  const stepLabels = [t("steps.step1"), t("steps.step2"), t("steps.step3"), t("steps.step4")];

  return (
    <div className="min-h-screen bg-page">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-navy to-navy-container px-4 py-4 sm:px-6">
        <span className="min-w-0 truncate font-display text-lg font-bold text-white">{meta?.tenantName ?? t("schoolFallback")}</span>
        <div className="flex items-center gap-4">
          <Link to={`/apply/${tenantSlug}/status`} className="text-sm text-white/90 hover:text-white hover:underline">{t("checkStatus")}</Link>
          <LanguageSwitcher variant="dark" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl font-bold text-navy">{t("title")}</h1>
          {meta?.tenantName && <p className="text-sm font-medium text-ink-soft">{meta.tenantName}</p>}
        </div>

        <StepperHeader step={step} labels={stepLabels} />

        {step === 1 && (
          <Panel>
            <div className="border-b border-line px-6 py-5">
              <h2 className="font-display text-xl font-bold text-ink">{t("step1.heading")}</h2>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <BilingualField label={t("step1.firstName")} error={s1Errors.applicant_first_name || s1Errors.applicant_first_name_am}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Input placeholder={t("step1.firstNamePlaceholderEn")} value={s1.applicant_first_name} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_first_name: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.english")}</p>
                    </div>
                    <div>
                      <Input placeholder={t("step1.firstNamePlaceholderAm")} value={s1.applicant_first_name_am} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_first_name_am: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.amharic")}</p>
                    </div>
                  </div>
                </BilingualField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <BilingualField label={t("step1.middleName")} error={s1Errors.applicant_middle_name || s1Errors.applicant_middle_name_am}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Input placeholder={t("step1.middleNamePlaceholderEn")} value={s1.applicant_middle_name} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_middle_name: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.english")}</p>
                    </div>
                    <div>
                      <Input placeholder={t("step1.middleNamePlaceholderAm")} value={s1.applicant_middle_name_am} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_middle_name_am: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.amharic")}</p>
                    </div>
                  </div>
                </BilingualField>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <BilingualField label={t("step1.lastName")} error={s1Errors.applicant_last_name || s1Errors.applicant_last_name_am}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Input placeholder={t("step1.lastNamePlaceholderEn")} value={s1.applicant_last_name} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_last_name: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.english")}</p>
                    </div>
                    <div>
                      <Input placeholder={t("step1.lastNamePlaceholderAm")} value={s1.applicant_last_name_am} maxLength={80}
                        onChange={(e) => setS1((v) => ({ ...v, applicant_last_name_am: e.target.value }))} />
                      <p className="mt-0.5 text-xs text-ink-faint">{t("labels.amharic")}</p>
                    </div>
                  </div>
                </BilingualField>
              </div>
              <BilingualField label={t("step1.dob")} error={s1Errors.date_of_birth}>
                <EthDatePicker value={dob} onChange={setDob} />
                <p className="mt-1 text-xs text-ink-faint">{t("step1.ecFormat")}</p>
              </BilingualField>
              <div className="grid gap-4 md:grid-cols-2">
                <BilingualField label={t("step1.gender")} error={s1Errors.gender}>
                  <div className="flex gap-6 pt-2">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="radio" name="gender" checked={s1.gender === "male"}
                        onChange={() => setS1((v) => ({ ...v, gender: "male" }))} /> {t("step1.male")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="radio" name="gender" checked={s1.gender === "female"}
                        onChange={() => setS1((v) => ({ ...v, gender: "female" }))} /> {t("step1.female")}
                    </label>
                  </div>
                </BilingualField>
                <BilingualField label={t("step1.grade")} error={s1Errors.desired_grade}>
                  <select value={s1.desired_grade} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
                    onChange={(e) => setS1((v) => ({ ...v, desired_grade: e.target.value }))}>
                    <option value="">{t("step1.selectGrade")}</option>
                    {grades?.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
                  </select>
                </BilingualField>
              </div>
              {/* Optional, and said so on the form. Options come from the shared
                  hook so this list and the staff form's cannot drift apart. */}
              <BilingualField label={t("step1.ethnicity")} error={s1Errors.ethnicity}>
                <select value={s1.ethnicity} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
                  onChange={(e) => setS1((v) => ({ ...v, ethnicity: e.target.value }))}>
                  <option value="">{t("step1.ethnicityNone")}</option>
                  {ethnicityOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-xs text-ink-faint">{t("step1.ethnicityHint")}</p>
              </BilingualField>
            </div>
            <div className="flex justify-between border-t border-line px-6 py-4">
              <Button variant="ghost">{t("step1.cancel")}</Button>
              <Button onClick={submitStep1}>{t("step1.next")}</Button>
            </div>
          </Panel>
        )}

        {step === 2 && (
          <Panel>
            <div className="border-b border-line px-6 py-5">
              <h2 className="font-display text-xl font-bold text-ink">{t("step2.heading")}</h2>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("step2.guardianNameEn")} error={s2Errors.guardian_name}>
                  <Input placeholder={t("step2.guardianNamePlaceholderEn")} maxLength={120} value={s2.guardian_name}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_name: e.target.value }))} />
                </Field>
                <Field label={t("step2.guardianNameAm")} error={s2Errors.guardian_name_am}>
                  <Input placeholder={t("step2.guardianNamePlaceholderAm")} maxLength={120} value={s2.guardian_name_am}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_name_am: e.target.value }))} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("step2.relationship")} error={s2Errors.guardian_relationship}>
                  <select value={s2.guardian_relationship} className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink"
                    onChange={(e) => setS2((v) => ({ ...v, guardian_relationship: e.target.value }))}>
                    <option value="">{t("step2.selectRelationship")}</option>
                    <option value="father">{t("step2.father")}</option>
                    <option value="mother">{t("step2.mother")}</option>
                    <option value="guardian">{t("step2.guardian")}</option>
                    <option value="other">{t("step2.other")}</option>
                  </select>
                </Field>
                <Field label={t("step2.occupation")}>
                  <Input placeholder={t("step2.occupationPlaceholder")} maxLength={120} value={s2.guardian_occupation}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_occupation: e.target.value }))} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t("step2.phone")} error={s2Errors.guardian_phone}>
                  <PhoneInput value={s2.guardian_phone}
                    onChange={(v) => setS2((s) => ({ ...s, guardian_phone: v }))} />
                </Field>
                <Field label={t("step2.email")} error={s2Errors.guardian_email}>
                  <Input type="email" placeholder="email@example.com" maxLength={254} value={s2.guardian_email}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_email: e.target.value }))} />
                </Field>
              </div>

              <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("step2.residentialAddress")}</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label={t("step2.region")}>
                  <Input value={s2.guardian_region} maxLength={80}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_region: e.target.value }))} />
                </Field>
                <Field label={t("step2.subcity")}>
                  <Input placeholder={t("step2.subcityPlaceholder")} maxLength={80} value={s2.guardian_subcity}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_subcity: e.target.value }))} />
                </Field>
                <Field label={t("step2.woreda")}>
                  <Input placeholder={t("step2.woredaPlaceholder")} maxLength={80} value={s2.guardian_woreda_kebele}
                    onChange={(e) => setS2((v) => ({ ...v, guardian_woreda_kebele: e.target.value }))} />
                </Field>
              </div>
              <Field label={t("step2.houseNumber")}>
                <Input placeholder={t("step2.houseNumberPlaceholder")} maxLength={40} value={s2.guardian_house_number}
                  onChange={(e) => setS2((v) => ({ ...v, guardian_house_number: e.target.value }))} />
              </Field>
              {submitError && <p role="alert" className="text-sm text-danger">{submitError}</p>}
            </div>
            <div className="flex justify-between border-t border-line px-6 py-4">
              <Button variant="ghost" onClick={() => setStep(1)}>{t("step2.back")}</Button>
              <Button onClick={submitStep2} disabled={submitting}>{submitting ? t("step2.submitting") : t("step2.next")}</Button>
            </div>
          </Panel>
        )}

        {step === 3 && applicationId && (
          <div className="space-y-4">
            <p className="text-sm text-ink-faint">{t("step3.intro")}</p>
            <DocumentUploadSlot
              applicationId={applicationId} docType="birth_certificate"
              title={t("step3.birthCertTitle")}
              description={t("step3.birthCertDesc")}
              accept="application/pdf,image/jpeg,image/png" maxSizeLabel={t("step3.maxSize5mb")}
              required onUploaded={() => setBirthCertDone(true)}
            />
            <DocumentUploadSlot
              applicationId={applicationId} docType="transcript"
              title={t("step3.transcriptTitle")}
              description={t("step3.transcriptDesc")}
              accept="application/pdf,image/jpeg,image/png" maxSizeLabel={t("step3.maxSize5mb")}
            />
            <DocumentUploadSlot
              applicationId={applicationId} docType="photo"
              title={t("step3.photoTitle")}
              description={t("step3.photoDesc")}
              accept="image/jpeg,image/png" maxSizeLabel={t("step3.maxSize2mb")}
              required onUploaded={() => setPhotoDone(true)}
            />
            {docsError && <p role="alert" className="text-sm text-danger">{docsError}</p>}
            <div className="flex justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setStep(2)}>{t("step3.back")}</Button>
              <Button onClick={goToFees}>{t("step3.next")}</Button>
            </div>
          </div>
        )}

        {step === 4 && applicationId && (
          <div className="space-y-4">
            <Panel>
              <div className="border-b border-line px-6 py-5">
                <h2 className="font-display text-xl font-bold text-ink">{t("step4.feeBreakdown")}</h2>
              </div>
              <div className="divide-y divide-line px-6">
                {applicableFees.length === 0 && (
                  <p className="py-3 text-sm text-ink-faint">{t("step4.noFeesPublished")}</p>
                )}
                {mandatoryFees.map((f, i) => (
                  <div key={`m${i}`} className="flex items-center justify-between py-3 text-sm text-ink">
                    <span>{tField(f.name_i18n, i18n.resolvedLanguage!)}</span>
                    <span className="tabular-nums">{formatETB(f.amount, i18n.resolvedLanguage!)}</span>
                  </div>
                ))}
                {optionalFees.length > 0 && (
                  <div className="flex items-center justify-between rounded-control bg-navy-wash px-3 py-3 text-sm text-ink">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={busOpted} onChange={(e) => setBusOpted(e.target.checked)} />
                      <span>
                        {optionalFees.map((f) => tField(f.name_i18n, i18n.resolvedLanguage!)).join(", ")}
                        <span className="block text-xs text-ink-faint">{t("step4.schoolBusDesc")}</span>
                      </span>
                    </label>
                    <span className="tabular-nums">
                      {formatETB(optionalFees.reduce((s, f) => s + f.amount, 0), i18n.resolvedLanguage!)}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between px-6 py-4 font-display text-lg font-bold text-navy">
                <span>{t("step4.totalAmount")}</span><span className="tabular-nums">{formatETB(total, i18n.resolvedLanguage!)}</span>
              </div>
            </Panel>

            <Panel>
              <div className="border-b border-line px-6 py-5">
                <h2 className="font-display text-xl font-bold text-ink">{t("step4.paymentMethod")}</h2>
              </div>
              <div className="grid grid-cols-3 gap-3 p-6">
                {([["cbe", "CBE"], ["awash_bank", "Awash Bank"], ["telebirr", "Telebirr"]] as const).map(([value, label]) => (
                  <button key={value} type="button"
                    onClick={() => { setPaymentMethod(value); setBankUrlVerified(false); }}
                    className={cn(
                      "rounded-control border p-4 text-center text-sm font-medium transition-colors",
                      paymentMethod === value ? "border-navy bg-navy-wash text-navy" : "border-line text-ink hover:bg-sidebar",
                    )}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="px-6 pb-6">
                <DocumentUploadSlot
                  applicationId={applicationId} docType="payment_receipt"
                  title={t("step4.uploadReceiptTitle")}
                  description={t("step4.uploadReceiptDesc")}
                  accept="application/pdf,image/jpeg,image/png" maxSizeLabel={t("step4.maxSize5mbAlt")}
                  required={!bankUrlVerified}
                  extraFields={() => ({
                    payment_method: paymentMethod,
                    bus_service_opted: String(busOpted),
                    fees_total_etb: String(total),
                  })}
                  onUploaded={() => setReceiptDone(true)}
                />
                {meta?.bankVerifiableMethods.includes(paymentMethod) && (
                  <BankVerifyUrlSlot
                    key={paymentMethod}
                    applicationId={applicationId} paymentMethod={paymentMethod}
                    onVerified={setBankUrlVerified}
                  />
                )}
              </div>
            </Panel>
            {feesError && <p role="alert" className="text-sm text-danger">{feesError}</p>}
            <div className="flex justify-between border-t border-line pt-4">
              <Button variant="ghost" onClick={() => setStep(3)}>{t("step4.back")}</Button>
              <Button onClick={completeRegistration}>{t("step4.complete")}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
