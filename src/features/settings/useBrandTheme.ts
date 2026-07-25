// Applies the signed-in tenant's saved colour palette to the running app.
// Shares the ["tenant-config", tenantId] query key with BrandingPage, so
// saving on that page re-themes every screen without a reload.
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { applyBrandPalette, type BrandPalette } from "@/lib/brand-theme";

export function useBrandTheme() {
  const { profile } = useSession();

  const { data: config } = useQuery({
    queryKey: ["tenant-config", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () =>
      (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });

  const branding = config?.settings?.branding as BrandPalette | undefined;
  const primary = branding?.primaryColor;
  const secondary = branding?.secondaryColor;
  const accent = branding?.accentColor;

  useEffect(() => {
    applyBrandPalette({ primaryColor: primary, secondaryColor: secondary, accentColor: accent });
  }, [primary, secondary, accent]);

  // super_admin has no tenant — make sure a previous tenant session's palette
  // never bleeds into the platform console.
  useEffect(() => {
    if (!profile?.tenant_id) applyBrandPalette(null);
  }, [profile?.tenant_id]);
}
