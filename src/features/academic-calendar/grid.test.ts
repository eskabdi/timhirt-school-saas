import { describe, expect, it } from "vitest";
import { buildYearGrid, GRID_COLUMNS, type GridCell } from "./grid";
import { DAY_TYPES } from "./dayTypes";
import { MOE_2019_ENTRIES, MOE_2019_SESSION } from "./moe2019.fixture";

const grid = buildYearGrid({
  ecYear: 2019,
  sessionStartsOn: MOE_2019_SESSION.startsOn,
  sessionEndsOn: MOE_2019_SESSION.endsOn,
  entries: MOE_2019_ENTRIES,
  dayTypes: DAY_TYPES,
});
const cell = (month: number, day: number): GridCell =>
  grid.rows.find((r) => r.kind === "month" && r.ecMonth === month)!.cells.find((c) => c?.ecDay === day)!;

describe("buildYearGrid — MoE 2019 EC golden sheet", () => {
  it("reproduces the ድምር column cell for cell", () => {
    expect(grid.rows.map((r) => r.total)).toEqual([9, 20, 21, 22, 21, 14, 20, 22, 19, 21, 21, null, null]);
    expect(grid.total).toBe(210);
  });

  it("has a lead-in row (Nehase 25 – Pagume 5, 2018) and no Pagume 2019 row", () => {
    const lead = grid.rows[0]!;
    expect(lead.kind).toBe("lead_in");
    expect([lead.ecYear, lead.ecMonth]).toEqual([2018, 12]);
    const days = lead.cells.filter(Boolean).map((c) => `${c!.ecMonth}/${c!.ecDay}`);
    expect(days).toEqual(["12/25", "12/26", "12/27", "12/28", "12/29", "12/30", "13/1", "13/2", "13/3", "13/4", "13/5"]);
    expect(grid.rows.some((r) => r.kind === "month" && r.ecMonth === 13)).toBe(false);
  });

  it("puts each day under its weekday, as on the sheet", () => {
    expect(grid.header).toHaveLength(GRID_COLUMNS);
    const col = (month: number, day: number) =>
      grid.rows.find((r) => r.kind === "month" && r.ecMonth === month)!.cells.findIndex((c) => c?.ecDay === day);
    expect(col(1, 1)).toBe(4);  // Meskerem 1, 2019 is a Friday (ዓ)
    expect(col(2, 1)).toBe(6);  // Tikimt 1 a Sunday (እ)
    expect(col(3, 1)).toBe(1);  // Hidar 1 a Tuesday (ማ)
    expect(col(5, 1)).toBe(5);  // Tir 1 a Saturday (ቅ)
    expect(grid.rows[0]!.cells.findIndex(Boolean)).toBe(21); // the lead-in starts in the 4th Monday column
    for (const r of grid.rows) for (const [i, c] of r.cells.entries()) if (c) expect(c.weekday).toBe(grid.header[i]);
  });

  it("classifies days by precedence", () => {
    expect(cell(1, 1).dayType).toBe("national_holiday");
    expect(cell(1, 17).dayType).toBe("religious_holiday"); // Meskel on a Sunday: holiday over weekend
    expect(cell(5, 18).dayType).toBe("examination");
    expect(cell(5, 18).counts).toBe(true);                 // exam days are school days
    expect(cell(5, 22).dayType).toBe("examination");       // exam on a Saturday shows as exam
    expect(cell(5, 22).counts).toBe(false);                // ... but is not counted
    expect(cell(5, 25).dayType).toBe("semester_break");
    expect(cell(5, 25).counts).toBe(false);
    expect(cell(10, 30).dayType).toBe("school_holiday");   // Parents' Day beats the closing milestone
    expect(cell(11, 1).dayType).toBe("out_of_session");
    expect(cell(1, 5).dayType).toBe("instructional");
  });

  it("honours a different weekend", () => {
    const sixDay = buildYearGrid({
      ecYear: 2019, sessionStartsOn: MOE_2019_SESSION.startsOn, sessionEndsOn: MOE_2019_SESSION.endsOn,
      entries: MOE_2019_ENTRIES, dayTypes: DAY_TYPES, weekendDays: [7],
    });
    expect(sixDay.total).toBeGreaterThan(grid.total);
    expect(sixDay.rows[1]!.cells.find((c) => c?.ecDay === 5)?.dayType).toBe("instructional"); // Meskerem 5 is a Tuesday either way
  });

  it("marks today", () => {
    const g = buildYearGrid({
      ecYear: 2019, sessionStartsOn: MOE_2019_SESSION.startsOn, sessionEndsOn: MOE_2019_SESSION.endsOn,
      entries: [], dayTypes: DAY_TYPES, today: "2026-09-14",
    });
    const todays = g.rows.flatMap((r) => r.cells).filter((c) => c?.isToday);
    expect(todays.map((c) => `${c!.ecMonth}/${c!.ecDay}`)).toEqual(["1/4"]);
  });
});

describe("buildYearGrid — optional Hijri (the school's choice)", () => {
  const base = {
    ecYear: 2019, sessionStartsOn: MOE_2019_SESSION.startsOn, sessionEndsOn: MOE_2019_SESSION.endsOn,
    entries: MOE_2019_ENTRIES, dayTypes: DAY_TYPES,
  };

  it("adds no Hijri data unless the school asks for it", () => {
    const cells = buildYearGrid(base).rows.flatMap((r) => r.cells).filter(Boolean);
    expect(cells.every((c) => c!.hijri === null && c!.tentative.length === 0)).toBe(true);
  });

  it("shows each day's Hijri date when enabled", () => {
    const g = buildYearGrid({ ...base, showHijri: true });
    const h = g.rows.find((r) => r.kind === "month" && r.ecMonth === 1)!.cells.find((c) => c?.ecDay === 1)!.hijri;
    expect(h?.month).toBe(3); // Meskerem 1, 2019 (2026-09-11) is in Rabi al-Awwal 1448
  });

  it("marks tentative Hijri holidays, drops ones the MoE published, and never counts them", () => {
    const g = buildYearGrid({
      ...base,
      tentativeHolidays: [
        { code: "eid_al_fitr", date: "2027-03-10" }, // a day off the MoE's Yekatit 30 (2027-03-09): dropped
        { code: "mawlid", date: "2026-08-25" },      // before the session, outside the grid's months
        { code: "eid_al_adha", date: "2027-07-20" }, // no published holiday near it: kept
      ],
    });
    const marked = g.rows.flatMap((r) => r.cells).filter((c) => c && c.tentative.length);
    expect(marked.map((c) => [c!.isoDate, c!.tentative])).toEqual([["2027-07-20", ["eid_al_adha"]]]);
    expect(g.total).toBe(210);
  });
});
