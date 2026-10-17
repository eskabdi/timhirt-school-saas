import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
import { calendarErrorKey } from "./api";

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
