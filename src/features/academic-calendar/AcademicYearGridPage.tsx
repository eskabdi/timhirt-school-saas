// The academic calendar as the Ministry of Education prints it: one row per
// EC month (plus the lead-in of the previous year), 37 weekday columns
// Monday-first, each day coloured by its type, and the ድምር column of school
// days. Read-only in slice 1, plus "Choose Calendar" for a year the school has
// not set up. The layers (MoE → region → school) are resolved on the server
// (effective_calendar_entries); buildYearGrid only lays them out.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";
import { useCalendarPrefs } from "@/features/settings/useCalendarPrefs";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { tField } from "@/lib/i18n";
import { formatDigits, toIsoDate, today, todayEthiopian, type NumeralSystem } from "@/lib/ethiopian-date";
import { hijriHolidaySuggestions } from "@/lib/ethiopian-holidays";
import { buildYearGrid, GRID_COLUMNS, type GridCell } from "./grid";
import {
  calendarErrorKey, createSchoolCalendar, fetchAuthorities, fetchDayTypes, fetchEffectiveEntries, fetchYearSettings,
  toGridDayTypes, toGridEntries, type CalendarOrigin, type CreateCalendarResult, type DayTypeRow, type EffectiveEntry,
} from "./api";

/** Dark text on light fills, white on dark ones (WCAG contrast on the type colour). */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.4 ? "#1f2937" : "#ffffff";
}

const OUT_OF_SESSION = "#f3f4f6";

