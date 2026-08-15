// ============================================================================
// Document template editor (R5-C4/C5) -- Premium/Enterprise only.
//
// The module check here is UX, not security: document_templates' RLS write
// policy requires school_admin AND has_module(tenant_id,
// 'document_templates'), so a tenant without the module cannot write a row
// even by calling PostgREST directly. This page just declines to show a form
// that the database would reject anyway. (Round 1's lesson, applied
// deliberately rather than rediscovered: a UI-only gate is not a gate.)
//
// The per-document-type field matrix is C3's, encoded once in DOC_TYPES below
// and used for both the editor and the preview, so the two can't disagree
// about which fields a document type supports.
// ============================================================================
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { useEnabledModules } from "@/features/auth/useEnabledModules";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { renderTemplatePreview, type PreviewDocType } from "./documentTemplatePreview";

/** C3's matrix, single source of truth for editor + preview. */
const DOC_TYPES = [
  { key: "transcript",          header: true, signature: true,  watermark: true },
  { key: "report_card",         header: true, signature: true,  watermark: true },
  { key: "invoice",             header: true, signature: false, watermark: true },
  { key: "receipt",             header: true, signature: false, watermark: true },
  { key: "payslip",             header: true, signature: true,  watermark: false },
  { key: "leaving_certificate", header: true, signature: true,  watermark: true },
  { key: "seating_chart",       header: true, signature: false, watermark: false },
] as const;

type DocKey = (typeof DOC_TYPES)[number]["key"];

interface TemplateRow {
  id?: string;
  document_type: string;
  header_text: string | null;
  footer_text: string | null;
  show_signature_line: boolean;
  signature_title: string | null;
  watermark_text: string | null;
  watermark_opacity: number;
}

const emptyRow = (t: DocKey): TemplateRow => ({
  document_type: t, header_text: null, footer_text: null,
  show_signature_line: false, signature_title: null,
  watermark_text: null, watermark_opacity: 0.15,
});

