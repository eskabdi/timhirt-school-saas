// Line chart, hand-rolled in SVG. See Pie.tsx for why there is no charting
// library here.
//
// Built for one job: an attendance-rate trend, optionally against a dashed
// comparison series (the prior equivalent period) sharing the same x buckets.
// The axis is data-driven rather than fixed at 0-100 — attendance rates
// cluster tightly near the top of that range, and a fixed axis would flatten
// every real trend into a hairline.
//
// Point markers are real positioned <span> elements, not SVG circles, because
// the plot area uses preserveAspectRatio="none" so the line fills the full
// width regardless of point count; an SVG circle in that same viewBox would
// be squashed into an ellipse by the non-uniform scale.
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface LinePoint { x: string; y: number }
export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  points: LinePoint[];
}

function axisRange(values: number[], count = 4): { min: number; max: number; ticks: number[] } {
  if (!values.length) return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(2, (hi - lo) * 0.25);
  const min = Math.max(0, Math.floor(lo - pad));
  // A tight cluster of values (a week of near-100% attendance, say) can pad
  // out to a span under `count` units — the rounded ticks then collapse into
  // duplicates ("98, 98, 99, 99, 100"), which both misreads as a flat line
  // and gives React sibling <li> elements the same key. Flooring the span at
  // `count` keeps every tick at least 1 apart after rounding.
  const max = Math.max(min + count, Math.ceil(hi + pad));
  const span = max - min;
  return { min, max, ticks: Array.from({ length: count + 1 }, (_, i) => Math.round(min + (span * i) / count)) };
}

export function LineChart({
  series, height = 220, formatY = (n: number) => String(n), className, emptyLabel,
  markers = [],
}: {
  series: LineSeries[];
  height?: number;
  formatY?: (n: number) => string;
  className?: string;
  emptyLabel?: string;
  /** Highlight specific points on a series — e.g. the most recent and the lowest. */
  markers?: { seriesKey: string; index: number; label: string }[];
}) {
  const titleId = useId();
  const primary = series[0];

  if (!primary || primary.points.length === 0) {
    return <p className={cn("py-8 text-center text-sm text-ink-faint", className)}>{emptyLabel}</p>;
  }

  const { min, max, ticks } = axisRange(series.flatMap((s) => s.points.map((p) => p.y)));
  const span = max - min;
  const plot = height - 28;
  const n = primary.points.length;
  const xAt = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const yAt = (v: number) => 100 - ((v - min) / span) * 100;
  const pathFor = (pts: LinePoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.y)}`).join(" ");
  const every = Math.max(1, Math.ceil(n / 5));

  return (
    <div className={className}>
      <div className="flex gap-2">
        <ul className="flex shrink-0 flex-col-reverse justify-between text-[10px] tabular-nums text-ink-faint"
            style={{ height: plot, marginBottom: 28 }}>
          {ticks.map((v) => (
            <li key={v} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">{formatY(v)}</li>
          ))}
        </ul>

        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: plot }}>
            {ticks.map((v) => (
              <div key={v} className="absolute inset-x-0 border-t border-line"
                   style={{ bottom: `${((v - min) / span) * 100}%` }} />
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"
                 role="img" aria-labelledby={titleId}>
              <title id={titleId}>{series.map((s) => s.label).join(" vs ")}</title>
              {series.map((s) => s.points.length > 1 && (
                <path
                  key={s.key}
                  d={pathFor(s.points)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.5 : 2}
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {markers.map((m) => {
              const s = series.find((sr) => sr.key === m.seriesKey);
              const p = s?.points[m.index];
              if (!p) return null;
              return (
                <span
                  key={`${m.seriesKey}-${m.index}`}
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow"
                  style={{ left: `${xAt(m.index)}%`, top: `${yAt(p.y)}%`, backgroundColor: s!.color }}
                  title={`${m.label}: ${formatY(p.y)}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between px-1 pt-2">
            {primary.points.map((p, i) => (
              <span key={i} className={cn("text-[10px] text-ink-soft", i % every !== 0 && i !== n - 1 && "invisible")}>
                {p.x}
              </span>
            ))}
          </div>
        </div>
      </div>

      {series.length > 1 && (
        <ul className="mt-3 flex flex-wrap items-center justify-center gap-4">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
              <span className={cn("h-2.5 w-2.5 rounded-sm", s.dashed && "border border-dashed border-current bg-transparent")}
                    style={!s.dashed ? { backgroundColor: s.color } : { borderColor: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
