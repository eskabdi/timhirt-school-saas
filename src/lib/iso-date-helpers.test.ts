// fromIsoDate / addDaysIso: stored dates are Gregorian yyyy-mm-dd read as UTC
// midnight (§17.2). A full ISO instant must not produce an Invalid Date (the
// <EthDate/> RangeError that once took a route down).
import { describe, expect, it } from "vitest";
import { addDaysIso, fromIsoDate, toIsoDate } from "./ethiopian-date";

describe("fromIsoDate / addDaysIso", () => {
  it("reads a bare date as UTC midnight", () => {
    expect(fromIsoDate("2026-09-11").toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
  it("reads a full instant as an instant and keeps its UTC day, as <EthDate/> does", () => {
    expect(toIsoDate(fromIsoDate("2026-10-17T15:05:12Z"))).toBe("2026-10-17");
    expect(toIsoDate(fromIsoDate("2026-10-17T01:00:00+03:00"))).toBe("2026-10-16"); // 2026-10-16T22:00Z
    expect(fromIsoDate("2026-10-17T15:05:12Z").toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });
  it("rejects malformed input", () => {
    for (const bad of ["2026-10-17garbage", "2026-10-170", "17/10/2026", ""]) {
      expect(Number.isNaN(fromIsoDate(bad).getTime())).toBe(true);
    }
  });
  it("adds and subtracts days across months, years and Feb 29", () => {
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-10-17", 7)).toBe("2026-10-24");
  });
});