export function DocumentTemplatesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const modules = useEnabledModules();
  const qc = useQueryClient();
  const [open, setOpen] = useState<DocKey | null>(null);
  const [draft, setDraft] = useState<TemplateRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const { data: rows } = useQuery({
    queryKey: ["document-templates"],
    queryFn: async () => {
      const { data, error: err } = await supabase.from("document_templates")
        .select("id, document_type, header_text, footer_text, show_signature_line, signature_title, watermark_text, watermark_opacity");
      if (err) throw err;
      return (data ?? []) as TemplateRow[];
    },
  });

  const save = useMutation({
    mutationFn: async (row: TemplateRow) => {
      const payload = {
        tenant_id: profile!.tenant_id,
        document_type: row.document_type,
        header_text: row.header_text?.trim() || null,
        footer_text: row.footer_text?.trim() || null,
        show_signature_line: row.show_signature_line,
        signature_title: row.signature_title?.trim() || null,
        watermark_text: row.watermark_text?.trim() || null,
        watermark_opacity: row.watermark_opacity,
        updated_by: profile!.id,
      };
      const { error: err } = await supabase.from("document_templates")
        .upsert(payload, { onConflict: "tenant_id,document_type" });
      if (err) throw err;
    },
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ["document-templates"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  // Clearing a template restores that document type to its fixed layout --
  // the same state as never having configured it.
  const clear = useMutation({
    mutationFn: async (docType: DocKey) => {
      const { error: err } = await supabase.from("document_templates").delete().eq("document_type", docType);
      if (err) throw err;
    },
    onSuccess: () => { setError(null); setOpen(null); setDraft(null); qc.invalidateQueries({ queryKey: ["document-templates"] }); },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (!modules) return <p className="text-ink-faint">…</p>;
  if (!modules.has("document_templates")) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold text-ink">{t("documentTemplates.title")}</h1>
        <Card className="py-12 text-center text-ink-faint">{t("documentTemplates.moduleRequired")}</Card>
      </div>
    );
  }

  const rowFor = (k: DocKey) => rows?.find((r) => r.document_type === k) ?? null;

  const startEdit = (k: DocKey) => {
    setOpen(open === k ? null : k);
    setDraft(rowFor(k) ?? emptyRow(k));
    setError(null);
  };

  const preview = async (k: DocKey) => {
    setPreviewBusy(true);
    setError(null);
    try {
      // Synthetic placeholder data only -- never a real student or employee.
      const blob = await renderTemplatePreview(k as PreviewDocType, draft, t);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold text-ink">{t("documentTemplates.title")}</h1>
      <p className="max-w-2xl text-sm text-ink-faint">{t("documentTemplates.subtitle")}</p>
      {error && <Card className="border border-danger bg-danger-tint py-3 text-sm text-danger">{error}</Card>}

      <div className="space-y-2">
        {DOC_TYPES.map((d) => {
          const existing = rowFor(d.key);
          const isOpen = open === d.key;
          return (
            <Card key={d.key} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{t(`documentTemplates.docType.${d.key}`)}</p>
                  <p className="text-xs text-ink-faint">
                    {existing ? t("documentTemplates.configured") : t("documentTemplates.usingDefault")}
                  </p>
                </div>
                <Button variant="tertiary" onClick={() => startEdit(d.key)}>
                  {isOpen ? t("documentTemplates.close") : t("documentTemplates.edit")}
                </Button>
              </div>

              {isOpen && draft && (
                <div className="space-y-3 border-t border-line pt-3">
                  {d.header && (
                    <>
                      <Field label={t("documentTemplates.headerText")}>
                        <Input value={draft.header_text ?? ""} maxLength={200}
                          onChange={(e) => setDraft({ ...draft, header_text: e.target.value })} />
                      </Field>
                      <Field label={t("documentTemplates.footerText")}>
                        <Input value={draft.footer_text ?? ""} maxLength={300}
                          onChange={(e) => setDraft({ ...draft, footer_text: e.target.value })} />
                      </Field>
                    </>
                  )}

                  {d.signature && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-2 text-sm text-ink">
                        <input type="checkbox" checked={draft.show_signature_line}
                          onChange={(e) => setDraft({ ...draft, show_signature_line: e.target.checked })} />
                        {t("documentTemplates.showSignature")}
                      </label>
                      <Field label={t("documentTemplates.signatureTitle")}>
                        <Input value={draft.signature_title ?? ""} maxLength={100}
                          disabled={!draft.show_signature_line}
                          onChange={(e) => setDraft({ ...draft, signature_title: e.target.value })} />
                      </Field>
                    </div>
                  )}

                  {d.watermark && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t("documentTemplates.watermarkText")}>
                        <Input value={draft.watermark_text ?? ""} maxLength={60}
                          onChange={(e) => setDraft({ ...draft, watermark_text: e.target.value })} />
                      </Field>
                      <Field label={t("documentTemplates.watermarkOpacity")}>
                        <input type="range" min={0.05} max={0.5} step={0.05}
                          value={draft.watermark_opacity}
                          onChange={(e) => setDraft({ ...draft, watermark_opacity: Number(e.target.value) })}
                          className="w-full" />
                        <span className="text-xs text-ink-faint">{draft.watermark_opacity.toFixed(2)}</span>
                      </Field>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="tertiary" onClick={() => preview(d.key)} disabled={previewBusy}>
                      {previewBusy ? t("documentTemplates.previewing") : t("documentTemplates.preview")}
                    </Button>
                    {existing && (
                      <Button variant="danger" onClick={() => clear.mutate(d.key)} disabled={clear.isPending}>
                        {t("documentTemplates.reset")}
                      </Button>
                    )}
                    <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
                      {save.isPending ? t("documentTemplates.saving") : t("documentTemplates.save")}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
