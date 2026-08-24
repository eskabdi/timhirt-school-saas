// §17.8 edge-case checklist — Pagume leap logic, round-trip conversion,
// month-13 arithmetic, Geez numerals, EC new-year shift.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toEthiopian, toGregorian, isEthLeapYear, daysInEthMonth, toGeez, today, todayEthiopian,
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

  describe("today() / todayEthiopian() — local-day pinning", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    it("does not fall back a day for a browser in Addis Ababa just after local midnight", () => {
      // 2026-08-24T21:30:00Z is 2026-08-25 00:30 in Africa/Addis_Ababa
      // (UTC+3, no DST). A naive `toEthiopian(new Date())` reads UTC
      // fields and reports the 24th -- yesterday, from the user's seat.
      vi.stubEnv("TZ", "Africa/Addis_Ababa");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-24T21:30:00.000Z"));

      const t = today();
      expect(t.getUTCFullYear()).toBe(2026);
      expect(t.getUTCMonth()).toBe(7); // August, 0-indexed
      expect(t.getUTCDate()).toBe(25); // local calendar day, not UTC's 24th

      // The naive/buggy path this regresses: toEthiopian(new Date()).
      const buggy = toEthiopian(new Date());
      const fixed = todayEthiopian();
      expect(fixed).not.toEqual(buggy);
      expect(fixed).toEqual(toEthiopian(new Date(Date.UTC(2026, 7, 25))));
    });

    it("today() is always local midnight UTC, not the raw current instant", () => {
      vi.stubEnv("TZ", "Africa/Addis_Ababa");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-15T14:23:45.678Z"));
      const t = today();
      expect(t.getUTCHours()).toBe(0);
      expect(t.getUTCMinutes()).toBe(0);
      expect(t.getUTCSeconds()).toBe(0);
      expect(t.getUTCMilliseconds()).toBe(0);
    });
  });
});
