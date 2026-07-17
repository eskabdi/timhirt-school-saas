// Tier x module matrix: which of the 18 modules each subscription tier
// includes. Tenants inherit their tier's modules (see useEnabledModules);
// one-off exceptions are set per-tenant on TenantDetailPage instead of here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/lib/utils";

export function ModulesMatrixPage() {
  const qc = useQueryClient();

  const { data: modules } = useQuery({
    queryKey: ["modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("modules").select("key, display_name").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: tiers } = useQuery({
    queryKey: ["subscription-tiers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_tiers").select("key, display_name").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: tierModules } = useQuery({
    queryKey: ["tier-modules"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tier_modules").select("tier_key, module_key");
      if (error) throw error;
      return data;
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ tierKey, moduleKey, include }: { tierKey: string; moduleKey: string; include: boolean }) => {
      if (include) {
        const { error } = await supabase.from("tier_modules").insert({ tier_key: tierKey, module_key: moduleKey });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tier_modules").delete()
          .eq("tier_key", tierKey).eq("module_key", moduleKey);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tier-modules"] }),
  });

  const included = (tierKey: string, moduleKey: string) =>
    tierModules?.some((tm) => tm.tier_key === tierKey && tm.module_key === moduleKey) ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Module matrix</h1>
        <p className="text-sm text-ink-faint">
          Which modules each subscription tier includes. A tenant's tier is set on its detail page,
          where you can also override an individual module for that one tenant.
        </p>
      </div>
      <Panel>
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-left text-xs uppercase text-ink-faint">
            <tr>
              <th className="px-4 py-2">Module</th>
              {tiers?.map((t) => <th key={t.key} className="px-4 py-2 text-center">{t.display_name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {modules?.map((m) => (
              <tr key={m.key}>
                <td className="px-4 py-2 font-medium text-ink">{m.display_name}</td>
                {tiers?.map((t) => (
                  <td key={t.key} className="px-4 py-2 text-center">
                    <button
                      type="button"
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ tierKey: t.key, moduleKey: m.key, include: !included(t.key, m.key) })}
                      aria-pressed={included(t.key, m.key)}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-control border transition-colors disabled:opacity-50",
                        included(t.key, m.key)
                          ? "border-navy bg-navy-wash text-navy"
                          : "border-line text-ink-faint hover:bg-sidebar",
                      )}
                    >
                      {included(t.key, m.key) ? "✓" : ""}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
