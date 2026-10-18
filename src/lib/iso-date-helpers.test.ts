// fromIsoDate / addDaysIso: stored dates are Gregorian yyyy-mm-dd read as UTC
// midnight (§17.2). A full ISO instant must not produce an Invalid Date (the
// <EthDate/> RangeError that once took a route down).
import { describe, expect, it } from "vitest";
import { addDaysIso, fromIsoDate, toIsoDate } from "./ethiopian-date";

describe("fromIsoDate / addDaysIso", () => {
  it("reads a bare date as UTC midnight", () => {
    expect(fromIsoDate("2026-09-11").toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
  it("takes only the date part of a full instant", () => {
    expect(toIsoDate(fromIsoDate("2026-10-17T15:05:12Z"))).toBe("2026-10-17");
    expect(Number.isNaN(fromIsoDate("2026-10-17T23:59:59+03:00").getTime())).toBe(false);
  });
  it("adds and subtracts days across months, years and Feb 29", () => {
    expect(addDaysIso("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysIso("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysIso("2026-10-17", 7)).toBe("2026-10-24");
  });
});
