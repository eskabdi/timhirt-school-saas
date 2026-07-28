// ============================================================================
// <EthDatePicker /> (§17.4) — Ethiopian-first date picker.
// 13-month grid (12 × 30 + Pagume 5/6 by leap rule ey % 4 === 3), aligned to
// the real day-of-week (via the Gregorian equivalent's getUTCDay() — JDN-based
// conversion preserves the actual weekday regardless of calendar system, so
// no separate day-of-week math is needed in the Ethiopian engine itself).
// Emits a GREGORIAN Date to forms — Zod, PostgREST, and the DB never see EC
// values (canonical storage rule §17.2). Footer shows the live GC equivalent.
// Keyboard + screen-reader accessible.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EthDate as Eth, toEthiopian, toGregorian, daysInEthMonth, toGeez, todayEthiopian, formatEth,
} from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";

interface Props {
  value: Date | null;
  onChange: (gregorian: Date) => void;
  geez?: boolean;
  id?: string;
}

// Fixed English weekday initials regardless of active locale, matching the
// reference design — there's no standard single-letter Amharic/Afaan Oromoo
// weekday abbreviation to fall back on without risking an invented one.
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Year-grid page size — clicking the header opens a grid of years so a
// distant birth year is one or two clicks away, not dozens of month steps.
const YEARS_PER_PAGE = 12;

export function EthDatePicker({ value, onChange, geez = false, id }: Props) {
  const { t } = useTranslation("calendar");
  const months = t("months", { returnObjects: true }) as string[];
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initial: Eth = value ? toEthiopian(value) : todayEthiopian();
  const [view, setView] = useState<{ year: number; month: number }>({ year: initial.year, month: initial.month });
  // "days" = normal month grid; "years" = year-selection grid.
  const [mode, setMode] = useState<"days" | "years">("days");
  const [yearGridStart, setYearGridStart] = useState(initial.year - 6);
  const selected = value ? toEthiopian(value) : null;
  const today = todayEthiopian();

  // Re-anchor the visible month to the current selection (or today) each
  // time the popover opens, so it never reopens on a stale month or in year mode.
  useEffect(() => {
    if (!open) return;
    const base = value ? toEthiopian(value) : todayEthiopian();
    setView({ year: base.year, month: base.month });
    setMode("days");
    setYearGridStart(base.year - 6);
  }, [open]);

  // Open the year grid centred on the month currently in view.
  const openYearGrid = () => { setYearGridStart(view.year - 6); setMode("years"); };
  const selectYear = (y: number) => { setView((v) => ({ ...v, year: y })); setMode("days"); };

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const leadingBlanks = useMemo(
    () => toGregorian({ year: view.year, month: view.month, day: 1 }).getUTCDay(),
    [view],
  );
  const days = useMemo(
    () => Array.from({ length: daysInEthMonth(view.year, view.month) }, (_, i) => i + 1),
    [view],
  );

  const move = (delta: number) => {
    let m = view.month + delta, y = view.year;
    if (m < 1) { m = 13; y -= 1; }
    if (m > 13) { m = 1; y += 1; }
    setView({ year: y, month: m });
  };

  const gcPreview = value
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(value)
    : "";

  const displayValue = value ? formatEth(value, { monthNames: months, eraSuffix: t("eraSuffix"), geez }) : "";

  const selectDay = (d: number) => {
    onChange(toGregorian({ year: view.year, month: view.month, day: d }));
    // Deferred: removing the clicked button from the DOM synchronously,
    // within its own click handler, makes Chromium redispatch that same
    // click onto whatever element still holds focus (the trigger input) —
    // reopening the popover we just closed. Closing on the next tick lets
    // the browser finish dispatching the original click first.
    setTimeout(() => setOpen(false), 0);
  };

  // The trigger shrinks with its container — a fixed w-72 overflowed any narrow
  // grid cell (it clipped the Due Time field beside it on the assignment form).
  // The popup keeps its own fixed width, since the 13-month grid needs the room.
  return (
    <div id={id} ref={containerRef} className="relative w-full max-w-[18rem]">
      <input
        type="text"
        readOnly
        value={displayValue}
        placeholder={t("placeholder")}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); setOpen(true); }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full cursor-pointer rounded-control border border-line bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-navy"
      />

      {open && (
        <div className="absolute z-20 mt-1 w-72 rounded-panel border border-line bg-card p-3 shadow-lg" role="dialog" aria-label={t("pickDate")}>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => (mode === "days" ? move(-1) : setYearGridStart((s) => s - YEARS_PER_PAGE))}
              aria-label={mode === "days" ? "Previous month" : "Previous years"}
              className="rounded-control px-2 py-1 text-ink-faint hover:bg-sidebar">‹</button>
            <button
              type="button"
              onClick={() => (mode === "days" ? openYearGrid() : setMode("days"))}
              aria-label={mode === "days" ? "Select year" : "Back to days"}
              className="rounded-control px-2 py-1 font-display text-sm font-bold text-ink hover:bg-sidebar">
              {mode === "days"
                ? `${months[view.month - 1]} ${geez ? toGeez(view.year) : view.year} ${t("eraSuffix")}`
                : `${geez ? toGeez(yearGridStart) : yearGridStart}–${geez ? toGeez(yearGridStart + YEARS_PER_PAGE - 1) : yearGridStart + YEARS_PER_PAGE - 1} ${t("eraSuffix")}`}
            </button>
            <button
              type="button"
              onClick={() => (mode === "days" ? move(1) : setYearGridStart((s) => s + YEARS_PER_PAGE))}
              aria-label={mode === "days" ? "Next month" : "Next years"}
              className="rounded-control px-2 py-1 text-ink-faint hover:bg-sidebar">›</button>
          </div>

          {mode === "years" ? (
            <div className="grid grid-cols-3 gap-1" role="grid">
              {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearGridStart + i).map((y) => {
                const isSelectedYear = selected?.year === y;
                const isCurrentYear = today.year === y;
                return (
                  <button
                    key={y}
                    type="button"
                    role="gridcell"
                    aria-selected={isSelectedYear}
                    onClick={() => selectYear(y)}
                    className={cn(
                      "flex h-10 items-center justify-center rounded-control text-sm tabular-nums transition-colors",
                      isSelectedYear ? "bg-navy font-semibold text-white"
                        : isCurrentYear ? "ring-1 ring-inset ring-navy text-ink hover:bg-navy-wash"
                        : "text-ink hover:bg-navy-wash",
                    )}
                  >
                    {geez ? toGeez(y) : y}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-faint">
                {WEEKDAYS.map((w, i) => <div key={i} className="py-1">{w}</div>)}
              </div>

              <div className="grid grid-cols-7 gap-1" role="grid">
                {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}
                {days.map((d) => {
                  const isSelected = selected?.year === view.year && selected?.month === view.month && selected?.day === d;
                  const isToday = today.year === view.year && today.month === view.month && today.day === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      onClick={() => selectDay(d)}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                        isSelected ? "bg-navy font-semibold text-white"
                          : isToday ? "ring-1 ring-inset ring-navy text-ink hover:bg-navy-wash"
                          : "text-ink hover:bg-navy-wash",
                      )}
                    >
                      {geez ? toGeez(d) : d}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {value && (
            <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">
              {t("gregorianEquivalent", { date: gcPreview })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
