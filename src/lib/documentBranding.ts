// ============================================================================
// Shared document branding accessor (R5-B2), browser runtime.
//
// The counterpart to supabase/functions/_shared/branding.ts. Both resolve
// "what name goes on this document's letterhead" with the same fallback
// chain; this one covers the PDFs generated in the browser.
//
// Before this, that chain -- read tenant_configs.settings.branding, pick the
// active locale's name, fall back through English to the app name -- was
// copy-pasted into AcademicRecordTab, ReportCardBatchPage,
// LeavingCertificatesPage and StudentDetailPage, and had already drifted:
// ExamsPage's seating chart skipped branding entirely and printed the
// product name instead of the school's.
//
// SCOPE, deliberately narrow: this returns the school NAME only. Round 5's
// brief is explicit that ID cards and transcripts "stay always-on at every
// tier, unchanged" -- so client-generated documents must not start painting
// tenant logos or brand colours behind a tier gate. The gated logo/colour
// treatment applies to the three server-rendered documents that carried no
// branding at all before this round (invoice, receipt, payslip), and lives
// in the Edge-side accessor. Exposing unused gated fields here would be dead
// API surface inviting exactly the change the brief rules out.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";

interface BrandingSettings {
  nameEn?: string | null;
  nameAm?: string | null;
  nameOm?: string | null;
}

/**
 * The school name for a generated document's letterhead, in the active
 * locale. Never gated -- these documents already print it at every tier
 * including Basic, and gating it would be a regression sold as a feature.
 *
 * Returns the app name as a last resort, which is what every call site did
 * individually before.
 */
export function useDocumentSchoolName(): string {
  const { profile } = useSession();
  const { t, i18n } = useTranslation();
  const tenantId = profile?.tenant_id ?? null;

  const { data: config } = useQuery({
    queryKey: ["tenant-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      (await supabase.from("tenant_configs").select("settings").eq("tenant_id", tenantId!).maybeSingle()).data,
  });

  const b = ((config?.settings ?? {}) as { branding?: BrandingSettings }).branding ?? {};
  const lang = i18n.resolvedLanguage;
  // Empty strings count as unset -- production has tenants whose nameEn is "".
  const localized = lang === "am" ? b.nameAm : lang === "om" ? b.nameOm : b.nameEn;
  return localized?.trim() || b.nameEn?.trim() || t("app.name");
}
