// The academic calendar as the Ministry of Education prints it: one row per
// EC month (plus the lead-in of the previous year), 37 weekday columns
// Monday-first, each day coloured by its type, and the ድምር column of school
// days. Read-only in slice 1, plus "Choose Calendar" for a year the school has
// not set up. The layers (MoE → region → school) are resolved on the server
// (effective_calendar_entries); buildYearGrid only lays them out.
//
// Accessibility: each day's type is shown by colour *and* a mark (legend
// keys both); text colour is picked for contrast; the grid is one tab stop
// (arrow keys move as drawn: left/right a day, up/down the same column in the
// month above or below; Enter/Space opens the day in the inspector, a live
// region), and a hint says so; every cell's name is its weekday, full date,
// type, Hijri date and school-day status; the table scrolls inside its own
// labelled region, which is positioned so nothing in it widens the page.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/useSession";
import { useCalendarPrefs } from "@/features/settings/useCalendarPrefs";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EthDate } from "@/components/EthDate";
import { tField } from "@/lib/i18n";
import {
  addDaysIso, formatDigits, formatEth, formatHijri, fromIsoDate, toIsoDate, today, todayEthiopian, type NumeralSystem,
} from "@/lib/ethiopian-date";
import { hijriHolidaySuggestions } from "@/lib/ethiopian-holidays";
import { buildYearGrid, GRID_COLUMNS, type GridCell } from "./grid";
import { DAY_TYPE_MARKS, OUT_OF_SESSION_FILL } from "./dayTypes";
import { textOn } from "./contrast";
import {
  calendarErrorKey, createSchoolCalendar, fetchAuthorities, fetchCanCreateCalendar, fetchDayTypes, fetchEffectiveEntries,
  fetchYearSettings, toGridDayTypes, toGridEntries, type CalendarOrigin, type CreateCalendarResult, type DayTypeRow,
  type EffectiveEntry,
} from "./api";

const WEEKEND_FALLBACK = "#f4b183";
/** Non-colour cues for the derived kinds of day (WCAG 1.4.1). */
const HATCH = "repeating-linear-gradient(135deg, rgb(0 0 0 / 0.10) 0 2px, transparent 2px 6px)";
const DOTS = "radial-gradient(rgb(0 0 0 / 0.22) 1px, transparent 1.2px)";
const STRIPES = "repeating-linear-gradient(90deg, rgb(0 0 0 / 0.14) 0 1px, transparent 1px 4px)";
const patternFor = (dayType: string): CSSProperties =>
  dayType === "weekend" ? { backgroundImage: HATCH }
    : dayType === "out_of_session" ? { backgroundImage: DOTS, backgroundSize: "5px 5px" }
    : dayType === "next_session" ? { backgroundImage: STRIPES }
    : {};
/** Selected: a white and a black ring, so one of them shows on any fill (≥3:1, WCAG 1.4.11). Drawn on an
 * overlay, so the button's own focus ring (also a box-shadow) still shows on the selected cell (2.4.7). */
