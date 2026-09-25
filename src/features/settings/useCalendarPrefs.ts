// Tenant calendar display preferences (tenant_configs.settings.calendar),
// saved by CalendarPreferencesPage and read by <EthDate/> and
// <EthDatePicker/> so every call site follows the tenant's choice without a
// prop. Same queryKey the settings page invalidates on save.
//
// Ge'ez numerals are not a choice (fix plan §0 Rule 8): the old
// `geezNumerals` flag was removed by migration 20260925000001 and is ignored
// here if a stale row still carries it.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import type { NumeralSystem } from "@/lib/ethiopian-date";

export interface CalendarPrefs {
  /** Show the Gregorian equivalent alongside EC dates. */
  secondaryVisible: boolean;
  /** Digits for rendered dates: 0-9 (default) or Eastern Arabic ٠-٩. */
  numerals: NumeralSystem;
  /** Show the Hijri (Islamic) date alongside EC dates. */
  showHijri: boolean;
}

export const DEFAULT_CALENDAR_PREFS: CalendarPrefs = { secondaryVisible: true, numerals: "latn", showHijri: false };

/** Normalises whatever is stored into a valid CalendarPrefs. */
export function parseCalendarPrefs(raw: unknown): CalendarPrefs {
  const c = (raw ?? {}) as Partial<Record<keyof CalendarPrefs, unknown>>;
  return {
    secondaryVisible: typeof c.secondaryVisible === "boolean" ? c.secondaryVisible : DEFAULT_CALENDAR_PREFS.secondaryVisible,
    numerals: c.numerals === "arab" ? "arab" : "latn",
    showHijri: c.showHijri === true,
  };
}

export function useCalendarPrefs(): CalendarPrefs {
  const { profile } = useSession();
  const { data } = useQuery({
    queryKey: ["tenant-config"],
    enabled: !!profile?.tenant_id,
    queryFn: async () => (await supabase.from("tenant_configs").select("settings").eq("tenant_id", profile!.tenant_id!).maybeSingle()).data,
  });
  return parseCalendarPrefs((data?.settings as { calendar?: unknown } | undefined)?.calendar);
}
