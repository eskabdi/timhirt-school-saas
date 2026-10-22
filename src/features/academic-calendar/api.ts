// Data for the academic calendar (20261008000001). Every call answers for the
// signed-in user's school: RLS scopes the invoker functions, and
// create_school_calendar derives the tenant from auth.uid().
import { supabase } from "@/lib/supabase";
import type { DayCategory, GridDayType, GridEntry } from "./grid";
import { safeColor } from "./contrast";

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
  /** Only the MoE or a regional bureau enters it (a school may only remove an unlocked one). */
  authority_only: boolean;
  /** Computed by the engine (instructional, weekend); never entered. */
  derived: boolean;
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
    .select("code,label_i18n,color,category,counts_as_instructional,legend_order,authority_only,derived")
    .order("legend_order");
  if (error) throw error;
  // Only #rrggbb reaches a style (the DB CHECK says so too; defence in depth).
  return ((data as DayTypeRow[] | null) ?? []).map((d) => ({ ...d, color: safeColor(d.color) }));
}

/**
 * Whether the signed-in user may choose the school's calendar: the same
 * check create_school_calendar makes (academic_calendar:create, which custom
 * roles and per-user grants can carry), not a role name.
 */
export async function fetchCanCreateCalendar(userId: string): Promise<boolean> {
  return fetchCalendarPermission(userId, "create");
}

/** academic_calendar:<action> for the signed-in user (the server re-checks it on every call). */
export async function fetchCalendarPermission(userId: string, action: "create" | "update" | "publish"): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_resource_permission", {
    p_user_id: userId, p_resource: "academic_calendar", p_action: action,
  });
  if (error) throw error;
  return data === true;
}

export async function fetchAuthorities(): Promise<{ code: string; name_i18n: Record<string, string> }[]> {
  const { data, error } = await supabase.from("edu_authorities").select("code,name_i18n").order("code");
  if (error) throw error;
  return (data as { code: string; name_i18n: Record<string, string> }[] | null) ?? [];
}

export type CalendarOrigin = "moe" | "previous_year" | "custom";

export interface CreateCalendarResult {
  calendar_id: string;
  status: string;
  origin: CalendarOrigin;
  copied: number;
  dropped: { name: Record<string, string>; starts_on: string; ends_on: string; reason: string }[];
}

export async function createSchoolCalendar(ecYear: number, origin: CalendarOrigin): Promise<CreateCalendarResult> {
  const { data, error } = await supabase.rpc("create_school_calendar", { p_ec_year: ecYear, p_origin: origin });
  if (error) throw error;
  return data as CreateCalendarResult;
}

const CREATE_ERRORS = ["not_allowed", "invalid_origin", "invalid_year", "no_previous_calendar", "calendar_exists"] as const;

/**
 * The server's error code, or "unknown" (never raw server text). The RPC
 * raises the bare code as the message, so only an exact match counts: a
 * message that merely contains a code (say, a column name) is "unknown".
 */
export function calendarErrorKey(err: unknown): (typeof CREATE_ERRORS)[number] | "unknown" {
  return exactErrorKey(err, CREATE_ERRORS);
}

function exactErrorKey<K extends string>(err: unknown, keys: readonly K[]): K | "unknown" {
  const message = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  return keys.find((k) => message === k) ?? "unknown";
}

export const toGridDayTypes = (rows: readonly DayTypeRow[]): GridDayType[] =>
  rows.map((r) => ({ code: r.code, category: r.category, color: r.color, countsAsInstructional: r.counts_as_instructional }));

export const toGridEntries = (rows: readonly EffectiveEntry[]): GridEntry[] =>
  rows.map((r) => ({ id: r.entry_id, dayTypeCode: r.day_type_code, startsOn: r.starts_on, endsOn: r.ends_on }));

// ------------------------------------------------------------- authoring --
// 20261022000001: a draft is edited directly; publishing it and changing it
// once published are maker-checker requests (submit_approval), applied only
// when a second person with academic_calendar:approve agrees.