const SELECTED_RING: CSSProperties = { boxShadow: "inset 0 0 0 2px #ffffff, inset 0 0 0 4px #111111" };

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
  const [focusIso, setFocusIso] = useState<string | null>(null);
  const [created, setCreated] = useState<{ year: number; result: CreateCalendarResult } | null>(null);
  // The outcome of Choose Calendar lives here, not in the chooser: choosing
  // a calendar makes the chooser disappear (the school now has one), and the
  // outcome, with the days it had to leave out, must survive that.
  const noticeRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const captionId = useId();
  const inspectorId = useId();
  const hintId = useId();

  // Scoped to the school and user, so a session switch never shows another
  // school's cached calendar (§6.3).
  const scope = [profile?.tenant_id ?? null, profile?.id ?? null];
  const settingsKey = (y: number) => ["academic-calendar", ...scope, "settings", y];
  const settings = useQuery({ queryKey: settingsKey(year), queryFn: () => fetchYearSettings(year) });
  const nextSettings = useQuery({ queryKey: settingsKey(year + 1), queryFn: () => fetchYearSettings(year + 1) });
  const entries = useQuery({ queryKey: ["academic-calendar", ...scope, "entries", year], queryFn: () => fetchEffectiveEntries(year) });
  const dayTypes = useQuery({ queryKey: ["academic-calendar", "day-types"], queryFn: fetchDayTypes, staleTime: 3_600_000 });
  const authorities = useQuery({ queryKey: ["academic-calendar", "authorities"], queryFn: fetchAuthorities, staleTime: 3_600_000 });
  const canCreate = useQuery({
    queryKey: ["academic-calendar", ...scope, "can-create"],
    queryFn: () => fetchCanCreateCalendar(profile!.id),
    enabled: !!profile?.id,
  });
  // Only the chooser needs last year (is there a published calendar to copy?).
  const prevSettings = useQuery({
    queryKey: settingsKey(year - 1), queryFn: () => fetchYearSettings(year - 1), enabled: canCreate.data === true,
  });

  const s = settings.data;
  const typeByCode = useMemo(() => new Map((dayTypes.data ?? []).map((d) => [d.code, d])), [dayTypes.data]);
  const entryById = useMemo(() => new Map((entries.data ?? []).map((e) => [e.entry_id, e])), [entries.data]);
  const nextSessionStartsOn = nextSettings.data?.session_starts_on ?? null;

  const grid = useMemo(() => {
    // Wait for next year's session too, or its lead-in days would first show
    // as this year's and then flip (and the totals with them).
    if (!s?.session_starts_on || !s.session_ends_on || !dayTypes.data || !entries.data || nextSettings.isPending || nextSettings.isError) return null;
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
      nextSessionStartsOn,
    });
  }, [s, dayTypes.data, entries.data, year, prefs.showHijri, prefs.hijriHolidays, nextSessionStartsOn, nextSettings.isPending, nextSettings.isError]);

  // Each day's row and column, for keyboard movement.
  const nav = useMemo(() => {
    const byIso = new Map<string, { cell: GridCell; row: number; col: number }>();
    grid?.rows.forEach((r, row) => r.cells.forEach((c, col) => { if (c) byIso.set(c.isoDate, { cell: c, row, col }); }));
    return byIso;
  }, [grid]);
  const allCells = useMemo(() => grid?.rows.flatMap((r) => r.cells).filter((c): c is GridCell => !!c) ?? [], [grid]);
  const firstIso = allCells[0]?.isoDate ?? null;
  const todayIso = allCells.find((c) => c.isToday)?.isoDate ?? null;
  const activeIso = (focusIso && nav.has(focusIso) ? focusIso : null) ?? (selected && nav.has(selected.isoDate) ? selected.isoDate : null)
    ?? todayIso ?? firstIso;

  useEffect(() => { if (created) noticeRef.current?.focus(); }, [created]);

  const loading = settings.isPending || entries.isPending || dayTypes.isPending || nextSettings.isPending;
  // Next year's settings decide which lead-in days are next year's; without
  // them the totals could be wrong, so their failure is a load failure too.
  const failed = settings.isError || entries.isError || dayTypes.isError || nextSettings.isError;
  const months = tc("months", { returnObjects: true }) as string[];
  const weekdays = tc("weekdaysShort", { returnObjects: true }) as string[]; // Sunday-first
  const weekdayNames = tc("weekdays", { returnObjects: true }) as string[];   // Sunday-first
  const hijriMonths = tc("hijriMonths", { returnObjects: true }) as string[];
  const typeLabel = (code: string) =>
    typeByCode.get(code) ? tField(typeByCode.get(code)!.label_i18n, lang) : t(`academicCalendar.derived.${code}`, { defaultValue: code });
  const status = s?.school_status ?? null;
  const weekendDays = s?.weekend_days ?? [6, 7];
  const canChoose = canCreate.data === true && s !== undefined && !s?.school_calendar_id && Math.abs(year - currentYear) <= 1;
  const previousAvailable = prevSettings.data?.school_status === "published" || prevSettings.data?.school_status === "closed";
  const authorityName = (code: string) => tField(authorities.data?.find((a) => a.code === code)?.name_i18n, lang) || code;
  const source = authorityName(s?.region_code ?? "MOE");

  // Every cell's name, once per grid and language (not on every keystroke).
  const cellNames = useMemo(() => new Map(allCells.map((c) => {
    const date = fromIsoDate(c.isoDate);
    const parts = [
      weekdayNames[date.getUTCDay()],
      formatEth(date, { numerals: digits, monthNames: months, eraSuffix: tc("eraSuffix") }),
      typeLabel(c.dayType),
      c.hijri ? formatHijri(date, { numerals: digits, monthNames: hijriMonths, eraSuffix: tc("hijriEraSuffix") }) : null,
      ...c.tentative.map((code) => `${t(`academicCalendar.hijriHoliday.${code}`)}: ${t("academicCalendar.tentative")}`),
      c.dayType === "instructional" ? null : c.counts ? t("academicCalendar.schoolDay") : t("academicCalendar.notSchoolDay"),
    ];
    return [c.isoDate, parts.filter(Boolean).join(" — ")] as const;
  // typeLabel, months and the other lookups follow lang and the loaded types.
  })), [allCells, lang, digits, typeByCode]);

  const moveTo = (iso: string | undefined | null) => {
    if (!iso || !nav.has(iso)) return;
    setFocusIso(iso);
    regionRef.current?.querySelector<HTMLButtonElement>(`button[data-iso="${iso}"]`)?.focus();
  };
  const onCellKey = (e: KeyboardEvent<HTMLButtonElement>, c: GridCell) => {
    const here = nav.get(c.isoDate);
    if (!here || !grid) return;
    const rowCells = grid.rows[here.row]!.cells.filter((x): x is GridCell => !!x);
    // Up/down: the same column in the row above/below, or the nearest day in
    // that row when the column is empty there.
    const sameColumn = (r: number) => {
      const cells = grid.rows[r]?.cells;
      if (!cells) return undefined;
      let best: GridCell | null = null;
      cells.forEach((x, col) => {
        if (x && (!best || Math.abs(col - here.col) < Math.abs(nav.get(best.isoDate)!.col - here.col))) best = x;
      });
      return (best as GridCell | null)?.isoDate;
    };
    // Page up/down: the same day of the month above/below.
    const sameDay = (r: number) => {
      const cells = grid.rows[r]?.cells.filter((x): x is GridCell => !!x) ?? [];
      return (cells.find((x) => x.ecDay === c.ecDay) ?? cells[cells.length - 1])?.isoDate;
    };
    const target: Record<string, string | undefined> = {
      ArrowLeft: addDaysIso(c.isoDate, -1), ArrowRight: addDaysIso(c.isoDate, 1),
      ArrowUp: sameColumn(here.row - 1), ArrowDown: sameColumn(here.row + 1),
      Home: rowCells[0]?.isoDate, End: rowCells[rowCells.length - 1]?.isoDate,
      PageUp: sameDay(here.row - 1), PageDown: sameDay(here.row + 1),
    };
    if (e.key in target) {
      e.preventDefault();
      moveTo(target[e.key]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{t("academicCalendar.title")}</h1>
          <p className="text-sm text-ink-soft">{t("academicCalendar.follows", { source })}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink" htmlFor="ac-year">{t("academicCalendar.year")}</label>
          <select id="ac-year" value={year} onChange={(e) => { setYear(Number(e.target.value)); setSelected(null); setFocusIso(null); setCreated(null); }}
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

      <div ref={noticeRef} tabIndex={-1} role="status" className="outline-none focus-visible:ring-2 focus-visible:ring-navy">
        {created && created.year === year && <CreatedNotice result={created.result} num={num} lang={lang} />}
      </div>
      {canChoose && (
        <ChooseCalendar year={year} previousAvailable={previousAvailable}
          onCreated={(result) => setCreated({ year, result })} />
      )}
      {!loading && !failed && !grid && (
        <Card><p className="text-sm text-ink-soft">{t("academicCalendar.noCalendar")}</p></Card>
      )}

      {grid && (
        <div className="rounded-panel bg-card shadow-ambient">
          <p id={hintId} className="px-3 pt-2 text-xs text-ink-soft">{t("academicCalendar.keyboardHint")}</p>
          {/* relative: the sr-only weekday names are absolutely positioned and
              would otherwise widen the page past the scroller (WCAG 1.4.10). */}
          <div ref={regionRef} role="region" aria-labelledby={captionId} aria-describedby={hintId} tabIndex={0}
            className="relative overflow-x-auto focus-visible:ring-2 focus-visible:ring-navy">
            <table className="w-full border-collapse text-center text-xs">
              <caption id={captionId} className="sr-only">{t("academicCalendar.caption", { year: num(year) })}</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-card px-1 py-1 text-left font-medium text-ink-soft sm:px-2">
                    {num(year)} {tc("eraSuffix")}
                  </th>
                  {grid.header.map((wd, i) => {
                    const isWeekend = weekendDays.includes(wd + 1);
                    return (
                      <th key={i} scope="col" className={`px-0.5 py-1 ${isWeekend ? "font-bold text-ink" : "font-medium"}`}
                        style={isWeekend ? { backgroundColor: typeByCode.get("weekend")?.color ?? WEEKEND_FALLBACK, ...patternFor("weekend") } : undefined}>
                        <span aria-hidden>{weekdays[(wd + 1) % 7]}</span>
                        <span className="sr-only">{weekdayNames[(wd + 1) % 7]}</span>
                      </th>
                    );
                  })}
                  <th scope="col" className="bg-ok/10 px-2 py-1 font-semibold text-ink">{t("academicCalendar.total")}</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={`${row.kind}-${row.ecYear}-${row.ecMonth}`} className="border-t border-line">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card px-1 py-1 text-left text-[11px] font-medium text-ink sm:px-2 sm:text-xs">
                      {months[row.ecMonth - 1]}{row.kind === "lead_in" ? `/${num(row.ecYear)}` : ""}
                    </th>
                    {row.cells.map((c, i) => {
                      if (!c) return <td key={i} aria-hidden className="px-0.5 py-1" />;
                      const type = typeByCode.get(c.dayType);
                      const fill = type?.color
                        ?? (c.dayType === "out_of_session" || c.dayType === "next_session" ? OUT_OF_SESSION_FILL
                          : c.dayType === "weekend" ? WEEKEND_FALLBACK : "#ffffff");
                      const isSelected = selected?.isoDate === c.isoDate;
                      const mark = DAY_TYPE_MARKS[c.dayType];
                      return (
                        <td key={i} className="p-0">
                          <button type="button" data-iso={c.isoDate}
                            tabIndex={c.isoDate === activeIso ? 0 : -1}
                            aria-label={cellNames.get(c.isoDate)} aria-controls={inspectorId}
                            aria-current={c.isToday ? "date" : undefined}
                            onClick={() => { setSelected(c); setFocusIso(c.isoDate); }}
                            onKeyDown={(e) => onCellKey(e, c)}
                            className={`relative block w-full min-w-6 px-0.5 py-1 focus-visible:z-20 ${isSelected ? "z-10" : ""}`}
                            style={{ backgroundColor: fill, color: textOn(fill), ...patternFor(c.dayType) }}>
                            {isSelected && <span aria-hidden data-selected-ring className="pointer-events-none absolute inset-0" style={SELECTED_RING} />}
                            {mark && <span aria-hidden className="absolute left-0.5 top-0 text-[10px] leading-none">{mark}</span>}
                            {c.isToday && <TodayBar />}
                            {num(c.ecDay)}
                            {c.hijri && <span aria-hidden className="block text-[10px] leading-none">{num(c.hijri.day)}</span>}
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
          </div>
        </div>
      )}

      {/* Always mounted, so the first selection is announced too. */}
      <div id={inspectorId} aria-live="polite">
        {selected && (
          <DayInspector cell={selected} entries={selected.entryIds.map((id) => entryById.get(id)).filter((e): e is EffectiveEntry => !!e)}
            typeLabel={typeLabel} lang={lang} />
        )}
      </div>

      {grid && dayTypes.data && entries.data && (
        <Legend dayTypes={dayTypes.data} entries={entries.data} lang={lang}
          derived={[...new Set(allCells.map((c) => c.dayType).filter((d) => d === "out_of_session" || d === "next_session"))]}
          hasToday={todayIso !== null} hasTentative={allCells.some((c) => c.tentative.length > 0)} />
      )}
    </div>
  );
}

function CreatedNotice({ result, num, lang }: { result: CreateCalendarResult; num: (v: number) => string; lang: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <p className="text-sm text-ok">{t("academicCalendar.choose.created", { count: result.copied, n: num(result.copied) })}</p>
      {result.dropped.length > 0 && (
        <>
          <p className="mt-1 text-sm text-late">{t("academicCalendar.choose.dropped", { count: result.dropped.length, n: num(result.dropped.length) })}</p>
          <p className="mt-2 text-sm font-medium text-ink">{t("academicCalendar.choose.droppedTitle")}</p>
          <ul className="mt-1 space-y-1 text-sm">
            {result.dropped.map((d, i) => (
              <li key={i} className="flex min-w-0 flex-wrap gap-x-1">
                <EthDate value={d.starts_on} />
                <span>— {tField(d.name, lang)}{i18n.exists(`academicCalendar.choose.droppedReason.${d.reason}`) ? ` (${t(`academicCalendar.choose.droppedReason.${d.reason}`)})` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function DayInspector({ cell, entries, typeLabel, lang }: {
  cell: GridCell; entries: EffectiveEntry[]; typeLabel: (code: string) => string; lang: string;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      {/* EthDate already adds the Hijri date when the school shows it. */}
      <h2 className="font-semibold text-ink"><EthDate value={cell.isoDate} /></h2>
      <p className="mt-1 text-sm text-ink">
        {typeLabel(cell.dayType)}
        {cell.dayType !== "instructional" && <> · {cell.counts ? t("academicCalendar.schoolDay") : t("academicCalendar.notSchoolDay")}</>}
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

/** Today: a black bar edged in white along the cell's foot, visible on any fill and distinct from the selected ring. */
function TodayBar() {
  return <span aria-hidden className="absolute inset-x-1 bottom-0.5 h-[3px] rounded-sm bg-[#111111] shadow-[0_0_0_2px_#ffffff]" />;
}

function Swatch({ color, dayType }: { color: string; dayType: string }) {
  const mark = DAY_TYPE_MARKS[dayType];
  return (
    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-line text-[9px] leading-none"
      style={{ backgroundColor: color, color: textOn(color), ...patternFor(dayType) }}>
      {mark}
    </span>
  );
}

function Legend({ dayTypes, entries, lang, derived, hasToday, hasTentative }: {
  dayTypes: DayTypeRow[]; entries: EffectiveEntry[]; lang: string; derived: string[]; hasToday: boolean; hasTentative: boolean;
}) {
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
            <Swatch color={d.color} dayType={d.code} />
            {tField(d.label_i18n, lang)}
          </li>
        ))}
        {derived.map((code) => (
          <li key={code} className="flex items-center gap-1.5">
            <Swatch color={OUT_OF_SESSION_FILL} dayType={code} />
            {t(`academicCalendar.derived.${code}`)}
          </li>
        ))}
        {hasToday && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="relative inline-block h-4 w-4 rounded-sm border border-line bg-card"><TodayBar /></span>
            {t("academicCalendar.legendToday")}
          </li>
        )}
        {hasTentative && (
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-line text-[10px]">☾</span>
            {t("academicCalendar.legendTentative")}
          </li>
        )}
      </ul>
      {holidays.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-medium text-ink">{t("academicCalendar.holidays")}</h3>
          <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
            {holidays.map((h) => (
              <li key={h.entry_id} className="flex min-w-0 flex-wrap gap-x-1">
                <EthDate value={h.starts_on} />
                <span className="min-w-0">— {tField(h.name_i18n, lang)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function ChooseCalendar({ year, previousAvailable, onCreated }: {
  year: number; previousAvailable: boolean; onCreated: (r: CreateCalendarResult) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const ids = useId();
  const [origin, setOrigin] = useState<CalendarOrigin>("moe");
  const create = useMutation({
    mutationFn: () => createSchoolCalendar(year, origin),
    onSuccess: (r) => { onCreated(r); void qc.invalidateQueries({ queryKey: ["academic-calendar"] }); },
  });
  const options: CalendarOrigin[] = ["moe", "previous_year", "custom"];
  const errorId = `${ids}-error`;
  return (
    <Card>
      <fieldset className="space-y-2 text-sm" aria-describedby={create.isError ? errorId : undefined}>
        <legend className="font-semibold text-ink">{t("academicCalendar.choose.title")}</legend>
        {options.map((o) => {
          const disabled = o === "previous_year" && !previousAvailable;
          const hintId = `${ids}-${o}`;
          return (
            <div key={o} className="flex items-start gap-2">
              <input type="radio" id={`${ids}-${o}-input`} name="calendar-origin" value={o} checked={origin === o} disabled={disabled}
                aria-describedby={hintId} onChange={() => { create.reset(); setOrigin(o); }} className="mt-1" />
              <div>
                <label htmlFor={`${ids}-${o}-input`} className={`font-medium ${disabled ? "text-ink-faint" : "text-ink"}`}>
                  {t(`academicCalendar.choose.${o}`)}
                </label>
                <p id={hintId} className="text-xs text-ink-soft">
                  {disabled ? t("academicCalendar.error.no_previous_calendar") : t(`academicCalendar.choose.${o}Hint`)}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>
      <Button className="mt-3" onClick={() => create.mutate()} disabled={create.isPending}>{t("academicCalendar.choose.submit")}</Button>
      {create.isError && <p id={errorId} role="alert" className="mt-2 text-sm text-danger">{t(`academicCalendar.error.${calendarErrorKey(create.error)}`)}</p>}
    </Card>
  );
}
