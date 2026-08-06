// Admission review: the six-step checklist plus the enrollment status the
// application currently sits at.
//
// The steps are independent toggles rather than a wizard because reviewers
// complete them out of order — finance often clears before the academic check —
// and one Update writes the whole sheet, so a reviewer can flip several and
// change the status in a single action.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { cn } from "@/lib/utils";
import { enrollApplication, type EnrollResult } from "./enrollApi";
import { EnrollResultPanel } from "./EnrollResultPanel";
import { useEnrollTargets } from "./useEnrollTargets";

/** Stored on public.admission_stage. The first five predate this screen and are
 *  kept so existing applications keep resolving. */
export const ENROLLMENT_STATUSES = [
  "applied", "incomplete_application", "provisionally_accepted",
  "accepted", "rejected", "waitlisted", "enrolled",
] as const;

const STEPS = [
  { field: "application_complete", labelKey: "admissionReview.stepComplete" },
  { field: "meets_academic_requirements", labelKey: "admissionReview.stepAcademic" },
  { field: "meets_financial_requirements", labelKey: "admissionReview.stepFinancial" },
  { field: "documents_verified", labelKey: "admissionReview.stepDocuments" },
  { field: "acceptance_letter_sent", labelKey: "admissionReview.stepLetterSent" },
  { field: "student_accepted", labelKey: "admissionReview.stepAccepted" },
] as const;

type StepField = (typeof STEPS)[number]["field"];

export interface ReviewApplication {
  id: string;
  applicant_name: string;
  stage: string;
  tenant_id: string;
  desired_grade: string | null;
  photo_path: string | null;
  converted_student_id?: string | null;
  application_complete?: boolean;
  meets_academic_requirements?: boolean;
  meets_financial_requirements?: boolean;
  documents_verified?: boolean;
  acceptance_letter_sent?: boolean;
  student_accepted?: boolean;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-sm text-ink">{label}</span>
      <span className={cn("relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors",
        checked ? "bg-ok" : "bg-line")}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          aria-label={label} className="peer absolute inset-0 z-10 cursor-pointer opacity-0" />
        <span className={cn(
          "pointer-events-none absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow transition-all",
          checked ? "left-[22px] bg-white text-ok" : "left-0.5 bg-ink-faint")}>
          {checked ? "✓" : "—"}
        </span>
      </span>
    </label>
  );
}

export function AdmissionReviewModal({ application, open, onClose }: {
  application: ReviewApplication | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();

  const [steps, setSteps] = useState<Record<StepField, boolean>>({
    application_complete: false, meets_academic_requirements: false,
    meets_financial_requirements: false, documents_verified: false,
    acceptance_letter_sent: false, student_accepted: false,
  });
  const [stage, setStage] = useState<string>("applied");
  const [classId, setClassId] = useState("");
  const [feeStructureId, setFeeStructureId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<EnrollResult | null>(null);

  useEffect(() => {
    if (!open || !application) return;
    setError(null);
    setEnrollResult(null);
    setClassId("");
    setFeeStructureId("");
    setStage(application.stage);
    setSteps({
      application_complete: !!application.application_complete,
      meets_academic_requirements: !!application.meets_academic_requirements,
      meets_financial_requirements: !!application.meets_financial_requirements,
      documents_verified: !!application.documents_verified,
      acceptance_letter_sent: !!application.acceptance_letter_sent,
      student_accepted: !!application.student_accepted,
    });
  }, [open, application]);

  // Picking "Enrolled" here is the same deliberate act as the dedicated
  // Enroll button elsewhere -- it needs a section, not just a label change.
  const needsEnrollment = stage === "enrolled" && !application?.converted_student_id;

  const { sections, feeStructures } = useEnrollTargets(
    needsEnrollment ? application?.tenant_id : undefined, application?.desired_grade, classId,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (needsEnrollment) {
        const result = await enrollApplication({
          applicationId: application!.id, tenantId: application!.tenant_id,
          classId, photoPath: application!.photo_path, feeStructureId: feeStructureId || undefined,
        });
        // stage/converted_student_id/assigned_class_id are set by the RPC
        // itself -- only the checklist + review metadata need writing here.
        const { error: err } = await supabase.from("admission_applications")
          .update({ ...steps, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() })
          .eq("id", application!.id);
        if (err) throw err;
        setEnrollResult(result);
        return;
      }
      const { error: err } = await supabase.from("admission_applications")
        .update({ ...steps, stage, reviewed_by: profile?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", application!.id);
      if (err) throw err;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admissions"] });
      qc.invalidateQueries({ queryKey: ["admission"] });
      qc.invalidateQueries({ queryKey: ["students"] });
      if (!needsEnrollment) onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : t("admissionReview.saveFailed")),
  });

  if (!application) return null;

  if (enrollResult) {
    return (
      <Modal open={open} onClose={onClose} title={application.applicant_name} size="lg">
        <EnrollResultPanel result={enrollResult} onClose={onClose} />
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={application.applicant_name} size="lg">
      <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <p className="font-mono text-xs text-ink-faint">
          {t("admissionReview.applicationId")}: <span className="text-ink">{application.id}</span>
        </p>
        <span className="rounded-control bg-ink px-3 py-1 text-xs font-semibold text-white">
          {t(`admissionReview.status.${application.stage}`, application.stage)}
        </span>
      </div>

      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <h3 className="mb-1 font-display text-lg font-bold text-navy">{t("admissionReview.processSteps")}</h3>
      <div className="divide-y divide-line">
        {STEPS.map((s) => (
          <Toggle key={s.field} label={t(s.labelKey)} checked={steps[s.field]}
            onChange={(v) => setSteps((prev) => ({ ...prev, [s.field]: v }))} />
        ))}
      </div>

      <label className="mt-5 block space-y-1.5">
        <span className="text-xs font-medium uppercase tracking-wide text-navy">
          {t("admissionReview.enrollmentStatus")}
        </span>
        <select value={stage} onChange={(e) => setStage(e.target.value)}
          className="w-full rounded-control border-2 border-navy bg-card px-3 py-2.5 text-sm text-ink">
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`admissionReview.status.${s}`)}</option>
          ))}
        </select>
      </label>

      {needsEnrollment && (
        <div className="mt-3">
          <Field label={t("admissions.enroll.assignSection")}>
            <select value={classId} onChange={(e) => setClassId(e.target.value)}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              <option value="">—</option>
              {sections?.map((s) => {
                const full = s.capacity != null && s.enrolled >= s.capacity;
                return (
                  <option key={s.id} value={s.id} disabled={full}>
                    {s.name} {s.section ?? ""} {s.capacity != null ? `(${s.enrolled}/${s.capacity})` : ""} {full ? `— ${t("admissions.enroll.full")}` : ""}
                  </option>
                );
              })}
            </select>
            {sections?.length === 0 && <p className="text-xs text-ink-faint">{t("admissions.enroll.noSections")}</p>}
          </Field>

          <Field label={t("admissions.enroll.feeStructure")}>
            <select value={feeStructureId} onChange={(e) => setFeeStructureId(e.target.value)} disabled={!classId}
              className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
              <option value="">{t("admissions.enroll.noInvoice")}</option>
              {feeStructures?.map((f) => (
                <option key={f.id} value={f.id}>{(f.name_i18n as Record<string, string>)?.en ?? f.id} — {f.amount} ETB</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || (needsEnrollment && !classId)}>
          {save.isPending ? t("admissionReview.updating") : t("admissionReview.update")}
        </Button>
      </div>
    </Modal>
  );
}
