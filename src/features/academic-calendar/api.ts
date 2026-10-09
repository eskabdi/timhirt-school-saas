// Data for the academic calendar (20261008000001). Every call answers for the
// signed-in user's school: RLS scopes the invoker functions, and
// create_school_calendar derives the tenant from auth.uid().
import { supabase } from "@/lib/supabase";
import type { DayCategory, GridDayType, GridEntry } from "./grid";

export interface YearSettings {
  school_calendar_id: string | null;
  school_status: "draft" | "published" | "closed" | null;
  school_origin: "moe" | "previous_year" | "custom" | null;
  region_calendar_id: string | null;
  region_code: string | null;
  moe_calendar_id: string | null;
  weekend_days: number[];
  session_starts_on: string | null;
  session_ends_on: string | null;
}

export interface EffectiveEntry {
  entry_id: string;
  level: "moe" | "region" | "school";
  source_code: string;
  day_type_code: string;
  starts_on: string;
  ends_on: string;
  name_i18n: Record<string, string>;
  locked: boolean;
}

export interface DayTypeRow {
  code: string;
  label_i18n: Record<string, string>;
  color: string;
  category: DayCategory;
  counts_as_instructional: boolean;
  legend_order: number;
}

export async function fetchYearSettings(ecYear: number): Promise<YearSettings | null> {
  const { data, error } = await supabase.rpc("calendar_year_settings", { p_ec_year: ecYear });
  if (error) throw error;
  return ((data as YearSettings[] | null) ?? [])[0] ?? null;
}

export async function fetchEffectiveEntries(ecYear: number): Promise<EffectiveEntry[]> {
  const { data, error } = await supabase.rpc("effective_calendar_entries", { p_ec_year: ecYear });
  if (error) throw error;
  return (data as EffectiveEntry[] | null) ?? [];
}

export async function fetchDayTypes(): Promise<DayTypeRow[]> {
  const { data, error } = await supabase
    .from("calendar_day_types")
    .select("code,label_i18n,color,category,counts_as_instructional,legend_order")
    .order("legend_order");
  if (error) throw error;
  return (data as DayTypeRow[] | null) ?? [];
}

export async function fetchAuthorities(): Promise<{ code: string; name_i18n: Record<string, string> }[]> {
  const { data, error } = await supabase.from("edu_authorities").select("code,name_i18n").order("code");
  if (error) throw error;
  return (data as { code: string; name_i18n: Record<string, string> }[] | null) ?? [];
}

export type CalendarOrigin = "moe" | "previous_year" | "custom";

export interface CreateCalendarResult {
  calendar_id: string;
  copied: number;
  dropped: { name: Record<string, string>; starts_on: string; ends_on: string; reason: string }[];
}

export async function createSchoolCalendar(ecYear: number, origin: CalendarOrigin): Promise<CreateCalendarResult> {
  const { data, error } = await supabase.rpc("create_school_calendar", { p_ec_year: ecYear, p_origin: origin });
  if (error) throw error;
  return data as CreateCalendarResult;
}

const CREATE_ERRORS = ["not_allowed", "invalid_origin", "invalid_year", "no_previous_calendar", "calendar_exists"] as const;

/** The server's error code, or "unknown" (never raw server text). */
export function calendarErrorKey(err: unknown): (typeof CREATE_ERRORS)[number] | "unknown" {
  const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return CREATE_ERRORS.find((k) => message.includes(k)) ?? "unknown";
}

export const toGridDayTypes = (rows: readonly DayTypeRow[]): GridDayType[] =>
  rows.map((r) => ({ code: r.code, category: r.category, color: r.color, countsAsInstructional: r.counts_as_instructional }));

export const toGridEntries = (rows: readonly EffectiveEntry[]): GridEntry[] =>
  rows.map((r) => ({ id: r.entry_id, dayTypeCode: r.day_type_code, startsOn: r.starts_on, endsOn: r.ends_on }));
