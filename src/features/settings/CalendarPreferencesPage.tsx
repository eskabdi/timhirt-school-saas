import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { today, type NumeralSystem } from "@/lib/ethiopian-date";
import {
  DEFAULT_CALENDAR_PREFS, mergeTenantSettings, parseCalendarPrefs, serializeCalendarPrefs, useTenantSettings, type CalendarPrefs,
} from "./useCalendarPrefs";

// Tenant calendar display settings. Dates are stored Gregorian (§17.2); these
// only change how <EthDate/> and <EthDatePicker/> render them. Ge'ez numerals
// are deliberately not offered (fix plan §0 Rule 8). The write is still
// normalised server-side by the tenant_configs trigger (20260925000002), and
// only the calendar section is written (merge_tenant_settings). Save stays
// disabled until the stored settings have loaded, so the form never saves
// defaults over a choice it did not read.
export function CalendarPreferencesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<CalendarPrefs>(DEFAULT_CALENDAR_PREFS);
  const { data: settings, isSuccess: loaded, isError: loadFailed } = useTenantSettings();

  useEffect(() => {
    if (settings) setPrefs(parseCalendarPrefs(settings.calendar));
  }, [settings]);

  const save = useMutation({
    mutationFn: () => mergeTenantSettings("calendar", serializeCalendarPrefs(prefs)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-config"] }),
  });

  const numeralOptions: { value: NumeralSystem; label: string }[] = [
    { value: "latn", label: t("calendarPrefs.numeralsLatn") },
    { value: "arab", label: t("calendarPrefs.numeralsArab") },
  ];
  const edit = (patch: Partial<CalendarPrefs>) => { save.reset(); setPrefs((p) => ({ ...p, ...patch })); };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("settingsPages.calendarPreferences")}</h1>
      {loadFailed && <p role="alert" className="text-sm text-danger">{t("calendarPrefs.loadFailed")}</p>}
      <Card className="max-w-md space-y-4">
        <label className="flex min-h-6 items-center gap-2 py-1 text-sm">
          <input type="checkbox" checked={prefs.secondaryVisible} onChange={(e) => edit({ secondaryVisible: e.target.checked })} />
          {t("help.showGregorian")}
        </label>
        <div>
          <label className="flex min-h-6 items-center gap-2 py-1 text-sm">
            <input type="checkbox" checked={prefs.showHijri} onChange={(e) => edit({ showHijri: e.target.checked })} />
            {t("calendarPrefs.showHijri")}
          </label>
          <p className="ml-6 text-xs text-ink-soft">{t("calendarPrefs.hijriNote")}</p>
        </div>
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 font-medium text-ink">{t("calendarPrefs.numerals")}</legend>
          {numeralOptions.map((o) => (
            <label key={o.value} className="flex min-h-6 items-center gap-2 py-1">
              <input type="radio" name="numerals" value={o.value} checked={prefs.numerals === o.value}
                onChange={() => edit({ numerals: o.value })} />
              {o.label}
            </label>
          ))}
        </fieldset>
        <p className="text-sm text-ink-soft">
          {t("calendarPrefs.preview")}: <EthDate value={today()} prefs={prefs} />
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={!loaded || save.isPending}>{t("common.save")}</Button>
          <span role="status" className="text-sm text-ink-soft">{save.isSuccess ? t("calendarPrefs.saved") : ""}</span>
        </div>
        {save.isError && <p role="alert" className="text-sm text-danger">{t("calendarPrefs.saveFailed")}</p>}
      </Card>
    </div>
  );
}
