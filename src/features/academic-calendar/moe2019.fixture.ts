// The Ministry of Education's published calendar for 2019 EC ("Academic Year
// 2019 EC, Present Academic Year"), transcribed from the sheet. It is the
// golden fixture for the grid engine and the source of the SQL seed: the
// per-month ድምር on the sheet is 9 (lead-in), 20, 21, 22, 21, 14, 20, 22, 19,
// 21, 21, – , –.
//
// The sheet's legend lists Meskerem 1, Tahsas 29, Tir 11, Yekatit 23,
// Yekatit 30, Miyazia 22, Miyazia 27 and Ginbot 08 as holidays; Meskel
// (Meskerem 17) and Labour Day (Miyazia 23) fall on a weekend that year and
// are added for completeness without changing any total. The sheet does NOT
// keep Ginbot 20 (a Friday) as a holiday: its Ginbot total of 21 counts it.
import { toGregorian } from "@/lib/ethiopian-date";
import type { GridEntry } from "./grid";

const ec = (year: number, month: number, day: number) => toGregorian({ year, month, day }).toISOString().slice(0, 10);

export const MOE_2019_SESSION = { startsOn: ec(2018, 12, 25), endsOn: ec(2019, 10, 30) };

export const MOE_2019_ENTRIES: readonly (GridEntry & { name: string })[] = [
  { id: "enkutatash",   dayTypeCode: "national_holiday",      startsOn: ec(2019, 1, 1),   endsOn: ec(2019, 1, 1),   name: "Enkutatash (New Year)" },
  { id: "opening",      dayTypeCode: "academic_year_opening", startsOn: ec(2019, 1, 4),   endsOn: ec(2019, 1, 4),   name: "First day of the first semester" },
  { id: "meskel",       dayTypeCode: "religious_holiday",     startsOn: ec(2019, 1, 17),  endsOn: ec(2019, 1, 17),  name: "Meskel" },
  { id: "genna",        dayTypeCode: "religious_holiday",     startsOn: ec(2019, 4, 29),  endsOn: ec(2019, 4, 29),  name: "Genna" },
  { id: "timket",       dayTypeCode: "religious_holiday",     startsOn: ec(2019, 5, 11),  endsOn: ec(2019, 5, 11),  name: "Timket" },
  { id: "exam-s1",      dayTypeCode: "examination",           startsOn: ec(2019, 5, 17),  endsOn: ec(2019, 5, 23),  name: "First-semester final examination" },
  { id: "break-s1",     dayTypeCode: "semester_break",        startsOn: ec(2019, 5, 24),  endsOn: ec(2019, 5, 30),  name: "Semester break" },
  { id: "adwa",         dayTypeCode: "national_holiday",      startsOn: ec(2019, 6, 23),  endsOn: ec(2019, 6, 23),  name: "Adwa Victory Day" },
  { id: "eid-al-fitr",  dayTypeCode: "religious_holiday",     startsOn: ec(2019, 6, 30),  endsOn: ec(2019, 6, 30),  name: "Eid al-Fitr" },
  { id: "siklet",       dayTypeCode: "religious_holiday",     startsOn: ec(2019, 8, 22),  endsOn: ec(2019, 8, 22),  name: "Siklet (Good Friday)" },
  { id: "labour-day",   dayTypeCode: "national_holiday",      startsOn: ec(2019, 8, 23),  endsOn: ec(2019, 8, 23),  name: "International Labour Day" },
  { id: "patriots",     dayTypeCode: "national_holiday",      startsOn: ec(2019, 8, 27),  endsOn: ec(2019, 8, 27),  name: "Patriots' Victory Day" },
  { id: "eid-al-adha",  dayTypeCode: "religious_holiday",     startsOn: ec(2019, 9, 8),   endsOn: ec(2019, 9, 8),   name: "Eid al-Adha" },
  { id: "exam-s2",      dayTypeCode: "examination",           startsOn: ec(2019, 10, 21), endsOn: ec(2019, 10, 25), name: "Second-semester final examination" },
  { id: "parents-day",  dayTypeCode: "school_holiday",        startsOn: ec(2019, 10, 30), endsOn: ec(2019, 10, 30), name: "Parents' Day" },
  { id: "closing",      dayTypeCode: "academic_year_closing", startsOn: ec(2019, 10, 30), endsOn: ec(2019, 10, 30), name: "Last day of the academic year" },
];
