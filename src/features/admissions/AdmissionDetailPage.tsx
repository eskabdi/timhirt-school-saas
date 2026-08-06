import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { EthDate } from "@/components/EthDate";
import { EnrollStudentModal } from "./EnrollStudentModal";

const REFUND_TONE = { not_applicable: "neutral", pending: "late", completed: "ok" } as const;

const STAGE_TONE = {
  applied: "neutral", shortlisted: "navy", offered: "late", registered: "ok", rejected: "danger",
  incomplete_application: "late", provisionally_accepted: "navy", accepted: "ok",
  waitlisted: "late", enrolled: "ok",
} as const;

const DOC_KEYS: Record<string, string> = {
  birth_certificate_path: "birthCertificate",
  transcript_path: "transcript",
  photo_path: "photo",
  payment_receipt_path: "receipt",
};

async function signedUrlsFor(paths: Record<string, string | null>) {
  const entries = await Promise.all(
    Object.entries(paths).map(async ([key, path]) => {
      if (!path) return [key, null] as const;
      const { data } = await supabase.storage.from("admission-documents").createSignedUrl(path, 60);
      return [key, data?.signedUrl ?? null] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, string | null>;
}

export function AdmissionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = useState(false);
  const [refundNotes, setRefundNotes] = useState("");
  const { data } = useQuery({
    queryKey: ["admission", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("admission_applications").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: docUrls } = useQuery({
    queryKey: ["admission-doc-urls", id, data?.birth_certificate_path, data?.transcript_path, data?.photo_path, data?.payment_receipt_path],
    enabled: !!data,
    queryFn: () => signedUrlsFor({
      birth_certificate_path: data!.birth_certificate_path,
      transcript_path: data!.transcript_path,
      photo_path: data!.photo_path,
      payment_receipt_path: data!.payment_receipt_path,
    }),
  });

  // Latest bank-URL verification attempt for this application (Part 3) --
  // extends the Documents/Payment panel with a staff-facing preview of the
  // bank-hosted PDF the system fetched and re-stored, alongside the raw
  // submitted URL as a cross-check link and the pass/fail status.
  const { data: bankVerification } = useQuery({
    queryKey: ["admission-bank-verification", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: row } = await supabase.from("bank_payment_verifications")
        .select("status, verification_url, pdf_path, failure_reason")
        .eq("admission_application_id", id).maybeSingle();
      if (!row) return null;
      if (row.status !== "verified" || !row.pdf_path) return { ...row, previewUrl: null };
      const { data: signed } = await supabase.storage.from("bank-verifications").createSignedUrl(row.pdf_path, 300);
      return { ...row, previewUrl: signed?.signedUrl ?? null };
    },
  });

  // Registration payments on a never-enrolled application (rejected here --
  // the concrete case that surfaced this gap) can't go through
  // fee_invoices/payments (student_id is NOT NULL there, and a rejected
  // applicant never gets a students row). This is a minimal status flag
  // directly on the application so staff can track the refund through to
  // completion. Covered by the existing admissions_write RLS policy --
  // no new policy needed for these columns.
  const setRefundStatus = useMutation({
    mutationFn: async (status: "pending" | "completed") => {
      const { error } = await supabase.from("admission_applications").update({
        refund_status: status,
        refund_notes: refundNotes.trim() || null,
        ...(status === "completed" ? { refund_processed_at: new Date().toISOString(), refund_processed_by: profile?.id ?? null } : {}),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admission", id] }),
  });

  if (!data) return null;

  const hasBilingualName = data.applicant_first_name || data.applicant_first_name_am;
  const needsRefundTracking = data.stage === "rejected" && data.payment_method && !data.converted_student_id;

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-ink-faint">
        <Link to="/admissions" className="hover:underline">{t("admissions.title")}</Link> › {data.desired_grade ?? t(`admissions.stage.${data.stage}`)} › <span className="text-navy">{t("students.profile.breadcrumb")}</span>
      </p>
      <Card>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-xl font-bold text-ink">{data.applicant_name}</h1>
          <Badge tone={STAGE_TONE[data.stage as keyof typeof STAGE_TONE] ?? "neutral"}>{t(`admissions.stage.${data.stage}`)}</Badge>
        </div>

        {hasBilingualName && (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-ink-faint">{t("admissions.firstName")}</dt><dd className="text-ink">{data.applicant_first_name} / {data.applicant_first_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.middleName")}</dt><dd className="text-ink">{data.applicant_middle_name} / {data.applicant_middle_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.lastName")}</dt><dd className="text-ink">{data.applicant_last_name} / {data.applicant_last_name_am}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.gender")}</dt><dd className="text-ink">{t(`students.${data.gender}`)}</dd></div>
          </dl>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div><dt className="text-ink-faint">{t("admissions.dob")}</dt><dd className="text-ink"><EthDate value={data.date_of_birth} /></dd></div>
        </dl>
      </Card>

      <Panel>
        <PanelHeader title={t("admissions.guardian")} />
        <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
          <div><dt className="text-ink-faint">{t("admissions.name")}</dt><dd className="text-ink">{data.guardian_name}{data.guardian_name_am ? ` / ${data.guardian_name_am}` : ""}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.relationship")}</dt><dd className="text-ink">{data.guardian_relationship ? t(`admissions.relationshipType.${data.guardian_relationship}`) : "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.occupation")}</dt><dd className="text-ink">{data.guardian_occupation ?? "—"}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.phone")}</dt><dd className="text-ink">{data.guardian_phone}</dd></div>
          <div><dt className="text-ink-faint">{t("admissions.email")}</dt><dd className="text-ink">{data.guardian_email ?? "—"}</dd></div>
          <div>
            <dt className="text-ink-faint">{t("admissions.address")}</dt>
            <dd className="text-ink">
              {[data.guardian_house_number, data.guardian_woreda_kebele, data.guardian_subcity, data.guardian_region]
                .filter(Boolean).join(", ") || "—"}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <PanelHeader title={t("admissions.documents")} />
        <ul className="divide-y divide-line px-5">
          {Object.entries(DOC_KEYS).map(([key, labelKey]) => {
            const path = data[key as keyof typeof data] as string | null;
            const url = docUrls?.[key];
            return (
              <li key={key} className="flex items-center justify-between py-3 text-sm">
                <span className="text-ink">{t(`admissions.docLabels.${labelKey}`)}</span>
                {path ? (
                  url ? <a href={url} target="_blank" rel="noreferrer" className="text-navy hover:underline">{t("admissions.view")}</a>
                    : <span className="text-ink-faint">{t("admissions.loading")}</span>
                ) : <Badge tone="danger">{t("admissions.notUploaded")}</Badge>}
              </li>
            );
          })}
        </ul>
      </Panel>

      {data.payment_method && (
        <Panel>
          <PanelHeader title={t("admissions.payment")} />
          <dl className="grid grid-cols-2 gap-4 p-5 text-sm">
            <div><dt className="text-ink-faint">{t("admissions.method")}</dt><dd className="text-ink">{t(`admissions.paymentMethod.${data.payment_method}`)}</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.total")}</dt><dd className="tabular-nums text-ink">{data.fees_total_etb} ETB</dd></div>
            <div><dt className="text-ink-faint">{t("admissions.schoolBus")}</dt><dd className="text-ink">{data.bus_service_opted ? t("admissions.yes") : t("admissions.no")}</dd></div>
          </dl>
          {bankVerification && (
            <div className="border-t border-line p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{t("admissions.bankVerification.title")}</p>
                <Badge tone={bankVerification.status === "verified" ? "ok" : bankVerification.status === "pending" ? "neutral" : "danger"}>
                  {t(`admissions.bankVerification.status.${bankVerification.status}`)}
                </Badge>
              </div>
              <a href={bankVerification.verification_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-navy hover:underline">
                {bankVerification.verification_url}
              </a>
              {bankVerification.failure_reason && (
                <p className="mt-1 text-xs text-danger">{bankVerification.failure_reason}</p>
              )}
              {bankVerification.previewUrl && (
                <iframe title={t("admissions.bankVerification.title")} src={bankVerification.previewUrl}
                  className="mt-3 h-96 w-full rounded-control border border-line" />
              )}
            </div>
          )}
          {needsRefundTracking && (
            <div className="border-t border-line p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">{t("admissions.refund.title")}</p>
                <Badge tone={REFUND_TONE[data.refund_status as keyof typeof REFUND_TONE] ?? "neutral"}>
                  {t(`admissions.refund.status.${data.refund_status}`)}
                </Badge>
              </div>
              <p className="text-xs text-ink-faint">
                {t("admissions.refund.hint", { amount: data.fees_total_etb, method: t(`admissions.paymentMethod.${data.payment_method}`) })}
              </p>
              {data.refund_status === "completed" ? (
                <div className="mt-2 text-xs text-ink-faint">
                  {data.refund_processed_at && (
                    <p>{t("admissions.refund.completedOn")} <EthDate value={data.refund_processed_at} /></p>
                  )}
                  {data.refund_notes && <p className="mt-1 text-ink">{data.refund_notes}</p>}
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <Field label={t("admissions.refund.notes")}>
                    <Input value={refundNotes} onChange={(e) => setRefundNotes(e.target.value)} maxLength={500}
                      placeholder={t("admissions.refund.notesPlaceholder")} />
                  </Field>
                  <div className="flex gap-2">
                    {data.refund_status === "not_applicable" && (
                      <Button variant="ghost" onClick={() => setRefundStatus.mutate("pending")} disabled={setRefundStatus.isPending}>
                        {t("admissions.refund.markPending")}
                      </Button>
                    )}
                    <Button onClick={() => setRefundStatus.mutate("completed")} disabled={setRefundStatus.isPending}>
                      {t("admissions.refund.markCompleted")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      <Panel>
        <PanelHeader title={t("admissions.enroll.title")} />
        <div className="p-5">
          {data.converted_student_id ? (
            <p className="text-sm text-ink">
              {t("admissions.enroll.alreadyEnrolled")}{" "}
              <Link to={`/students/${data.converted_student_id}`} className="text-navy hover:underline">{t("admissions.view")}</Link>
            </p>
          ) : data.stage === "registered" ? (
            <Button onClick={() => setEnrolling(true)}>{t("admissions.enroll.submit")}</Button>
          ) : (
            <p className="text-sm text-ink-faint">{t("admissions.enroll.notRegistered")}</p>
          )}
        </div>
      </Panel>

      {enrolling && (
        <EnrollStudentModal
          application={{
            id: data.id,
            tenant_id: data.tenant_id,
            desired_grade: data.desired_grade,
            applicant_first_name: data.applicant_first_name,
            applicant_last_name: data.applicant_last_name,
            photo_path: data.photo_path,
          }}
          onClose={() => setEnrolling(false)}
        />
      )}
    </div>
  );
}
