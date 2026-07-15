import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { EthDate } from "@/components/EthDate";

export function TenantsManagementPage() {
  const { data: tenants } = useQuery({
    queryKey: ["platform-tenants"],
    queryFn: async () => (await supabase.from("tenants").select("id, name, slug, status, created_at").order("created_at", { ascending: false })).data ?? [],
  });
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Tenants</h1>
      <div className="overflow-hidden rounded-card border border-line">
        <table className="w-full text-sm">
          <thead className="bg-chalk-sunken text-left text-xs uppercase text-ink-faint">
            <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Slug</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Created</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tenants?.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-2 font-medium">{t.name}</td>
                <td className="px-4 py-2 text-ink-faint">{t.slug}</td>
                <td className="px-4 py-2 capitalize">{t.status}</td>
                <td className="px-4 py-2 text-ink-faint"><EthDate value={t.created_at.slice(0,10)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
