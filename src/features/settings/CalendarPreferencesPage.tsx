import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { today, type NumeralSystem } from "@/lib/ethiopian-date";
import { DEFAULT_CALENDAR_PREFS, parseCalendarPrefs, type CalendarPrefs } from "./useCalendarPrefs";

// Tenant calendar display settings. Dates are stored Gregorian (§17.2); these
// only change how <EthDate/> and <EthDatePicker/> render them. Ge'ez numerals
// are deliberately not offered (fix plan §0 Rule 8).
export function CalendarPreferencesPage() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_CALENDAR_PREFS);

  const { data: config } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  useEffect(() => {
    if (config) setPrefs(parseCalendarPrefs((config.settings as { calendar?: unknown } | null)?.calendar));
  }, [config]);

  const save = useMutation({
    mutationFn: async () => {
      const settings = { ...(config?.settings ?? {}), calendar: prefs };
      const { error } = await supabase.from("tenant_configs").upsert({ tenant_id: profile!.tenant_id, settings });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-config"] }),
  });

  const numeralOptions: { value: NumeralSystem; label: string }[] = [
    { value: "latn", label: t("calendarPrefs.numeralsLatn") },
    { value: "arab", label: t("calendarPrefs.numeralsArab") },
  ];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.calendarPreferences")}</h1>
      <Card className="max-w-md space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prefs.secondaryVisible}
            onChange={(e) => setPrefs((p) => ({ ...p, secondaryVisible: e.target.checked }))} />
          {t("help.showGregorian")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prefs.showHijri}
            onChange={(e) => setPrefs((p) => ({ ...p, showHijri: e.target.checked }))} />
          {t("calendarPrefs.showHijri")}
        </label>
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium text-ink">{t("calendarPrefs.numerals")}</legend>
          {numeralOptions.map((o) => (
            <label key={o.value} className="flex items-center gap-2">
              <input type="radio" name="numerals" value={o.value} checked={prefs.numerals === o.value}
                onChange={() => setPrefs((p) => ({ ...p, numerals: o.value }))} />
              {o.label}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-soft">
          {t("calendarPrefs.preview")}: <EthDate value={today()} numerals={prefs.numerals} />
        </p>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{t("common.save")}</Button>
      </Card>
    </div>
  );
}
