// Events & Academic Calendar, laid out on the Ethiopian calendar.
//
// The grid is built in EC space (13 months — 30 days each plus Pagume) and only
// converts to Gregorian at the edges: once per cell to derive the ISO date used
// for lookups and writes, since Postgres stores Gregorian only (§17.2).
//
// Every day cell is a button — clicking one opens the event editor with that
// date already filled in, which is the fastest path to "add something on this
// day". Clicking an event chip inside a cell opens that event instead.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/features/auth/useSession";
import { Button } from "@/components/ui/Button";
import { tField } from "@/lib/i18n";
import {
  daysInEthMonth, toEthiopian, toGregorian, toIsoDate, type EthDate,
} from "@/lib/ethiopian-date";
import { EventFormModal, type EventRow } from "./EventFormModal";
import { cn } from "@/lib/utils";

type View = "month" | "week" | "day";

/** One rendered day: its EC parts plus the Gregorian ISO key events join on. */
interface Cell { eth: EthDate; iso: string; dow: number; inMonth: boolean }

const HOLIDAY_TYPES = new Set(["holiday", "national"]);

function addEthMonths(e: EthDate, delta: number): EthDate {
  const zero = e.month - 1 + delta;
  const year = e.year + Math.floor(zero / 13);
  const month = (((zero % 13) + 13) % 13) + 1;
  return { year, month, day: 1 };
}

