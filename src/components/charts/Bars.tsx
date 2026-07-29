// Bar charts, hand-rolled in SVG. See Pie.tsx for why there is no chart
// library here.
//
// Two shapes, because the dashboard asks for two: a single series with a value
// printed over each bar (billing), and grouped series sharing an x category
// (attendance by weekday).
import { useId } from "react";
import { cn } from "@/lib/utils";

/** The smallest 1/2/5 x 10^n at or above `value`. */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Axis ticks, and the maximum they imply.
 *
 * The step is chosen first and the top of the axis derived from it, rather
 * than the other way round. Rounding the maximum and then dividing gave
 * fractional ticks that collapsed once rounded for display — a chart with a
 * maximum of 1 rendered its gridlines as "1, 1, 1, 0, 0", and one topping out
 * at 35 labelled them 13 / 25 / 38. Deriving max from the step keeps every
 * tick a whole multiple of it.
 */
function axisFor(peak: number, count = 4): { max: number; ticks: number[] } {
  // Floor the step at 1. Both series here are whole units — headcounts and
  // birr — and an all-zero series otherwise produced a sub-unit step whose
  // ticks collapsed into duplicates once formatted ("0, 1, 1, 2, 2").
  const step = Math.max(1, niceStep(Math.max(peak, 0) / count));
  const max = step * count;
  return { max, ticks: Array.from({ length: count + 1 }, (_, i) => step * i) };
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function BarChart({
  data, height = 200, formatValue = String, formatAxis, className, emptyLabel,
}: {
  data: Bar[];
  height?: number;
  formatValue?: (n: number) => string;
  /** Ticks need to be terser than bar labels — "Br 200K", not "ETB 200,000.00". */
  formatAxis?: (n: number) => string;
  className?: string;
  emptyLabel?: string;
}) {
  const titleId = useId();
  // An all-zero series is still worth drawing: "nothing was collected" is a
  // real answer and the axis gives it context. Only an absent series is empty.
  if (!data.length) {
    return <p className={cn("py-8 text-center text-sm text-ink-faint", className)}>{emptyLabel}</p>;
  }

  const { max, ticks: axis } = axisFor(Math.max(...data.map((d) => d.value), 0));
  const tick = formatAxis ?? formatValue;
  const plot = height - 28; // room for the category labels under the axis

  return (
    <div className={cn("flex gap-2", className)}>
      <ul className="flex shrink-0 flex-col-reverse justify-between text-[10px] tabular-nums text-ink-faint"
          style={{ height: plot, marginBottom: 28 }}>
        {axis.map((v) => <li key={v} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{tick(v)}</li>)}
      </ul>

      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height: plot }}>
          {axis.map((v) => (
            <div key={v} className="absolute inset-x-0 border-t border-line"
                 style={{ bottom: `${(v / max) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end justify-around gap-4 px-4">
            {data.map((d) => (
              <div key={d.key} className="flex h-full min-w-0 flex-1 flex-col justify-end items-center">
                <span className="mb-1 text-[11px] font-semibold tabular-nums"
                      style={{ color: d.color }}>
                  {formatValue(d.value)}
                </span>
                <div
                  className="w-full max-w-[110px] rounded-t-sm transition-[height]"
                  style={{
                    height: `${(d.value / max) * 100}%`,
                    backgroundColor: d.color,
                    // A zero bar still needs to be visible as a baseline tick,
                    // otherwise the category reads as missing rather than empty.
                    minHeight: d.value === 0 ? 2 : undefined,
                  }}
                  role="img"
                  aria-labelledby={`${titleId}-${d.key}`}
                />
                <span id={`${titleId}-${d.key}`} className="sr-only">
                  {d.label}: {formatValue(d.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-around gap-4 px-4 pt-2">
          {data.map((d) => (
            <span key={d.key} className="min-w-0 flex-1 truncate text-center text-[11px] italic text-ink-soft">
              {d.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface Series { key: string; label: string; color: string }
export interface Group { key: string; label: string; values: Record<string, number> }

export function GroupedBarChart({
  groups, series, height = 220, className,
}: {
  groups: Group[];
  series: Series[];
  height?: number;
  className?: string;
}) {
  const titleId = useId();
  const { max, ticks: axis } = axisFor(Math.max(
    ...groups.flatMap((g) => series.map((s) => g.values[s.key] ?? 0)), 0,
  ));
  const plot = height - 34;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <ul className="flex shrink-0 flex-col-reverse justify-between text-[10px] tabular-nums text-ink-faint"
            style={{ height: plot, marginBottom: 34 }}>
          {axis.map((v) => (
            <li key={v} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {Math.round(v)}
            </li>
          ))}
        </ul>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: plot }}>
            {axis.map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-line"
                   style={{ bottom: `${(v / max) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end justify-between gap-1 px-2">
              {groups.map((g) => (
                <div key={g.key} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]">
                  {series.map((s) => {
                    const v = g.values[s.key] ?? 0;
                    return (
                      <div
                        key={s.key}
                        className="w-2 rounded-t-sm sm:w-3"
                        style={{
                          height: `${(v / max) * 100}%`,
                          backgroundColor: s.color,
                          minHeight: v === 0 ? 1 : undefined,
                          opacity: v === 0 ? 0.35 : 1,
                        }}
                        role="img"
                        aria-labelledby={`${titleId}-${g.key}-${s.key}`}
                      >
                        <span id={`${titleId}-${g.key}-${s.key}`} className="sr-only">
                          {g.label} {s.label}: {v}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-between gap-1 px-2 pt-2">
            {groups.map((g) => (
              <span key={g.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-soft">
                {g.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap items-center justify-center gap-4">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
