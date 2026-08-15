// ============================================================================
// Shared document branding accessor (R5-B2), browser runtime.
//
// The counterpart to supabase/functions/_shared/branding.ts, with the same
// field set and the same fallback contract. Before this, the
// "read tenant_configs.settings.branding, pick the locale's name, fall back
// through English to the app name" chain was copy-pasted into
// AcademicRecordTab, StudentDetailPage, LeavingCertificatesPage,
// ReportCardBatchPage and ExamsPage -- five copies, already drifting.
//
// WHAT IS AND ISN'T GATED (the important part):
//
//   schoolName  -- NEVER gated. Client-generated documents (transcript,
//                  report card, leaving certificate, seating chart, profile
//                  sheets) already print the school's configured name today,
//                  at every tier including Basic. Verified against production
//                  before writing this: `gradebook` is in Basic, so Basic
//                  tenants generate branded transcripts right now. Gating
//                  that would be a regression sold as a feature.
//
//   logo, color -- gated behind branding_extended (Standard and above).
//                  These are genuinely new on these documents; nothing below
//                  Standard loses anything it had.
//
// The server-side accessor gates its whole result instead, because the
// documents it serves (invoice/receipt/payslip) carried no branding at all
// before this round -- there was no floor there to protect.
// ============================================================================
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { useEnabledModules } from "@/features/auth/useEnabledModules";

export interface DocumentBranding {
  /** Letterhead name. Always populated; never gated. */
  schoolName: string;
  /** `#RRGGBB`, or null to keep the document's own default. Gated. */
  primaryColor: string | null;
  /** Public URL of the tenant logo, or null. Gated. */
  logoUrl: string | null;
  /** True when branding_extended resolved on for this tenant. */
  extended: boolean;
}

interface BrandingSettings {
  primaryColor?: string | null;
  nameEn?: string | null;
  nameAm?: string | null;
  nameOm?: string | null;
  logoPath?: string | null;
}

/**
 * Branding for client-generated PDFs. Returns null only while the tenant
 * config query is still loading; callers already handle a null/undefined
 * branding object by falling through to their own defaults.
 */
export function useDocumentBranding(): DocumentBranding | null {
  const { profile } = useSession();
  const { t, i18n } = useTranslation();
  const modules = useEnabledModules();
  const tenantId = profile?.tenant_id ?? null;

  const { data: config } = useQuery({
    queryKey: ["tenant-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      (await supabase.from("tenant_configs").select("settings").eq("tenant_id", tenantId!).maybeSingle()).data,
  });

  if (!tenantId) return null;

  const b = ((config?.settings ?? {}) as { branding?: BrandingSettings }).branding ?? {};
  const lang = i18n.resolvedLanguage;
  // Empty strings count as unset -- production has tenants whose nameEn is "".
  const localized = lang === "am" ? b.nameAm : lang === "om" ? b.nameOm : b.nameEn;
  const schoolName = localized?.trim() || b.nameEn?.trim() || t("app.name");

  const extended = !!modules?.has("branding_extended");
  const logoUrl = extended && b.logoPath
    ? supabase.storage.from("branding").getPublicUrl(b.logoPath).data.publicUrl
    : null;

  return {
    schoolName,
    primaryColor: extended ? (b.primaryColor?.trim() || null) : null,
    logoUrl,
    extended,
  };
}

/** Fetch logo bytes for pdf-lib embedding. Never throws -- a broken logo must not cost the document. */
export async function fetchLogoBytes(logoUrl: string | null): Promise<Uint8Array | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
