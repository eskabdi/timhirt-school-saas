import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

export function CalendarPreferencesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [secondaryVisible, setSecondaryVisible] = useState(true);
  const [geezNumerals, setGeezNumerals] = useState(false);

  const { data: config } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  useEffect(() => {
    if (config?.settings?.calendar) {
      setSecondaryVisible(config.settings.calendar.secondaryVisible ?? true);
      setGeezNumerals(config.settings.calendar.geezNumerals ?? false);
    }
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const settings = { ...(config?.settings ?? {}), calendar: { secondaryVisible, geezNumerals } };
      const { error } = await supabase.from("tenant_configs").upsert({ tenant_id: profile!.tenant_id, settings });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-config"] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.calendarPreferences")}</h1>
      <Card className="max-w-sm space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={secondaryVisible} onChange={(e) => setSecondaryVisible(e.target.checked)} />
          {t("help.showGregorian")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={geezNumerals} onChange={(e) => setGeezNumerals(e.target.checked)} />
          Use Ge'ez numerals (፩ ፪ ፫…)
        </label>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("common.save")}</Button>
      </Card>
    </div>
  );
}
