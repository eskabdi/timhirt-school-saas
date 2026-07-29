// Compact EC month grid for the dashboard's "Academic Calendar & Events" panel.
//
// Same rule as the full calendar page (§17.2): the grid is built in Ethiopian
// space and only converts to Gregorian per cell, because that ISO date is what
// calendar_events actually stores. Nothing here writes, so a cell is a link to
// the full calendar rather than an editor.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { daysInEthMonth, toEthiopian, toGregorian, toIsoDate, type EthDate } from "@/lib/ethiopian-date";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { cn } from "@/lib/utils";

interface Cell { eth: EthDate; iso: string; dow: number; inMonth: boolean }

function addEthMonths(e: EthDate, delta: number): EthDate {
  const zero = e.month - 1 + delta;
  return {
    year: e.year + Math.floor(zero / 13),
    month: (((zero % 13) + 13) % 13) + 1,
    day: 1,
  };
}

export function MiniCalendar({ events }: { events: { event_date: string; event_type: string }[] }) {
  const { t } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const months = tc("months", { returnObjects: true }) as string[];
  const weekdays = t("weekdays", { returnObjects: true }) as string[];

  const today = useMemo(() => toEthiopian(new Date()), []);
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [cursor, setCursor] = useState<EthDate>({ ...today, day: 1 });

  const cells = useMemo<Cell[]>(() => {
    const build = (eth: EthDate, inMonth = true): Cell => {
      const g = toGregorian(eth);
      return { eth, iso: toIsoDate(g), dow: g.getUTCDay(), inMonth };
    };
    const total = daysInEthMonth(cursor.year, cursor.month);
    const days = Array.from({ length: total }, (_, i) => build({ ...cursor, day: i + 1 }));
    const out: Cell[] = [];
    for (let i = days[0]!.dow; i > 0; i--) {
      const g = toGregorian(days[0]!.eth);
      g.setUTCDate(g.getUTCDate() - i);
      out.push(build(toEthiopian(g), false));
    }
    out.push(...days);
    while (out.length % 7 !== 0) {
      const g = toGregorian(out[out.length - 1]!.eth);
      g.setUTCDate(g.getUTCDate() + 1);
      out.push(build(toEthiopian(g), false));
    }
    return out;
  }, [cursor]);

  const byDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of events) m.set(e.event_date, [...(m.get(e.event_date) ?? []), e.event_type]);
    return m;
  }, [events]);

  return (
    <div className="overflow-hidden rounded-control border border-line">
      <div className="flex items-center justify-between bg-navy-wash px-2 py-1.5">
        <button type="button" className="rounded p-1 text-ink-soft hover:bg-white"
                onClick={() => setCursor((c) => addEthMonths(c, -1))}
                aria-label={t("eventsCalendar.previous")}>
          <IconChevronLeft className="h-4 w-4" />
        </button>
        <p className="font-display text-xs font-bold text-ink">
          {months[cursor.month - 1]} {cursor.year}
        </p>
        <button type="button" className="rounded p-1 text-ink-soft hover:bg-white"
                onClick={() => setCursor((c) => addEthMonths(c, 1))}
                aria-label={t("eventsCalendar.next")}>
          <IconChevronRight className="h-4 w-4" />
        </button>
      </div>

      <table className="w-full table-fixed border-collapse text-center">
        <thead>
          <tr>
            {weekdays.slice(1).map((d, i) => (
              <th key={d} scope="col"
                  className={cn("border border-line px-0.5 py-1 text-[9px] font-medium",
                    // Weekend columns are tinted, as on the full calendar.
                    i === 0 || i === 6 ? "bg-danger-tint text-danger" : "bg-ok-tint text-ink-soft")}>
                <span className="hidden sm:inline">{d}</span>
                <span className="sm:hidden">{d.slice(0, 2)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <tr key={row}>
              {cells.slice(row * 7, row * 7 + 7).map((c) => {
                const kinds = byDate.get(c.iso) ?? [];
                const isToday = c.iso === todayIso;
                return (
                  <td key={c.iso}
                      className={cn("border border-line p-0",
                        c.dow === 0 || c.dow === 6 ? "bg-danger-tint/40" : "bg-ok-tint/40")}>
                    <Link
                      to="/events"
                      className={cn(
                        "flex h-7 flex-col items-center justify-center gap-px text-[10px] tabular-nums hover:bg-white/70",
                        c.inMonth ? "text-ink" : "text-ink-faint/50",
                        isToday && "font-bold",
                      )}
                    >
                      <span className={cn(isToday && "flex h-4 w-4 items-center justify-center rounded-full bg-navy text-white")}>
                        {c.eth.day}
                      </span>
                      {kinds.length > 0 && (
                        <span className="flex gap-px" aria-hidden="true">
                          {kinds.slice(0, 3).map((k, i) => (
                            <span key={i} className={cn("h-1 w-1 rounded-full",
                              k === "holiday" || k === "national" ? "bg-danger" : "bg-navy")} />
                          ))}
                        </span>
                      )}
                      {kinds.length > 0 && (
                        <span className="sr-only">{t("dashboard.eventsOnDay", { count: kinds.length })}</span>
                      )}
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