export interface SchoolEntry {
  id: string;
  day_type_code: string;
  starts_on: string;
  ends_on: string;
  name_i18n: Record<string, string>;
  overrides_entry_id: string | null;
  suppressed: boolean;
}

export interface EntryInput {
  day_type_code: string;
  starts_on: string;
  ends_on: string;
  name_i18n: Record<string, string>;
  overrides_entry_id?: string | null;
  suppressed?: boolean;
}

/** The school's own entries (removals of MoE/regional dates included). */
export async function fetchSchoolEntries(calendarId: string): Promise<SchoolEntry[]> {
  const { data, error } = await supabase
    .from("school_calendar_entries")
    .select("id,day_type_code,starts_on,ends_on,name_i18n,overrides_entry_id,suppressed")
    .eq("calendar_id", calendarId)
    .order("starts_on");
  if (error) throw error;
  return (data as SchoolEntry[] | null) ?? [];
}

export interface CalendarRequest {
  action: "academic_calendar_publish" | "academic_calendar_change";
  /** The calendar (publish), the entry (update, delete) or the entry to be (add). */
  entity_id: string;
  op: "add" | "update" | "delete" | null;
  /** The MoE/regional date a change would replace or remove. */
  overrides_entry_id: string | null;
}

/**
 * The calendar's pending, unexpired requests, for every editor and checker of
 * the school (school_calendar_pending), whoever made them: RLS on
 * approval_requests shows a request only to its maker and the checkers.
 */
export async function fetchCalendarRequests(calendarId: string): Promise<CalendarRequest[]> {
  const { data, error } = await supabase.rpc("school_calendar_pending", { p_calendar_id: calendarId });
  if (error) throw error;
  return (data as CalendarRequest[] | null) ?? [];
}

export async function saveDraftEntry(calendarId: string, entryId: string | null, e: EntryInput): Promise<string> {
  const { data, error } = await supabase.rpc("save_school_calendar_entry", {
    p_calendar_id: calendarId, p_entry_id: entryId, p_day_type_code: e.day_type_code,
    p_starts_on: e.starts_on, p_ends_on: e.ends_on, p_name_i18n: e.name_i18n,
    p_overrides_entry_id: e.overrides_entry_id ?? null, p_suppressed: e.suppressed ?? false,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteDraftEntry(entryId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_school_calendar_entry", { p_entry_id: entryId });
  if (error) throw error;
}

export async function requestPublish(calendarId: string, reason: string | null): Promise<string> {
  const { data, error } = await supabase.rpc("submit_approval", {
    p_action: "academic_calendar_publish", p_entity_id: calendarId, p_changes: {}, p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

/** A change to the published calendar: add (entity = the calendar), update or delete (entity = the entry). */
export async function requestChange(
  op: "add" | "update" | "delete", entityId: string, e: EntryInput | null, reason: string | null,
): Promise<string> {
  const changes = op === "delete" || !e ? { op } : {
    op, day_type_code: e.day_type_code, starts_on: e.starts_on, ends_on: e.ends_on, name_i18n: e.name_i18n,
    overrides_entry_id: e.overrides_entry_id ?? null, suppressed: e.suppressed ?? false,
  };
  const { data, error } = await supabase.rpc("submit_approval", {
    p_action: "academic_calendar_change", p_entity_id: entityId, p_changes: changes, p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

const EDITOR_ERRORS = [
  "not_allowed", "approval_required", "approval_already_pending", "approval_not_needed", "calendar_closed",
  "invalid_name", "invalid_range", "invalid_day_type", "invalid_override", "calendar_entry_locked",
  "too_many_entries", "invalid_state", "invalid_changes", "no_change", "invalid_calendar", "already_overridden",
  "reason_too_long", "approval_action_unavailable",
] as const;
export type EditorErrorKey = (typeof EDITOR_ERRORS)[number] | "unknown";

/** The server's error code (exact match, as calendarErrorKey), or "unknown". */
export function editorErrorKey(err: unknown): EditorErrorKey {
  return exactErrorKey(err, EDITOR_ERRORS);
}
