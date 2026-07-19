// ============================================================================
// Bridges a 'registered' admission application into an enrolled student
// (K-12 workflow stage 6). The applicant only ever chose a grade (e.g.
// "Grade 5") at apply time — never a section — so this modal is where the
// admin assigns a specific section, filtered to remaining capacity for that
// grade. Enrollment itself runs through the enroll_admission_application()
// Postgres function (atomic: student + guardian + application update in one
// transaction), then two independent follow-ups run automatically: issuing
// a CR-80 ID card (issue-id-card) and provisioning student + guardian
// portal logins (provision-portal-accounts). Either can fail without
// undoing the enrollment that already succeeded, so their results/errors
// are surfaced separately rather than rolled into one all-or-nothing call.
// An optional first invoice is created inline too, since not every grade
// has a matching fee structure.
// ============================================================================
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";

interface Application {
  id: string;
  tenant_id: string;
  desired_grade: string | null;
  applicant_first_name: string | null;
  applicant_last_name: string | null;
}

interface ProvisionedAccount {
  kind: "student" | "guardian";
  method: "password" | "email_invite" | "existing_account";
  email: string;
  temp_password?: string;
}

interface EnrollResult {
  studentId: string;
  idCardUrl: string | null;
  idCardError: string | null;
  accounts: ProvisionedAccount[];
  accountsError: string | null;
}

async function callFunction(name: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${name} failed`);
  return res.json();
}

export function EnrollStudentModal({ application, onClose }: { application: Application; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [classId, setClassId] = useState("");
  const [admissionNo, setAdmissionNo] = useState("");
  const [feeStructureId, setFeeStructureId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EnrollResult | null>(null);

  const { data: sections } = useQuery({
    queryKey: ["admission-enroll-sections", application.tenant_id, application.desired_grade],
    enabled: !!application.desired_grade,
    queryFn: async () => {
      const { data: classes, error: classesErr } = await supabase.from("classes")
        .select("id, name, section, capacity")
        .eq("tenant_id", application.tenant_id)
        .eq("name", application.desired_grade!);
      if (classesErr) throw classesErr;
      const ids = (classes ?? []).map((c) => c.id);
      const { data: active, error: studentsErr } = ids.length
        ? await supabase.from("students").select("class_id").eq("status", "active").in("class_id", ids)
        : { data: [], error: null };
      if (studentsErr) throw studentsErr;
      const counts = new Map<string, number>();
      for (const s of active ?? []) counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1);
      return (classes ?? []).map((c) => ({ ...c, enrolled: counts.get(c.id) ?? 0 }));
    },
  });

  const { data: feeStructures } = useQuery({
    queryKey: ["admission-enroll-fee-structures", application.tenant_id, classId],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error: err } = await supabase.from("fee_structures")
        .select("id, name_i18n, amount, billing_cycle")
        .eq("tenant_id", application.tenant_id)
        .or(`class_id.eq.${classId},class_id.is.null`);
      if (err) throw err;
      return data ?? [];
    },
  });

  const enroll = useMutation({
    mutationFn: async (): Promise<EnrollResult> => {
      const { data, error: rpcErr } = await supabase.rpc("enroll_admission_application", {
        p_application_id: application.id,
        p_class_id: classId,
        p_admission_no: admissionNo,
      });
      if (rpcErr) throw rpcErr;
      const studentId = data as string;

      if (feeStructureId) {
        const structure = feeStructures?.find((f) => f.id === feeStructureId);
        if (structure) {
          const { error: invErr } = await supabase.from("fee_invoices").insert({
            tenant_id: application.tenant_id,
            student_id: studentId,
            fee_structure_id: structure.id,
            amount_due: structure.amount,
            due_date: new Date().toISOString().slice(0, 10),
          });
          if (invErr) throw invErr;
        }
      }

      // Independent follow-ups — a failure in either must not look like the
      // enrollment itself failed, since by this point it already succeeded.
      const [cardRes, accountsRes] = await Promise.allSettled([
        callFunction("issue-id-card", { student_id: studentId }),
        callFunction("provision-portal-accounts", { student_id: studentId }),
      ]);

      return {
        studentId,
        idCardUrl: cardRes.status === "fulfilled" ? (cardRes.value.url as string) : null,
        idCardError: cardRes.status === "rejected" ? String(cardRes.reason) : null,
        accounts: accountsRes.status === "fulfilled" ? (accountsRes.value.accounts as ProvisionedAccount[]) : [],
        accountsError: accountsRes.status === "rejected" ? String(accountsRes.reason) : null,
      };
    },
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["admission", application.id] });
      qc.invalidateQueries({ queryKey: ["admissions"] });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={result ? undefined : onClose}>
      <div className="w-full max-w-md rounded-panel border border-line bg-card p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">{t("admissions.enroll.title")}</h2>
          {!result && <button type="button" aria-label={t("actions.close")} onClick={onClose} className="text-ink-faint hover:text-ink">✕</button>}
        </div>

        {result ? (
          <div className="space-y-4">
            <p className="text-sm text-ok">{t("admissions.enroll.success")}</p>

            <div className="rounded-control border border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("admissions.enroll.idCardReady")}</p>
              {result.idCardUrl ? (
                <a href={result.idCardUrl} target="_blank" rel="noreferrer" className="mt-1 block text-sm text-navy hover:underline">
                  {t("admissions.enroll.downloadIdCard")}
                </a>
              ) : (
                <p className="mt-1 text-sm text-danger">{t("admissions.enroll.idCardFailed")}</p>
              )}
            </div>

            <div className="rounded-control border border-line p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("admissions.enroll.portalAccounts")}</p>
              {result.accountsError ? (
                <p className="mt-1 text-sm text-danger">{t("admissions.enroll.accountsFailed")}</p>
              ) : result.accounts.length === 0 ? (
                <p className="mt-1 text-sm text-ink-faint">{t("admissions.enroll.alreadyLinked")}</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {result.accounts.map((a, i) => (
                    <div key={i} className="rounded-control bg-page p-2 text-sm">
                      <p className="font-medium text-ink">{t(`admissions.enroll.${a.kind}`)}</p>
                      {a.method === "email_invite" ? (
                        <p className="text-ink-faint">{t("admissions.enroll.inviteSent")}: {a.email}</p>
                      ) : a.method === "existing_account" ? (
                        <p className="text-ink-faint">{t("admissions.enroll.alreadyLinked")}: {a.email}</p>
                      ) : (
                        <>
                          <p className="text-ink-faint">{t("admissions.enroll.loginEmail")}: <span className="font-mono">{a.email}</span></p>
                          <p className="text-ink-faint">{t("admissions.enroll.tempPassword")}: <span className="font-mono">{a.temp_password}</span></p>
                        </>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-danger">{t("admissions.enroll.copyWarning")}</p>
                </div>
              )}
            </div>

            <Button onClick={onClose} className="w-full">{t("admissions.enroll.done")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
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

            <Field label={t("students.admissionNo")}>
              <Input value={admissionNo} onChange={(e) => setAdmissionNo(e.target.value)} placeholder="ADM-2018-001" maxLength={20} />
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

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            <Button
              onClick={() => enroll.mutate()}
              disabled={enroll.isPending || !classId || !admissionNo}
              className="w-full"
            >
              {enroll.isPending ? t("admissions.enroll.submitting") : t("admissions.enroll.submit")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
