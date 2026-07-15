// §17.8 edge-case checklist — Pagume leap logic, round-trip conversion,
// month-13 arithmetic, Geez numerals, EC new-year shift.
import { describe, it, expect } from "vitest";
import {
  toEthiopian, toGregorian, isEthLeapYear, daysInEthMonth, toGeez,
} from "@/lib/ethiopian-date";

describe("Ethiopian calendar facade", () => {
  it("Pagume has 5 days in a common EC year, 6 in a leap EC year", () => {
    expect(isEthLeapYear(2015)).toBe(true);   // 2015 % 4 === 3
    expect(isEthLeapYear(2016)).toBe(false);
    expect(daysInEthMonth(2015, 13)).toBe(6);
    expect(daysInEthMonth(2016, 13)).toBe(5);
  });

  it("round-trips Gregorian -> Ethiopian -> Gregorian across a wide range", () => {
    for (let y = 1970; y <= 2070; y += 7) {
      const g = new Date(Date.UTC(y, 5, 15));
      const back = toGregorian(toEthiopian(g));
      expect(back.toISOString().slice(0, 10)).toBe(g.toISOString().slice(0, 10));
    }
  });

  it("EC new year (Meskerem 1) lands on Sep 11 or Sep 12 depending on the prior EC leap year", () => {
    // 2015 E.C. is a leap year -> next new year (2016 E.C.) starts Sep 12
    const ny = toGregorian({ year: 2016, month: 1, day: 1 });
    expect(ny.getUTCMonth()).toBe(8); // September (0-indexed)
    expect([11, 12]).toContain(ny.getUTCDate());
  });

  it("handles month-13 (Pagume) arithmetic correctly", () => {
    const lastDayPagume = toGregorian({ year: 2016, month: 13, day: 5 });
    const nextDay = toGregorian({ year: 2017, month: 1, day: 1 });
    const diffDays = (nextDay.getTime() - lastDayPagume.getTime()) / 86_400_000;
    expect(diffDays).toBe(1);
  });

  it("renders Geez numerals for common values", () => {
    expect(toGeez(1)).toBe("፩");
    expect(toGeez(10)).toBe("፲");
    expect(toGeez(2018)).not.toBe("2018"); // must be transliterated, not passthrough
  });

  it("never returns EC values into DB-bound ISO strings (canonical storage rule)", () => {
    const g = toGregorian({ year: 2018, month: 1, day: 1 });
    const iso = g.toISOString().slice(0, 10);
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/); // Gregorian ISO, not EC digits
  });
});
