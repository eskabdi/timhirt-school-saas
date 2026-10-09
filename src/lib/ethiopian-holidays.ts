// ============================================================================
// Fixed-date national holidays for the Academic Calendar Engine. Pure
// functions; Gregorian is canonical (§17.2), so every date is a Date pinned to
// UTC midnight and EC values are computed for display.
//
// Two kinds of rule, matching `holiday_rules.kind`:
//   ec_fixed        same EC month/day every year (Enkutatash, Timket, Adwa …)
//   gregorian_fixed same Gregorian month/day (Genna = Jan 7, Labour Day = May 1),
//                   which moves by a day in EC around a 6-day Pagume
//
// Owner decision (2026-10-09): no Bahire Hasab and no Hijri computation.
// Siklet, Fasika and the Eids move every year; they enter a calendar only as
// the dates the MoE publishes. Generation is an explicit action, so a
// published calendar never drifts.
// ============================================================================
import { daysInEthMonth, toEthiopian, toGregorian, type EthDate } from "@/lib/ethiopian-date";

/** First and last day (Gregorian) of an EC year, Meskerem 1 to the last day of Pagume. */
export function ecYearSpan(ecYear: number): { first: Date; last: Date } {
  return {
    first: toGregorian({ year: ecYear, month: 1, day: 1 }),
    last: toGregorian({ year: ecYear, month: 13, day: daysInEthMonth(ecYear, 13) }),
  };
}

export type HolidayRule =
  | { kind: "ec_fixed"; code: string; dayType: string; month: number; day: number }
  | { kind: "gregorian_fixed"; code: string; dayType: string; month: number; day: number };

export interface HolidayDraft {
  code: string;
  dayType: string;
  /** ISO yyyy-mm-dd, Gregorian. */
  date: string;
  ec: EthDate;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The fixed-date national holidays, seeded into `holiday_rules` too. */
export const NATIONAL_HOLIDAY_RULES: readonly HolidayRule[] = [
  { kind: "ec_fixed", code: "enkutatash", dayType: "national_holiday", month: 1, day: 1 },
  { kind: "ec_fixed", code: "meskel", dayType: "religious_holiday", month: 1, day: 17 },
  { kind: "gregorian_fixed", code: "genna", dayType: "religious_holiday", month: 1, day: 7 },
  { kind: "ec_fixed", code: "timket", dayType: "religious_holiday", month: 5, day: 11 },
  { kind: "ec_fixed", code: "adwa", dayType: "national_holiday", month: 6, day: 23 },
  { kind: "gregorian_fixed", code: "labour_day", dayType: "national_holiday", month: 5, day: 1 },
  { kind: "ec_fixed", code: "patriots_day", dayType: "national_holiday", month: 8, day: 27 },
  { kind: "ec_fixed", code: "derg_downfall", dayType: "national_holiday", month: 9, day: 20 },
];

/** Fixed-date holidays of an EC year from a rule set, in date order. */
export function generateHolidays(ecYear: number, rules: readonly HolidayRule[] = NATIONAL_HOLIDAY_RULES): HolidayDraft[] {
  const { first, last } = ecYearSpan(ecYear);
  const inYear = (d: Date) => d.getTime() >= first.getTime() && d.getTime() <= last.getTime();
  const out: HolidayDraft[] = [];
  const push = (rule: HolidayRule, d: Date) => out.push({ code: rule.code, dayType: rule.dayType, date: iso(d), ec: toEthiopian(d) });
  for (const rule of rules) {
    if (rule.kind === "ec_fixed") {
      if (rule.day <= daysInEthMonth(ecYear, rule.month)) push(rule, toGregorian({ year: ecYear, month: rule.month, day: rule.day }));
    } else {
      // The EC year spans two Gregorian years; the date falls in exactly one.
      for (const gy of [ecYear + 7, ecYear + 8]) {
        const d = new Date(Date.UTC(gy, rule.month - 1, rule.day));
        if (inYear(d)) push(rule, d);
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
}
