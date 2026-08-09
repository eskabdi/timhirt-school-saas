// Computes which of the 18 modules the signed-in user's tenant can use:
// the tenant's subscription tier's modules, with any tenant_module_overrides
// row taking precedence (enabled=true forces it on even if the tier doesn't
// include it; enabled=false forces it off even if the tier does).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "./useSession";

async function fetchEnabledModules(tenantId: string): Promise<Set<string>> {
  const { data: tenant, error: tErr } = await supabase.from("tenants")
    .select("tier_key").eq("id", tenantId).single();
  if (tErr) throw tErr;

  const [{ data: tierModules, error: tmErr }, { data: overrides, error: oErr }] = await Promise.all([
    supabase.from("tier_modules").select("module_key").eq("tier_key", tenant.tier_key),
    supabase.from("tenant_module_overrides").select("module_key, enabled").eq("tenant_id", tenantId),
  ]);
  if (tmErr) throw tmErr;
  if (oErr) throw oErr;

  const enabled = new Set((tierModules ?? []).map((m) => m.module_key));
  for (const o of overrides ?? []) {
    if (o.enabled) enabled.add(o.module_key);
    else enabled.delete(o.module_key);
  }
  return enabled;
}

/** Returns null while loading/not applicable (e.g. super_admin has no tenant). */
export function useEnabledModules() {
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? null;

  const { data } = useQuery({
    queryKey: ["enabled-modules", tenantId],
    enabled: !!tenantId,
    queryFn: () => fetchEnabledModules(tenantId!),
  });

  return data ?? null;
}
