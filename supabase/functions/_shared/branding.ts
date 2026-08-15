// ============================================================================
// Shared document branding accessor (R5-B2), Edge-Function runtime.
//
// One lookup, one fallback contract, for every server-rendered PDF. Before
// this, issue-id-card was the only function that read tenant branding at all
// (tenant_configs.settings.branding.primaryColor, with a NAVY fallback) and
// fee-pdf.ts / generate-payslip-pdf read none -- so "the school's colour"
// meant one thing on an ID card and nothing anywhere else. This module is
// that reference implementation extracted, with the same field set and the
// same fallback behavior, so a second copy can't drift from the first.
//
// GATING (the part that is new): `branding_extended` is a Standard-tier-and-
// above module. loadDocumentBranding() consults has_module() itself rather
// than making every caller remember to, and when the module is off it
// returns EXACTLY the shape those documents render today -- raw tenants.name,
// no colour override, no logo. That is the whole safety property of this
// round: below Standard, invoices/receipts/payslips are byte-for-byte what
// they already were.
//
// ID cards and transcripts deliberately do NOT call this with gating on.
// Verified against production before writing: `gradebook` is in Basic, so
// Basic tenants generate branded transcripts today, and that must not
// regress. Their branding is pre-existing behavior at every tier, not a
// Standard-tier feature.
// ============================================================================
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface DocumentBranding {
  /** Display name for the letterhead. Falls back to tenants.name, then "School". */
  schoolName: string;
  /**
   * Brand colour as pdf-lib-ready 0..1 RGB, or null when the caller should
   * keep its own hardcoded default. Null is meaningful: it is the signal that
   * nothing about this document's colour should change.
   */
  primaryColor: [number, number, number] | null;
  /** Logo image bytes (PNG/JPEG), or null. Callers embed only if non-null. */
  logoBytes: Uint8Array | null;
  /** True when branding_extended resolved on for this tenant. */
  enabled: boolean;
}

export const UNBRANDED: DocumentBranding = {
  schoolName: "School",
  primaryColor: null,
  logoBytes: null,
  enabled: false,
};

/** Same parser as issue-id-card's, kept identical so colours match across documents. */
export function hexToRgb01(hex: string | null | undefined): [number, number, number] | null {
  const m = hex ? /^#?([0-9a-f]{6})$/i.exec(hex.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface BrandingSettings {
  primaryColor?: string | null;
  nameEn?: string | null;
  nameAm?: string | null;
  nameOm?: string | null;
  logoPath?: string | null;
}

/**
 * Resolve branding for one tenant's generated document.
 *
 * `gated` (default true) makes the result conditional on
 * has_module(tenant_id, 'branding_extended'). Pass false ONLY for documents
 * that already carried branding before this round (ID card, transcript) --
 * for those, gating would be a regression, not a feature.
 *
 * Never throws: a failed lookup degrades to UNBRANDED rather than failing the
 * document. A missing logo must not cost a parent their invoice.
 */
export async function loadDocumentBranding(
  admin: SupabaseClient,
  tenantId: string,
  opts: { locale?: string; gated?: boolean } = {},
): Promise<DocumentBranding> {
  const gated = opts.gated !== false;
  try {
    const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    const tenantName = tenant?.name ?? "School";

    if (gated) {
      const { data: allowed, error } = await admin.rpc("has_module", {
        p_tenant_id: tenantId,
        p_module_key: "branding_extended",
      });
      // Fail closed: an unresolvable module check renders the document
      // exactly as it does today rather than leaking a paid feature.
      if (error || allowed !== true) return { ...UNBRANDED, schoolName: tenantName };
    }

    const { data: config } = await admin.from("tenant_configs")
      .select("settings").eq("tenant_id", tenantId).maybeSingle();
    const b = ((config?.settings ?? {}) as { branding?: BrandingSettings }).branding ?? {};

    // Locale-aware name selection mirrors the frontend transcript path, with
    // the same "fall back through English to the raw tenant name" chain.
    // Empty strings are treated as unset -- production has tenants whose
    // nameEn is "" rather than null.
    const localized = opts.locale === "am" ? b.nameAm : opts.locale === "om" ? b.nameOm : b.nameEn;
    const schoolName = (localized?.trim() || b.nameEn?.trim() || tenantName);

    let logoBytes: Uint8Array | null = null;
    if (b.logoPath) {
      const { data: blob } = await admin.storage.from("branding").download(b.logoPath);
      if (blob) logoBytes = new Uint8Array(await blob.arrayBuffer());
    }

    return { schoolName, primaryColor: hexToRgb01(b.primaryColor), logoBytes, enabled: true };
  } catch (err) {
    console.error("loadDocumentBranding failed; rendering unbranded", { message: (err as Error).message });
    return UNBRANDED;
  }
}
