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
// Owner decisions (2026-10-09): no Bahire Hasab, so Siklet and Fasika enter a
// calendar only as the dates the MoE publishes. Hijri holidays are optional,
// chosen by each school (settings.calendar.hijri_holidays): when on, the
// academic calendar marks Eid al-Fitr, Eid al-Adha and Mawlid as tentative
// dates from the Hijri calendar (hijriHolidaySuggestions) where the MoE has
// not published them. Suggestions are never stored and never counted.
// Generation is an explicit action, so a published calendar never drifts.
// ============================================================================
import { daysInEthMonth, toEthiopian, toGregorian, toHijri, type EthDate } from "@/lib/ethiopian-date";

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

// ------------------------------------------------- optional Hijri holidays --

export interface HijriHolidaySuggestion {
  code: "eid_al_fitr" | "eid_al_adha" | "mawlid";
  /** ISO yyyy-mm-dd, Gregorian. */
  date: string;
  ec: EthDate;
}

const HIJRI_HOLIDAYS: readonly { code: HijriHolidaySuggestion["code"]; month: number; day: number }[] = [
  { code: "eid_al_fitr", month: 10, day: 1 },
  { code: "eid_al_adha", month: 12, day: 10 },
  { code: "mawlid", month: 3, day: 12 },
];

/**
 * Tentative Islamic holidays in an EC year from the runtime's Umm al-Qura
 * calendar (Ethiopia fixes them by local moon sighting, often a day apart).
 * Only for schools that opt in; empty where the runtime has no Islamic
 * calendar. A Hijri year is ~11 days shorter, so a holiday can fall twice.
 */
export function hijriHolidaySuggestions(ecYear: number): HijriHolidaySuggestion[] {
  const { first, last } = ecYearSpan(ecYear);
  const out: HijriHolidaySuggestion[] = [];
  for (let d = first; d.getTime() <= last.getTime(); d = new Date(d.getTime() + 86_400_000)) {
    const h = toHijri(d);
    if (!h) return [];
    const hit = HIJRI_HOLIDAYS.find((r) => r.month === h.month && r.day === h.day);
    if (hit) out.push({ code: hit.code, date: iso(d), ec: toEthiopian(d) });
  }
  return out;
}