export function EventsCalendarPage() {
  const { t, i18n } = useTranslation();
  const { t: tc } = useTranslation("calendar");
  const { profile } = useSession();

  const today = useMemo(() => toEthiopian(new Date()), []);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState<EthDate>({ ...today, day: 1 });
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<Date | null>(null);
  const [editing, setEditing] = useState<EventRow | null>(null);

  const months = tc("months", { returnObjects: true }) as string[];
  const weekdays = t("weekdays", { returnObjects: true }) as string[];
  const weekdaysShort = t("weekdaysShort", { returnObjects: true }) as string[];
  const locale = i18n.resolvedLanguage ?? "en";

  // Cells for the active view. Month pads to whole weeks so the grid stays
  // rectangular; week and day derive from the same builder.
  const cells = useMemo<Cell[]>(() => {
    const build = (eth: EthDate, inMonth = true): Cell => {
      const g = toGregorian(eth);
      return { eth, iso: toIsoDate(g), dow: g.getUTCDay() + 1, inMonth };
    };
    if (view === "day") return [build(cursor)];

    if (view === "week") {
      const start = toGregorian(cursor);
      const offset = start.getUTCDay(); // back up to Sunday
      return Array.from({ length: 7 }, (_, i) => {
        const g = new Date(start);
        g.setUTCDate(g.getUTCDate() - offset + i);
        return build(toEthiopian(g));
      });
    }

    const total = daysInEthMonth(cursor.year, cursor.month);
    const days = Array.from({ length: total }, (_, i) => build({ ...cursor, day: i + 1 }));
    const lead = days[0]!.dow - 1; // dow is 1 = Sunday
    const pad: Cell[] = [];
    for (let i = lead; i > 0; i--) {
      const g = toGregorian(days[0]!.eth);
      g.setUTCDate(g.getUTCDate() - i);
      pad.push(build(toEthiopian(g), false));
    }
    const out = [...pad, ...days];
    while (out.length % 7 !== 0) {
      const g = toGregorian(out[out.length - 1]!.eth);
      g.setUTCDate(g.getUTCDate() + 1);
      out.push(build(toEthiopian(g), false));
    }
    return out;
  }, [view, cursor]);

  const rangeStart = cells[0]?.iso;
  const rangeEnd = cells[cells.length - 1]?.iso;

  const { data: events } = useQuery({
    queryKey: ["calendar-events", profile?.tenant_id, rangeStart, rangeEnd],
    enabled: !!profile?.tenant_id && !!rangeStart,
    queryFn: async () => {
      // A multi-day event starting before the window still shows inside it, so
      // filter on the span rather than only on the start date.
      const { data, error } = await supabase.from("calendar_events")
        .select("id, event_date, end_date, name_i18n, event_type, notes, color, visible_to_roles, all_schools")
        .lte("event_date", rangeEnd!)
        .or(`end_date.is.null,end_date.gte.${rangeStart!}`)
        .order("event_date");
      if (error) throw error;
      return (data ?? []) as EventRow[];
    },
  });

  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events ?? []) {
      const last = e.end_date ?? e.event_date;
      for (const c of cells) {
        if (c.iso >= e.event_date && c.iso <= last) {
          const list = map.get(c.iso) ?? [];
          list.push(e);
          map.set(c.iso, list);
        }
      }
    }
    return map;
  }, [events, cells]);

  const openOn = (c: Cell) => { setEditing(null); setFormDate(toGregorian(c.eth)); setFormOpen(true); };
  const openEvent = (e: EventRow) => { setEditing(e); setFormDate(null); setFormOpen(true); };

  const step = (dir: number) => {
    if (view === "month") { setCursor(addEthMonths(cursor, dir)); return; }
    const g = toGregorian(cursor);
    g.setUTCDate(g.getUTCDate() + dir * (view === "week" ? 7 : 1));
    setCursor(toEthiopian(g));
  };

  const isToday = (c: Cell) =>
    c.eth.year === today.year && c.eth.month === today.month && c.eth.day === today.day;

  const viewTab = (v: View, label: string) => (
    <button key={v} type="button" onClick={() => setView(v)}
      className={cn("-mb-px border-b-2 px-3 pb-2 text-sm font-medium",
        view === v ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink")}>
      {label}
    </button>
  );

  const dayCell = (c: Cell, tall: boolean) => {
    const list = byDay.get(c.iso) ?? [];
    const holiday = list.some((e) => HOLIDAY_TYPES.has(e.event_type));
    const sunday = c.dow === 1;
    const shown = tall ? 3 : 2;
    return (
      <div
        key={c.iso}
        role="button"
        tabIndex={0}
        onClick={() => openOn(c)}
        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openOn(c); } }}
        aria-label={`${months[c.eth.month - 1]} ${c.eth.day} — ${t("eventsCalendar.addOnThisDay")}`}
        className={cn(
          "flex cursor-pointer flex-col items-stretch gap-1 border-b border-l border-line p-1.5 text-left transition-[filter] hover:brightness-95 sm:p-2",
          tall ? "min-h-[64px] sm:min-h-[112px]" : "min-h-[44px] sm:min-h-[68px]",
          !c.inMonth && "opacity-45",
          holiday ? "bg-danger-tint" : sunday ? "bg-danger-tint/60" : "bg-ok-tint/70",
        )}
      >
        <span className={cn("text-sm font-medium",
          isToday(c) ? "inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-white"
            : sunday || holiday ? "text-danger" : "text-ink")}>
          {c.eth.day}
        </span>
        {list.slice(0, shown).map((e) => (
          <span
            key={e.id}
            role="button"
            tabIndex={0}
            onClick={(ev) => { ev.stopPropagation(); openEvent(e); }}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.stopPropagation(); openEvent(e); } }}
            className="truncate rounded border-l-4 bg-card/90 px-1.5 py-0.5 text-xs text-ink shadow-sm"
            style={{ borderLeftColor: e.color ?? "#1E2A70" }}
          >
            {tField(e.name_i18n, locale)}
          </span>
        ))}
        {list.length > shown && (
          <span className="text-[10px] text-ink-faint">
            {t("eventsCalendar.moreCount", { count: list.length - shown })}
          </span>
        )}
      </div>
    );
  };

  const LEGEND: [string, string][] = [
    ["eventsCalendar.legendWork", "#1E88E5"],
    ["eventsCalendar.legendPersonal", "#00ACC1"],
    ["eventsCalendar.legendHolidays", "#E53935"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-1">
        <div className="flex gap-2">
          {viewTab("month", t("eventsCalendar.month"))}
          {viewTab("week", t("eventsCalendar.week"))}
          {viewTab("day", t("eventsCalendar.day"))}
        </div>
        <Button onClick={() => { setEditing(null); setFormDate(toGregorian(cursor)); setFormOpen(true); }}>
          + {t("eventsCalendar.addEvent")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink">
            {months[cursor.month - 1]} {cursor.year}
          </h1>
          <div className="flex overflow-hidden rounded-control border border-line">
            <button type="button" onClick={() => step(-1)} aria-label={t("eventsCalendar.previous")}
              className="px-3 py-1.5 text-ink-soft hover:bg-sidebar">‹</button>
            <button type="button" onClick={() => setCursor({ ...today })}
              className="border-x border-line px-3 py-1.5 text-sm text-ink hover:bg-sidebar">
              {tc("today")}
            </button>
            <button type="button" onClick={() => step(1)} aria-label={t("eventsCalendar.next")}
              className="px-3 py-1.5 text-ink-soft hover:bg-sidebar">›</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {LEGEND.map(([k, c]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-pill bg-sidebar px-3 py-1 text-ink-soft">
              {t(k)} <i className="h-2 w-2 rounded-full" style={{ background: c }} />
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-panel border-r border-t border-line bg-card">
        {view !== "day" && (
          <div className="grid grid-cols-7">
            {weekdays.slice(1).map((d, i) => (
              <div key={d} className={cn("border-b border-l border-line px-1 py-2 text-center text-xs font-bold sm:px-3 sm:py-3 sm:text-sm",
                i === 0 || i === 6 ? "text-danger" : "text-ink")}>
                <span className="hidden sm:inline">{d}</span>
                <span className="sm:hidden">{weekdaysShort[i + 1]}</span>
              </div>
            ))}
          </div>
        )}
        <div className={cn("grid", view === "day" ? "grid-cols-1" : "grid-cols-7")}>
          {cells.map((c) => dayCell(c, view !== "week"))}
        </div>
      </div>

      <p className="text-xs text-ink-faint">{t("eventsCalendar.clickHint")}</p>

      <EventFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        initialDate={formDate}
        editing={editing}
      />
    </div>
  );
}
