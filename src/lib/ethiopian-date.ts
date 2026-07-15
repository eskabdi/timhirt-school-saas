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

/** Geez numerals ፩…፼ for 1..9999 (§16.5, optional per tenant). */
const G_ONES = ["", "፩", "፪", "፫", "፬", "፭", "፮", "፯", "፰", "፱"];
const G_TENS = ["", "፲", "፳", "፴", "፵", "፶", "፷", "፸", "፹", "፺"];
export function toGeez(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) return String(n);
  const pair = (v: number) => (G_TENS[fdiv(v, 10)] ?? "") + (G_ONES[mod(v, 10)] ?? "");
  const hundreds = fdiv(n, 100);
  const rest = mod(n, 100);
  let out = "";
  if (hundreds > 0) out += (hundreds > 1 ? pair(hundreds) : "") + "፻";
  out += pair(rest);
  return out || "፩";
}

export interface FormatEthOptions {
  geez?: boolean;
  monthNames: readonly string[]; // injected from i18n calendar namespace
  eraSuffix?: string;            // e.g. "ዓ.ም" / "E.C." / "ALI"
}

/** Display formatting; app code uses <EthDate/> which wires i18n in. */
export function formatEth(g: Date, opts: FormatEthOptions): string {
  const e = toEthiopian(g);
  const month = opts.monthNames[e.month - 1] ?? String(e.month);
  const day = opts.geez ? toGeez(e.day) : String(e.day);
  const year = opts.geez ? toGeez(e.year) : String(e.year);
  return `${month} ${day}, ${year}${opts.eraSuffix ? ` ${opts.eraSuffix}` : ""}`;
}

/** Today's EC date. */
export const todayEthiopian = (): EthDate => toEthiopian(new Date());

/** ISO yyyy-mm-dd for API payloads (GC canonical). */
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);
