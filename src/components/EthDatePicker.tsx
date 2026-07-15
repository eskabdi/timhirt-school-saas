// ============================================================================
// <EthDatePicker /> (§17.4) — Ethiopian-first date picker.
// 13-month grid (12 × 30 + Pagume 5/6 by leap rule ey % 4 === 3).
// Emits a GREGORIAN Date to forms — Zod, PostgREST, and the DB never see EC
// values (canonical storage rule §17.2). Footer shows the live GC equivalent.
// Keyboard + screen-reader accessible.
// ============================================================================
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  EthDate as Eth, toEthiopian, toGregorian, daysInEthMonth, toGeez, todayEthiopian,
} from "@/lib/ethiopian-date";
import { cn } from "@/lib/utils";

interface Props {
  value: Date | null;
  onChange: (gregorian: Date) => void;
  geez?: boolean;
  id?: string;
}

export function EthDatePicker({ value, onChange, geez = false, id }: Props) {
  const { t } = useTranslation("calendar");
  const months = t("months", { returnObjects: true }) as string[];
  const initial: Eth = value ? toEthiopian(value) : todayEthiopian();
  const [view, setView] = useState<{ year: number; month: number }>({ year: initial.year, month: initial.month });
  const selected = value ? toEthiopian(value) : null;

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

  return (
    <div id={id} className="w-72 rounded-card border border-line bg-chalk-raised p-3" role="group" aria-label={t("pickDate")}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} aria-label="Previous month"
          className="rounded px-2 py-1 text-ink-faint hover:bg-chalk-sunken">‹</button>
        <div className="text-sm font-semibold">
          {months[view.month - 1]} {geez ? toGeez(view.year) : view.year} {t("eraSuffix")}
        </div>
        <button type="button" onClick={() => move(1)} aria-label="Next month"
          className="rounded px-2 py-1 text-ink-faint hover:bg-chalk-sunken">›</button>
      </div>

      <div className="grid grid-cols-6 gap-1" role="grid">
        {days.map((d) => {
          const isSelected = selected?.year === view.year && selected?.month === view.month && selected?.day === d;
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              onClick={() => onChange(toGregorian({ year: view.year, month: view.month, day: d }))}
              className={cn(
                "h-9 rounded text-sm tabular-nums transition-colors",
                isSelected ? "bg-meskel text-ink font-semibold" : "hover:bg-meskel-wash",
              )}
            >
              {geez ? toGeez(d) : d}
            </button>
          );
        })}
      </div>

      {value && (
        <p className="mt-2 border-t border-line pt-2 text-xs text-ink-faint">
          {t("gregorianEquivalent", { date: gcPreview })}
        </p>
      )}
    </div>
  );
}
