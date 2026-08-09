// Documents tab. Compliance % and Bulk Download are real, computed from
// employee_documents; "Send Renewal Reminder" (no notification channel
// exists for it) and "Export Verification Report" (no report generator
// exists) are left out rather than wired to nothing.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { uploadCategoryDocument } from "../staffApi";

const CATEGORIES = ["identification", "qualifications", "contractual", "health_legal"] as const;
const CATEGORY_LABEL_KEY: Record<(typeof CATEGORIES)[number], string> = {
  identification: "staffProfile.identification", qualifications: "staffProfile.qualifications",
  contractual: "staffProfile.contractual", health_legal: "staffProfile.healthLegal",
};
const HR_WRITE_ROLES = ["school_admin", "hr_officer"];

// The four slots the registration wizard fills (staffApi.ts's STAFF_DOC_TYPES)
// store their canonical slug as doc_type; anything uploaded later through
// this tab's own uploader carries a free-text label instead. Translate the
// former, show the latter as typed.
const DOC_TYPE_LABEL_KEY: Record<string, string> = {
  cv_resume: "staffReg.docCvResume", id_passport_copy: "staffReg.docIdPassportCopy",
  degree_certificate: "staffReg.docDegreeCertificate", professional_license: "staffReg.docProfessionalLicense",
};

interface DocRow {
  id: string; category: string; doc_type: string; storage_path: string;
  verified: boolean; expires_on: string | null;
}

export function DocumentsTab({ employeeId, tenantId }: { employeeId: string; tenantId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { profile } = useSession();
  const canWrite = !!profile && HR_WRITE_ROLES.includes(profile.role);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState<(typeof CATEGORIES)[number]>("identification");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: documents } = useQuery({
    queryKey: ["staff-documents", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase.from("employee_documents")
        .select("id, category, doc_type, storage_path, verified, expires_on")
        .eq("employee_id", employeeId).order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data as DocRow[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => uploadCategoryDocument(tenantId, employeeId, uploadCategory, uploadLabel || file.name, file),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["staff-documents", employeeId] }); setUploadLabel(""); if (fileInput.current) fileInput.current.value = ""; },
    onError: (err: Error) => setUploadError(err.message),
  });

  const toggleVerified = useMutation({
    mutationFn: async (doc: DocRow) => {
      const { error } = await supabase.from("employee_documents")
        .update({ verified: !doc.verified, verified_by: doc.verified ? null : (await supabase.auth.getUser()).data.user?.id, verified_at: doc.verified ? null : new Date().toISOString() })
        .eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["staff-documents", employeeId] }),
  });

  const download = async (doc: DocRow) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  const bulkDownload = async () => {
    if (!documents?.length) return;
    for (const doc of documents) {
      await download(doc); // sequential on purpose: one signed URL per tick, not a burst
    }
  };

  const total = documents?.length ?? 0;
  const verified = documents?.filter((d) => d.verified).length ?? 0;
  const compliancePct = total ? Math.round((verified / total) * 100) : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {CATEGORIES.map((cat) => {
          const docs = (documents ?? []).filter((d) => d.category === cat);
          return (
            <Panel key={cat}>
              <PanelHeader title={t(CATEGORY_LABEL_KEY[cat])} subtitle={t("staffProfile.documentsCount", { count: docs.length })} />
              <ul className="divide-y divide-line">
                {!docs.length ? (
                  <li className="px-4 py-6 text-center text-sm text-ink-faint">{t("staffProfile.noDocumentsInCategory")}</li>
                ) : docs.map((d) => {
                  const labelKey = DOC_TYPE_LABEL_KEY[d.doc_type];
                  return (
                  <li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <button type="button" onClick={() => download(d)} className="font-medium text-navy hover:underline">
                        {labelKey ? t(labelKey) : d.doc_type}
                      </button>
                      {d.expires_on && <p className="text-xs text-ink-faint">{t("staffProfile.expiresOn")}: {d.expires_on}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {canWrite ? (
                        <button type="button" onClick={() => toggleVerified.mutate(d)}
                          className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${d.verified ? "bg-ok-tint text-ok" : "bg-late-tint text-late"}`}>
                          {d.verified ? "✓" : "…"}
                        </button>
                      ) : (
                        <span className={`rounded-pill px-2.5 py-1 text-xs font-semibold ${d.verified ? "bg-ok-tint text-ok" : "bg-late-tint text-late"}`}>
                          {d.verified ? "✓" : "…"}
                        </span>
                      )}
                      <button type="button" onClick={() => download(d)} className="text-xs font-semibold text-navy hover:underline">{t("staffProfile.download")}</button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>

      <div className="space-y-4">
        {canWrite && (
          <Panel>
            <PanelHeader title={t("staffProfile.uploadNewDocument")} />
            <div className="space-y-3 p-4">
              <Field label={t("staffProfile.category")}>
                <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value as typeof uploadCategory)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_LABEL_KEY[c])}</option>)}
                </select>
              </Field>
              <Field label={t("staffProfile.documentLabel")}>
                <input value={uploadLabel} onChange={(e) => setUploadLabel(e.target.value)}
                  className="w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink" />
              </Field>
              <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(e) => { setUploadError(null); const f = e.target.files?.[0]; if (f) upload.mutate(f); }}
                className="w-full text-xs text-ink-faint" />
              <p className="text-xs text-ink-faint">{t("staffProfile.dragDropHint")}</p>
              {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
            </div>
          </Panel>
        )}

        <Panel>
          <PanelHeader title={t("staffProfile.complianceOverview")} />
          <div className="space-y-2 p-4">
            <div className="flex justify-between text-sm"><span className="text-ink-faint">{t("staffProfile.overallProgress")}</span><span className="font-semibold text-ink">{compliancePct}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-sidebar">
              <div className="h-full rounded-full bg-ok" style={{ width: `${compliancePct}%` }} />
            </div>
            <p className="text-xs text-ink-faint">{verified} / {total}</p>
          </div>
        </Panel>

        <Button variant="ghost" className="w-full justify-center" onClick={bulkDownload} disabled={!total}>
          {t("staffProfile.bulkDownloadAll")}
        </Button>
      </div>
    </div>
  );
}
