import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ rpc: [] as [string, Record<string, unknown>][], or: [] as string[], from: [] as string[] }));
vi.mock("@/lib/supabase", () => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
  q.or = (f: string) => { calls.or.push(f); return q; };
  q.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
  return {
    supabase: {
      from: (t: string) => { calls.from.push(t); return q; },
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.rpc.push([fn, args]); return { data: "id", error: null }; },
    },
  };
});
import {
  calendarErrorKey, deleteDraftEntry, editorErrorKey, fetchCalendarRequests, requestChange, requestPublish, saveDraftEntry,
} from "./api";

describe("calendarErrorKey", () => {
  it("maps the RPC's bare codes", () => {
    for (const k of ["not_allowed", "invalid_origin", "invalid_year", "no_previous_calendar", "calendar_exists"]) {
      expect(calendarErrorKey({ message: k })).toBe(k);
    }
  });

  it("never matches a code inside other server text", () => {
    expect(calendarErrorKey({ message: 'column "not_allowed_x" does not exist' })).toBe("unknown");
    expect(calendarErrorKey({ message: "permission denied for function create_school_calendar" })).toBe("unknown");
    expect(calendarErrorKey(new Error("calendar_exists because…"))).toBe("unknown");
    expect(calendarErrorKey(null)).toBe("unknown");
  });
});

describe("editorErrorKey", () => {
  it("maps the authoring RPCs' and guards' bare codes", () => {
    for (const k of ["approval_required", "approval_already_pending", "calendar_closed", "calendar_entry_locked",
      "invalid_name", "invalid_range", "invalid_day_type", "too_many_entries", "approval_not_needed"]) {
      expect(editorErrorKey({ message: k })).toBe(k);
    }
  });

  it("never shows raw server text", () => {
    expect(editorErrorKey({ message: "permission denied for function save_school_calendar_entry" })).toBe("unknown");
    expect(editorErrorKey({ message: "invalid_range: extra" })).toBe("unknown");
    expect(editorErrorKey(undefined)).toBe("unknown");
  });
});

describe("authoring calls", () => {
  beforeEach(() => { calls.rpc.length = 0; calls.or.length = 0; calls.from.length = 0; });
  const entry = { day_type_code: "school_holiday", starts_on: "2026-10-20", ends_on: "2026-10-21", name_i18n: { en: "Founders" } };

  it("a draft entry goes to save_school_calendar_entry, a new one with no id", async () => {
    await saveDraftEntry("cal", null, entry);
    expect(calls.rpc).toEqual([["save_school_calendar_entry", {
      p_calendar_id: "cal", p_entry_id: null, p_day_type_code: "school_holiday", p_starts_on: "2026-10-20",
      p_ends_on: "2026-10-21", p_name_i18n: { en: "Founders" }, p_overrides_entry_id: null, p_suppressed: false,
    }]]);
  });

  it("a draft entry is deleted by id", async () => {
    await deleteDraftEntry("e1");
    expect(calls.rpc).toEqual([["delete_school_calendar_entry", { p_entry_id: "e1" }]]);
  });

  it("publishing is a maker-checker request with no changes", async () => {
    await requestPublish("cal", "Ready");
    expect(calls.rpc).toEqual([["submit_approval", {
      p_action: "academic_calendar_publish", p_entity_id: "cal", p_changes: {}, p_reason: "Ready",
    }]]);
  });

  it("a change to the published calendar names the op and only the fields the server accepts", async () => {
    await requestChange("add", "cal", { ...entry, overrides_entry_id: "m1", suppressed: true }, null);
    await requestChange("delete", "e1", null, "Wrong date");
    expect(calls.rpc).toEqual([
      ["submit_approval", { p_action: "academic_calendar_change", p_entity_id: "cal", p_reason: null, p_changes: {
        op: "add", day_type_code: "school_holiday", starts_on: "2026-10-20", ends_on: "2026-10-21",
        name_i18n: { en: "Founders" }, overrides_entry_id: "m1", suppressed: true } }],
      ["submit_approval", { p_action: "academic_calendar_change", p_entity_id: "e1", p_changes: { op: "delete" }, p_reason: "Wrong date" }],
    ]);
  });

  it("finds the calendar's pending requests by entity or by the payload's calendar", async () => {
    await fetchCalendarRequests("cal");
    expect(calls.from).toEqual(["approval_requests"]);
    expect(calls.or).toEqual(["entity_id.eq.cal,payload->>calendar_id.eq.cal"]);
  });
});
