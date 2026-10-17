// The page renders the database's day types (colours included), while the
// contrast test and the grid engine's tests read this TypeScript copy: the
// two must not drift (CAL-TV-06). Compares every seeded row of
// calendar_day_types in the engine migration with DAY_TYPES.
import { describe, expect, it } from "vitest";
import migration from "../../../supabase/migrations/20261008000001_academic_calendar_engine.sql?raw";
import { DAY_TYPES } from "./dayTypes";

const seeded = () => {
  const block = migration.split("insert into public.calendar_day_types")[1]!.split(";")[0]!;
  const row = /\('(\w+)',\s*'\{.*?\}',\s*'(#[0-9a-f]{6})',\s*'(\w+)',\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(true|false),\s*(\d+)\)/g;
  return [...block.matchAll(row)].map((m) => ({
    code: m[1], color: m[2], category: m[3], countsAsInstructional: m[4] === "true",
    blocksStudentAttendance: m[5] === "true", blocksStaffAttendance: m[6] === "true",
    lockable: m[7] === "true", authorityOnly: m[8] === "true", derived: m[9] === "true", order: Number(m[10]),
  }));
};

describe("day-type catalogue parity", () => {
  it("DAY_TYPES matches the SQL seed row for row (code, colour, category, flags, order)", () => {
    const sql = seeded();
    expect(sql).toHaveLength(18);
    expect(sql.map((r) => ({ ...r, order: undefined }))).toEqual(DAY_TYPES.map((d) => ({
      code: d.code, color: d.color, category: d.category, countsAsInstructional: d.countsAsInstructional,
      blocksStudentAttendance: d.blocksStudentAttendance, blocksStaffAttendance: d.blocksStaffAttendance,
      lockable: d.lockable, authorityOnly: d.authorityOnly, derived: d.derived, order: undefined,
    })));
    expect(sql.map((r) => r.order)).toEqual(sql.map((_, i) => i + 1));
  });
});
