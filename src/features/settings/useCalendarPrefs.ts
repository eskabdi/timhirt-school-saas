// Tenant calendar display preferences (tenant_configs.settings.calendar),
// saved by CalendarPreferencesPage and read by <EthDate/> and
// <EthDatePicker/> so every call site follows the tenant's choice without a
// prop.
//
// Stored keys are snake_case (fix plan §0 Rule 8): secondary_visible,
// numerals, show_hijri. Migration 20260925000002 and its trigger normalise
// every write, including the camelCase keys older clients send, and drop the
// old Ge'ez-numerals flag (Ge'ez numerals are not a choice). The reader still
// accepts the camelCase spelling, so a stale row can never switch a
// preference off.
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

type StoredCalendar = Record<string, unknown>;

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Normalises whatever is stored (snake_case, legacy camelCase, junk) into CalendarPrefs. */
export function parseCalendarPrefs(raw: unknown): CalendarPrefs {
  const c: StoredCalendar = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as StoredCalendar) : {};
  return {
    secondaryVisible: bool(c.secondary_visible, bool(c.secondaryVisible, DEFAULT_CALENDAR_PREFS.secondaryVisible)),
    numerals: c.numerals === "arab" ? "arab" : "latn",
    showHijri: bool(c.show_hijri, bool(c.showHijri, false)),
  };
}

/** The stored (snake_case) shape of CalendarPrefs. */
export function serializeCalendarPrefs(p: CalendarPrefs): StoredCalendar {
  return { secondary_visible: p.secondaryVisible, numerals: p.numerals, show_hijri: p.showHijri };
}

/**
 * The caller's tenant_configs.settings. `.eq("tenant_id")` is a primary-key
 * lookup, not a tenant filter: RLS (configs_select) lets a super_admin read
 * every tenant's row, so the key picks the one that belongs to this session.
 * Errors propagate instead of silently becoming defaults.
 */
export function useTenantSettings() {
  const { profile } = useSession();
  const tenantId = profile?.tenant_id ?? null;
  return useQuery({
    // Own sub-key: other pages cache different columns under
    // ["tenant-config", id]; invalidating ["tenant-config"] still refreshes this.
    queryKey: ["tenant-config", tenantId, "settings"],
    enabled: !!tenantId,
    queryFn: async (): Promise<Record<string, unknown>> => {
      const { data, error } = await supabase.from("tenant_configs").select("settings").eq("tenant_id", tenantId as string).maybeSingle();
      if (error) throw error;
      return (data?.settings as Record<string, unknown> | null) ?? {};
    },
  });
}

export function useCalendarPrefs(): CalendarPrefs {
  const { data } = useTenantSettings();
  return parseCalendarPrefs(data?.calendar);
}

export type TenantSettingsSection = "calendar" | "branding" | "idCardTemplate" | "billing";

/**
 * Saves one top-level section of tenant_configs.settings on the server
 * (merge_tenant_settings, 20260925000003) and leaves every other section as
 * it is. Never write the whole settings object from the client: a save made
 * before the settings loaded used to erase every other section (reviews
 * CQ M-1, i18n N-01).
 */
export async function mergeTenantSettings(section: TenantSettingsSection, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.rpc("merge_tenant_settings", { p_section: section, p_value: value });
  if (error) throw error;
}
