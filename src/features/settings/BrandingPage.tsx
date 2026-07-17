import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useState, useEffect } from "react";

export function BrandingPage() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const [color, setColor] = useState("#E8A317");

  const { data: config } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  useEffect(() => { if (config?.settings?.branding?.primaryColor) setColor(config.settings.branding.primaryColor); }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const settings = { ...(config?.settings ?? {}), branding: { ...(config?.settings?.branding ?? {}), primaryColor: color } };
      const { error } = await supabase.from("tenant_configs").upsert({ tenant_id: profile!.tenant_id, settings });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-config"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">Branding</h1>
      <Card className="max-w-sm space-y-3">
        <label className="block text-xs font-medium uppercase text-ink-faint">Primary color</label>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20 rounded-control border border-line" />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
      </Card>
    </div>
  );
}
