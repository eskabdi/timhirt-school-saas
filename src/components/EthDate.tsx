// Display-only EC date (§17.4). Ad-hoc toLocaleDateString is banned by lint;
// every rendered date goes through this component or formatEth.
import { useTranslation } from "react-i18next";
import { formatEth, formatHijri, type NumeralSystem } from "@/lib/ethiopian-date";
import { useCalendarPrefs } from "@/features/settings/useCalendarPrefs";

/**
 * Coerces whatever a caller has into a valid Date, or null.
 *
 * This used to be `new Date(value + "T00:00:00Z")` for every string, which
 * quietly required each caller to hand over a bare YYYY-MM-DD. Feed it a
 * timestamptz — `2026-07-26T10:30:00+00:00`, which is what every `*_at` column
 * returns — and you got `...+00:00T00:00:00Z`, an Invalid Date, and a
 * RangeError out of toISOString that the router's error boundary turned into a
 * full-page "Unexpected Application Error". A date on a page is not worth the
 * page.
 *
 * Most call sites had independently discovered the trap and were writing
 * `.slice(0, 10)` or `new Date(x)` at the call site to work around it; three
 * had not. Accepting both shapes here fixes those and removes the trap.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // A bare YYYY-MM-DD is a calendar date, not an instant. Pin it to UTC
  // midnight so the EC conversion (which reads UTC parts) can't slip a day.
  // Anything else is already a full ISO-8601 instant — parse it as-is.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function EthDate({ value, numerals }: {
  value: Date | string | null | undefined;
  // Explicit prop still wins (e.g. a caller intentionally forcing one
  // system); omitted, it falls back to the tenant's configured preference.
  numerals?: NumeralSystem;
}) {
  const { t } = useTranslation("calendar");
  const prefs = useCalendarPrefs();
  const months = t("months", { returnObjects: true }) as string[];
  const d = toDate(value);
  // Missing or unparseable: render the placeholder the tables already use for
  // absent values rather than taking the whole route down.
  if (!d) return <span className="text-ink-faint">—</span>;
  const digits = numerals ?? prefs.numerals;
  const iso = d.toISOString().slice(0, 10);
  const hijri = prefs.showHijri
    ? formatHijri(d, { monthNames: t("hijriMonths", { returnObjects: true }) as string[], eraSuffix: t("hijriEraSuffix"), numerals: digits })
    : null;
  return (
    <time dateTime={iso} title={prefs.secondaryVisible ? t("gregorianEquivalent", { date: iso }) : undefined}>
      {formatEth(d, { monthNames: months, eraSuffix: t("eraSuffix"), numerals: digits })}
      {hijri && <span className="text-ink-faint"> · {hijri}</span>}
    </time>
  );
}
