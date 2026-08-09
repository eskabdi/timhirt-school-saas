// ============================================================================
// Ethiopian calendar facade for Deno Edge Functions (§17.7).
// Pure Beyene–Kudlek arithmetic; identical results to src/lib/ethiopian-date.ts.
// Canonical storage rule: everything persisted is Gregorian.
// ============================================================================
export interface EthDate { year: number; month: number; day: number } // month 1..13

const ERA = 1723856; // Amete Mihret JDN offset
const fdiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = fdiv(14 - m, 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
  return d + fdiv(153 * mm + 2, 5) + 365 * yy + fdiv(yy, 4) - fdiv(yy, 100) + fdiv(yy, 400) - 32045;
}
function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  const a = jdn + 32044, b = fdiv(4 * a + 3, 146097), c = a - fdiv(146097 * b, 4);
  const dd = fdiv(4 * c + 3, 1461), e = c - fdiv(1461 * dd, 4), mm = fdiv(5 * e + 2, 153);
  return { d: e - fdiv(153 * mm + 2, 5) + 1, m: mm + 3 - 12 * fdiv(mm, 10), y: 100 * b + dd - 4800 + fdiv(mm, 10) };
}
function ethiopicToJdn(e: EthDate): number {
  return ERA + 365 + 365 * (e.year - 1) + fdiv(e.year, 4) + 30 * e.month + e.day - 31;
}
function jdnToEthiopic(jdn: number): EthDate {
  const r = mod(jdn - ERA, 1461);
  const n = mod(r, 365) + 365 * fdiv(r, 1460);
  return {
    year: 4 * fdiv(jdn - ERA, 1461) + fdiv(r, 365) - fdiv(r, 1460),
    month: fdiv(n, 30) + 1,
    day: mod(n, 30) + 1,
  };
}

export const toEthiopian = (g: Date): EthDate =>
  jdnToEthiopic(gregorianToJdn(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate()));

export const toGregorian = (e: EthDate): Date => {
  const { y, m, d } = jdnToGregorian(ethiopicToJdn(e));
  return new Date(Date.UTC(y, m - 1, d));
};

export const isEthLeapYear = (ey: number) => mod(ey, 4) === 3;
export const daysInEthMonth = (ey: number, m: number) =>
  m === 13 ? (isEthLeapYear(ey) ? 6 : 5) : 30;

/** Gregorian [start, end] span of one EC month — used for payroll periods. */
export function ecMonthSpan(ecYear: number, ecMonth: number): { start: Date; end: Date } {
  const start = toGregorian({ year: ecYear, month: ecMonth, day: 1 });
  const end = toGregorian({ year: ecYear, month: ecMonth, day: daysInEthMonth(ecYear, ecMonth) });
  return { start, end };
}
