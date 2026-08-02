import { describe, it, expect } from "vitest";
import { generateTimetable, type GenExistingSlot, type GenPeriod, type GenRequirement } from "@/features/timetable/generateTimetable";

const PERIODS: GenPeriod[] = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];
const DAYS = [2, 3, 4, 5, 6]; // Mon-Fri

describe("generateTimetable", () => {
  it("places every ticket for a single, uncontended requirement", () => {
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 3 },
    ];
    const { placements, unplaced } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    expect(placements).toHaveLength(3);
    expect(unplaced).toHaveLength(0);
  });

  it("never produces two placements for the same teacher in the same (day, period)", () => {
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 4 },
      { classId: "c2", subjectId: "math", teacherId: "t1", periodsPerWeek: 4 },
    ];
    const { placements } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    const seen = new Set<string>();
    for (const p of placements) {
      const key = `${p.teacherId}|${p.dayOfWeek}|${p.periodId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("never produces two placements for the same class in the same (day, period)", () => {
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 5 },
      { classId: "c1", subjectId: "english", teacherId: "t2", periodsPerWeek: 5 },
    ];
    const { placements } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    const seen = new Set<string>();
    for (const p of placements) {
      const key = `${p.classId}|${p.dayOfWeek}|${p.periodId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("fills gaps only -- never proposes a placement into an already-occupied cell", () => {
    const existingSlots: GenExistingSlot[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", dayOfWeek: 2, periodId: "p1" },
    ];
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 4 },
    ];
    const { placements } = generateTimetable({ requirements, periods: PERIODS, days: [2], existingSlots });
    // Only 3 free periods remain on the one day allowed (p2, p3, p4) -- the
    // engine must never re-propose the already-occupied p1.
    expect(placements.some((p) => p.dayOfWeek === 2 && p.periodId === "p1")).toBe(false);
    expect(placements).toHaveLength(3);
  });

  it("treats periodsPerWeek as the target total, not an additive amount -- nets out slots already placed for that class+subject", () => {
    const existingSlots: GenExistingSlot[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", dayOfWeek: 2, periodId: "p1" },
    ];
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 4 },
    ];
    const { placements } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots });
    // 1 already placed + 3 new placements = 4 total, matching the target --
    // not 4 new placements piled on top of the existing one.
    expect(placements).toHaveLength(3);
  });

  it("places nothing when the target is already met", () => {
    const existingSlots: GenExistingSlot[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", dayOfWeek: 2, periodId: "p1" },
      { classId: "c1", subjectId: "math", teacherId: "t1", dayOfWeek: 3, periodId: "p1" },
    ];
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 2 },
    ];
    const { placements, unplaced } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots });
    expect(placements).toHaveLength(0);
    expect(unplaced).toHaveLength(0);
  });

  it("reports unplaced instead of throwing when a requirement cannot fit in the grid", () => {
    // Only 4 periods x 5 days = 20 cells for this teacher; asking for more
    // than fits (given they're also needed for another class) must not throw.
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 20 },
      { classId: "c2", subjectId: "math", teacherId: "t1", periodsPerWeek: 5 },
    ];
    expect(() => generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] })).not.toThrow();
    const { placements, unplaced } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    expect(placements.length).toBeLessThanOrEqual(20);
    const totalUnplaced = unplaced.reduce((sum, u) => sum + u.missing, 0);
    expect(totalUnplaced).toBeGreaterThan(0);
    expect(placements.length + totalUnplaced).toBe(25); // 20 + 5 requested
  });

  it("spreads a subject's periods across different days when the grid allows it", () => {
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 4 },
    ];
    const { placements } = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    const daysUsed = new Set(placements.map((p) => p.dayOfWeek));
    // 4 periods across 5 available days with no contention: each should land
    // on its own day rather than clustering onto one.
    expect(daysUsed.size).toBe(4);
  });

  it("is deterministic given the same input", () => {
    const requirements: GenRequirement[] = [
      { classId: "c1", subjectId: "math", teacherId: "t1", periodsPerWeek: 3 },
      { classId: "c2", subjectId: "english", teacherId: "t2", periodsPerWeek: 2 },
    ];
    const run1 = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    const run2 = generateTimetable({ requirements, periods: PERIODS, days: DAYS, existingSlots: [] });
    expect(run1).toEqual(run2);
  });
});
