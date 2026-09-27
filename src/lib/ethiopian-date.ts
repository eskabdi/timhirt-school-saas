// ============================================================================
// Ethiopian calendar facade (§17.3) — the ONLY module app code may use for
// EC↔GC work. Pure Beyene–Kudlek arithmetic (kenat-compatible surface, zero
// runtime dependency). Canonical storage rule (§17.2): Postgres stores
// Gregorian only; EC values are presentation-only.
// ============================================================================

export interface EthDate {
  year: number;
  month: number; // 1..13 (13 = Pagume, ጳጉሜን)
  day: number;
}

const ERA = 1723856; // Amete Mihret (ዓ.ም) JDN offset
const fdiv = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => ((a % b) + b) % b;

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = fdiv(14 - m, 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + fdiv(153 * mm + 2, 5) + 365 * yy + fdiv(yy, 4) - fdiv(yy, 100) + fdiv(yy, 400) - 32045;
}

function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  const a = jdn + 32044;
  const b = fdiv(4 * a + 3, 146097);
  const c = a - fdiv(146097 * b, 4);
  const dd = fdiv(4 * c + 3, 1461);
  const e = c - fdiv(1461 * dd, 4);
  const mm = fdiv(5 * e + 2, 153);
  return {
    d: e - fdiv(153 * mm + 2, 5) + 1,
    m: mm + 3 - 12 * fdiv(mm, 10),
    y: 100 * b + dd - 4800 + fdiv(mm, 10),
  };
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

/** Gregorian Date → Ethiopian calendar date (UTC-based, date-only). */
export function toEthiopian(g: Date): EthDate {
  return jdnToEthiopic(gregorianToJdn(g.getUTCFullYear(), g.getUTCMonth() + 1, g.getUTCDate()));
}

/** Ethiopian date → Gregorian Date (UTC midnight). */
export function toGregorian(e: EthDate): Date {
  const { y, m, d } = jdnToGregorian(ethiopicToJdn(e));
  return new Date(Date.UTC(y, m - 1, d));
}

/** §17.8: Pagume has 6 days when ey % 4 === 3. */
export const isEthLeapYear = (ey: number): boolean => mod(ey, 4) === 3;

export const daysInEthMonth = (ey: number, m: number): number =>
  m === 13 ? (isEthLeapYear(ey) ? 6 : 5) : 30;

/**
 * Digit systems a tenant can pick (Settings → Calendar). Western Arabic
 * (0-9) is the default and the project rule; Eastern Arabic-Indic (٠-٩) is an
 * opt-in for schools that teach in Arabic. Ge'ez numerals are not offered
 * (owner rule, fix plan §0 Rule 8; the old tenant toggle was removed in R6).
 */
export type NumeralSystem = "latn" | "arab";

const ARABIC_INDIC = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Rewrites every ASCII digit in `s` in the chosen system. */
export function formatDigits(s: string | number, numerals: NumeralSystem = "latn"): string {
  const str = String(s);
  return numerals === "arab" ? str.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)] ?? d) : str;
}

export interface FormatEthOptions {
  numerals?: NumeralSystem;
  monthNames: readonly string[]; // injected from i18n calendar namespace
  eraSuffix?: string;            // e.g. "ዓ.ም" / "E.C." / "ALI"
}

/** Display formatting; app code uses <EthDate/> which wires i18n in. */
export function formatEth(g: Date, opts: FormatEthOptions): string {
  const e = toEthiopian(g);
  const month = opts.monthNames[e.month - 1] ?? String(e.month);
  const n = (v: number) => formatDigits(v, opts.numerals);
  return `${month} ${n(e.day)}, ${n(e.year)}${opts.eraSuffix ? ` ${opts.eraSuffix}` : ""}`;
}

/** A Hijri (Islamic, Umm al-Qura) calendar date. */
export interface HijriDate { year: number; month: number; day: number }

// One formatter for the whole app (EthDate renders it in large tables):
// undefined = not built yet, null = the runtime has no Islamic calendar.
let hijriFormatter: Intl.DateTimeFormat | null | undefined;
function getHijriFormatter(): Intl.DateTimeFormat | null {
  if (hijriFormatter === undefined) {
    try {
      hijriFormatter = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
        timeZone: "UTC", year: "numeric", month: "numeric", day: "numeric",
      });
    } catch {
      hijriFormatter = null;
    }
  }
  return hijriFormatter;
}

/**
 * Gregorian → Hijri through the platform's ICU (`islamic-umalqura`, the
 * tabular-astronomical calendar Saudi Arabia publishes; local moon sighting
 * can differ by a day). Reads the Date's UTC calendar day, like toEthiopian
 * (§17.2). Returns null where the runtime has no Islamic calendar support, so
 * callers simply omit the Hijri line.
 */
export function toHijri(g: Date): HijriDate | null {
  const fmt = getHijriFormatter();
  if (!fmt || Number.isNaN(g.getTime())) return null;
  const parts = fmt.formatToParts(g);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const out = { year: get("year"), month: get("month"), day: get("day") };
  const ok = [out.year, out.month, out.day].every(Number.isInteger) && out.month >= 1 && out.month <= 12;
  return ok ? out : null;
}

/**
 * The Gregorian equivalent as DD/MM/YYYY, the way it is written in Ethiopia,
 * with no locale month names (so it reads the same in en/am/om) and the
 * tenant's digit system. Reads UTC fields (§17.2).
 */
export function formatGregorian(g: Date, numerals: NumeralSystem = "latn"): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return formatDigits(`${pad(g.getUTCDate())}/${pad(g.getUTCMonth() + 1)}/${g.getUTCFullYear()}`, numerals);
}

export interface FormatHijriOptions {
  numerals?: NumeralSystem;
  monthNames: readonly string[]; // 12 names, calendar namespace `hijriMonths`
  eraSuffix?: string;            // e.g. "AH"
}

export function formatHijri(g: Date, opts: FormatHijriOptions): string | null {
  const h = toHijri(g);
  if (!h) return null;
  const month = opts.monthNames[h.month - 1] ?? String(h.month);
  const n = (v: number) => formatDigits(v, opts.numerals);
  return `${month} ${n(h.day)}, ${n(h.year)}${opts.eraSuffix ? ` ${opts.eraSuffix}` : ""}`;
}

/**
 * "Today" as a calendar date, pinned to UTC midnight from the *local*
 * Y/M/D — not `new Date()` itself.
 *
 * `toEthiopian`/`formatEth`/`<EthDate/>` all read a Date's UTC fields,
 * by design (§17.2 canonical storage: a stored date is pinned to UTC
 * midnight so EC conversion can't slip a day). But `new Date()` returns
 * the current *instant*, and its UTC fields are the calendar day in
 * UTC — not in the browser's local timezone. Ethiopia is UTC+3, so for
 * the three hours after local midnight (21:00-24:00 UTC), UTC is still
 * on yesterday's date: `toEthiopian(new Date())` reports yesterday's EC
 * date, `<EthDate value={new Date()}/>` mis-highlights "today" in every
 * calendar widget, and documents stamped with `formatEth(new Date(), …)`
 * get issued with yesterday's date. This pins the *local* Y/M/D instead,
 * so those UTC-field readers see the day the user is actually living in.
 */
export const today = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
};

/** Today's EC date. */
export const todayEthiopian = (): EthDate => toEthiopian(today());

/** ISO yyyy-mm-dd for API payloads (GC canonical). */
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
