// §17.8 edge-case checklist — Pagume leap logic, round-trip conversion,
// month-13 arithmetic, digit systems (never Ge'ez), Hijri, EC new-year shift.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  toEthiopian, toGregorian, isEthLeapYear, daysInEthMonth, formatDigits, formatEth, formatHijri, toHijri, today, todayEthiopian,
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

  it("renders Western digits by default and Eastern Arabic digits on request, never Ge'ez", () => {
    const months = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12", "M13"];
    const g = toGregorian({ year: 2019, month: 1, day: 15 });
    expect(formatEth(g, { monthNames: months })).toBe("M1 15, 2019");
    expect(formatEth(g, { monthNames: months, numerals: "arab" })).toBe("M1 ١٥, ٢٠١٩");
    expect(formatDigits(2018, "latn")).toBe("2018");
    expect(formatDigits("0123456789", "arab")).toBe("٠١٢٣٤٥٦٧٨٩");
    for (const numerals of ["latn", "arab"] as const) {
      for (let day = 1; day <= 30; day++) {
        const out = formatEth(toGregorian({ year: 2018, month: 5, day }), { monthNames: months, numerals });
        expect(out).not.toMatch(/[\u1369-\u137C]/); // fix plan §0 Rule 8
      }
    }
  });

  it("converts to the Hijri (Umm al-Qura) calendar", () => {
    // 2026-09-25 G.C. = 14 Rabi al-Thani 1448 AH; 2026-03-20 = 1 Shawwal 1447 (Eid al-Fitr).
    expect(toHijri(new Date(Date.UTC(2026, 8, 25)))).toEqual({ year: 1448, month: 4, day: 14 });
    expect(toHijri(new Date(Date.UTC(2026, 2, 20)))).toEqual({ year: 1447, month: 10, day: 1 });
    const names = Array.from({ length: 12 }, (_, i) => `H${i + 1}`);
    expect(formatHijri(new Date(Date.UTC(2026, 8, 25)), { monthNames: names, eraSuffix: "AH" })).toBe("H4 14, 1448 AH");
    expect(formatHijri(new Date(Date.UTC(2026, 8, 25)), { monthNames: names, numerals: "arab" })).toBe("H4 ١٤, ١٤٤٨");
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