export function AcademicYearGridPage() {
  const { t, i18n } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();
  const prefs = useCalendarPrefs();
  const lang = i18n.resolvedLanguage ?? "en";
  const digits: NumeralSystem = prefs.numerals;
  const num = (v: number) => formatDigits(v, digits);
  const currentYear = useMemo(() => todayEthiopian().year, []);
  const [year, setYear] = useState(currentYear);
  const [selected, setSelected] = useState<GridCell | null>(null);

  const settings = useQuery({ queryKey: ["academic-calendar", "settings", year], queryFn: () => fetchYearSettings(year) });
  const entries = useQuery({ queryKey: ["academic-calendar", "entries", year], queryFn: () => fetchEffectiveEntries(year) });
  const dayTypes = useQuery({ queryKey: ["academic-calendar", "day-types"], queryFn: fetchDayTypes, staleTime: 3_600_000 });
  const authorities = useQuery({ queryKey: ["academic-calendar", "authorities"], queryFn: fetchAuthorities, staleTime: 3_600_000 });

  const s = settings.data;
  const typeByCode = useMemo(() => new Map((dayTypes.data ?? []).map((d) => [d.code, d])), [dayTypes.data]);
  const entryById = useMemo(() => new Map((entries.data ?? []).map((e) => [e.entry_id, e])), [entries.data]);

  const grid = useMemo(() => {
    if (!s?.session_starts_on || !s.session_ends_on || !dayTypes.data || !entries.data) return null;
    return buildYearGrid({
      ecYear: year,
      sessionStartsOn: s.session_starts_on,
      sessionEndsOn: s.session_ends_on,
      entries: toGridEntries(entries.data),
      dayTypes: toGridDayTypes(dayTypes.data),
      weekendDays: s.weekend_days,
      today: toIsoDate(today()),
      showHijri: prefs.showHijri,
      tentativeHolidays: prefs.hijriHolidays ? hijriHolidaySuggestions(year) : [],
    });
  }, [s, dayTypes.data, entries.data, year, prefs.showHijri, prefs.hijriHolidays]);

  const loading = settings.isPending || entries.isPending || dayTypes.isPending;
  const failed = settings.isError || entries.isError || dayTypes.isError;
  const months = tc("months", { returnObjects: true }) as string[];
  const weekdays = tc("weekdaysShort", { returnObjects: true }) as string[]; // Sunday-first
  const weekdayLabel = (mondayFirst: number) => weekdays[(mondayFirst + 1) % 7] ?? "";
  const hijriMonths = tc("hijriMonths", { returnObjects: true }) as string[];
  const typeLabel = (code: string) =>
    typeByCode.get(code) ? tField(typeByCode.get(code)!.label_i18n, lang) : t(`academicCalendar.derived.${code}`, { defaultValue: code });
  const status = s?.school_status ?? null;
  const canChoose = profile?.role === "school_admin" && s !== undefined && !s?.school_calendar_id && Math.abs(year - currentYear) <= 1;
  const authorityName = (code: string) => tField(authorities.data?.find((a) => a.code === code)?.name_i18n, lang) || code;
  const source = authorityName(s?.region_code ?? "MOE");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("academicCalendar.title")}</h1>
          <p className="text-sm text-ink-soft">{t("academicCalendar.follows", { source })}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink" htmlFor="ac-year">{t("academicCalendar.year")}</label>
          <select id="ac-year" value={year} onChange={(e) => { setYear(Number(e.target.value)); setSelected(null); }}
            className="rounded-control border border-line bg-card px-3 py-2 text-sm text-ink">
            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
              <option key={y} value={y}>{num(y)} {tc("eraSuffix")}</option>
            ))}
          </select>
          <Badge tone={status === "closed" ? "neutral" : year === currentYear ? "ok" : "navy"}>
            {status === "closed" ? t("academicCalendar.status.closed")
              : status === "draft" ? t("academicCalendar.status.draft")
              : year === currentYear ? t("academicCalendar.status.present") : t("academicCalendar.status.other")}
          </Badge>
        </div>
      </div>

      {failed && <p role="alert" className="text-sm text-danger">{t("academicCalendar.loadFailed")}</p>}
      {loading && <p className="text-sm text-ink-soft">{t("academicCalendar.loading")}</p>}
      {canChoose && <ChooseCalendar year={year} />}
      {!loading && !failed && !grid && (
        <Card><p className="text-sm text-ink-soft">{t("academicCalendar.noCalendar")}</p></Card>
      )}

      {grid && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse text-center text-xs">
            <caption className="sr-only">{t("academicCalendar.caption", { year: num(year) })}</caption>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-1 text-left font-medium text-ink-soft">
                  {num(year)} {tc("eraSuffix")}
                </th>
                {grid.header.map((wd, i) => (
                  <th key={i} scope="col" className="px-0.5 py-1 font-medium"
                    style={(s?.weekend_days ?? [6, 7]).includes(wd + 1) ? { backgroundColor: "#f4b183" } : undefined}>
                    {weekdayLabel(wd)}
                  </th>
                ))}
                <th scope="col" className="bg-ok/10 px-2 py-1 font-semibold text-ink">{t("academicCalendar.total")}</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr key={`${row.kind}-${row.ecYear}-${row.ecMonth}`} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 text-left font-medium text-ink">
                    {months[row.ecMonth - 1]}{row.kind === "lead_in" ? `/${num(row.ecYear)}` : ""}
                  </th>
                  {row.cells.map((c, i) => {
                    if (!c) return <td key={i} className="px-0.5 py-1 text-ink-faint">-</td>;
                    const type = typeByCode.get(c.dayType);
                    const fill = type?.color ?? (c.dayType === "out_of_session" ? OUT_OF_SESSION : c.dayType === "weekend" ? "#f4b183" : "#ffffff");
                    const label = `${months[c.ecMonth - 1]} ${num(c.ecDay)}, ${num(c.ecYear)} — ${typeLabel(c.dayType)}`
                      + (c.tentative.length ? ` — ${t("academicCalendar.tentative")}` : "");
                    return (
                      <td key={i} className="p-0">
                        <button type="button" aria-label={label} aria-pressed={selected?.isoDate === c.isoDate}
                          onClick={() => setSelected(c)}
                          className={`relative block w-full min-w-6 px-0.5 py-1 ${c.isToday ? "outline outline-2 -outline-offset-2 outline-navy" : ""}`}
                          style={{ backgroundColor: fill, color: textOn(fill) }}>
                          {num(c.ecDay)}
                          {c.hijri && <span className="block text-[9px] leading-none opacity-80">{num(c.hijri.day)}</span>}
                          {c.tentative.length > 0 && <span aria-hidden className="absolute right-0 top-0 text-[9px]">☾</span>}
                        </button>
                      </td>
                    );
                  })}
                  <td className="bg-ok/10 px-2 py-1 font-semibold text-ink">{row.total === null ? "–" : num(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <th scope="row" colSpan={GRID_COLUMNS + 1} className="px-2 py-1 text-right font-medium text-ink">{t("academicCalendar.yearTotal")}</th>
                <td className="bg-ok/10 px-2 py-1 font-bold text-ink">{num(grid.total)}</td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {selected && (
        <DayInspector cell={selected} entries={selected.entryIds.map((id) => entryById.get(id)).filter((e): e is EffectiveEntry => !!e)}
          typeLabel={typeLabel} hijriMonths={hijriMonths} num={num} lang={lang} />
      )}

      {grid && dayTypes.data && entries.data && (
        <Legend dayTypes={dayTypes.data} entries={entries.data} lang={lang} />
      )}
    </div>
  );
}

function DayInspector({ cell, entries, typeLabel, hijriMonths, num, lang }: {
  cell: GridCell; entries: EffectiveEntry[]; typeLabel: (code: string) => string;
  hijriMonths: string[]; num: (v: number) => string; lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Card aria-live="polite">
      <h2 className="font-semibold text-ink"><EthDate value={cell.isoDate} /></h2>
      {cell.hijri && <p className="text-xs text-ink-soft">{hijriMonths[cell.hijri.month - 1]} {num(cell.hijri.day)}, {num(cell.hijri.year)}</p>}
      <p className="mt-1 text-sm text-ink">
        {typeLabel(cell.dayType)} · {cell.counts ? t("academicCalendar.schoolDay") : t("academicCalendar.notSchoolDay")}
      </p>
      {cell.tentative.map((code) => (
        <p key={code} className="text-sm text-late">{t(`academicCalendar.hijriHoliday.${code}`)} — {t("academicCalendar.tentative")}</p>
      ))}
      {entries.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {entries.map((e) => (
            <li key={e.entry_id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{tField(e.name_i18n, lang)}</span>
              <Badge tone="neutral">{t(`academicCalendar.level.${e.level}`)}</Badge>
              {e.locked && <Badge tone="navy">{t("academicCalendar.locked")}</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Legend({ dayTypes, entries, lang }: { dayTypes: DayTypeRow[]; entries: EffectiveEntry[]; lang: string }) {
  const { t } = useTranslation();
  const used = new Set(entries.map((e) => e.day_type_code));
  const holidays = entries
    .filter((e) => dayTypes.find((d) => d.code === e.day_type_code)?.category === "holiday")
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return (
    <Card>
      <h2 className="font-semibold text-ink">{t("academicCalendar.legend")}</h2>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {dayTypes.filter((d) => used.has(d.code) || d.code === "weekend" || d.code === "instructional").map((d) => (
          <li key={d.code} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-line" style={{ backgroundColor: d.color }} />
            {tField(d.label_i18n, lang)}
          </li>
        ))}
      </ul>
      {holidays.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-medium text-ink">{t("academicCalendar.holidays")}</h3>
          <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
            {holidays.map((h) => (
              <li key={h.entry_id}><EthDate value={h.starts_on} /> — {tField(h.name_i18n, lang)}</li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ChooseCalendar({ year }: { year: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [origin, setOrigin] = useState<CalendarOrigin>("moe");
  const [result, setResult] = useState<CreateCalendarResult | null>(null);
  const create = useMutation({
    mutationFn: () => createSchoolCalendar(year, origin),
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["academic-calendar"] }); },
  });
  const options: CalendarOrigin[] = ["moe", "previous_year", "custom"];
  return (
    <Card>
      <fieldset className="space-y-2 text-sm">
        <legend className="font-semibold text-ink">{t("academicCalendar.choose.title")}</legend>
        {options.map((o) => (
          <label key={o} className="flex items-start gap-2">
            <input type="radio" name="calendar-origin" value={o} checked={origin === o} onChange={() => { create.reset(); setOrigin(o); }} className="mt-1" />
            <span>
              <span className="font-medium text-ink">{t(`academicCalendar.choose.${o}`)}</span>
              <span className="block text-xs text-ink-soft">{t(`academicCalendar.choose.${o}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <Button className="mt-3" onClick={() => create.mutate()} disabled={create.isPending}>{t("academicCalendar.choose.submit")}</Button>
      <p role="status" className="mt-2 text-sm text-ok">
        {result ? t("academicCalendar.choose.created", { count: result.copied }) : ""}
      </p>
      {result && result.dropped.length > 0 && (
        <p className="text-sm text-late">{t("academicCalendar.choose.dropped", { count: result.dropped.length })}</p>
      )}
      {create.isError && <p role="alert" className="text-sm text-danger">{t(`academicCalendar.error.${calendarErrorKey(create.error)}`)}</p>}
    </Card>
  );
}
