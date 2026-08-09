// Pie chart, hand-rolled in SVG.
//
// No charting library: the dashboard needs a pie and two bar charts, and the
// smallest of the usual candidates costs more transferred bytes than the whole
// rest of this screen. Everything here is arithmetic and one <path> per slice.
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/**
 * A wedge from `start` to `end`, both in radians clockwise from 12 o'clock.
 *
 * A slice covering the entire circle is the awkward case: start and end land on
 * the same point, the arc has nowhere to go and the browser draws nothing at
 * all — one category at 100% would render as an empty box. That case is drawn
 * as a plain circle instead.
 */
function wedge(cx: number, cy: number, r: number, start: number, end: number): string {
  const x1 = cx + r * Math.sin(start);
  const y1 = cy - r * Math.cos(start);
  const x2 = cx + r * Math.sin(end);
  const y2 = cy - r * Math.cos(end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function PieChart({
  data, size = 150, legend = "labels", className, emptyLabel,
}: {
  data: Slice[];
  size?: number;
  /** "labels" puts name beside each dot; "dots" is the compact colour column. */
  legend?: "labels" | "dots" | "none";
  className?: string;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const titleId = useId();

  const slices = data.filter((s) => s.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (!total) {
    return (
      <div className={cn("flex items-center justify-center py-8", className)}>
        <p className="text-sm text-ink-faint">{emptyLabel}</p>
      </div>
    );
  }

  const r = size / 2;
  let cursor = 0;
  const rendered = slices.map((s) => {
    const start = cursor;
    const end = cursor + (s.value / total) * Math.PI * 2;
    cursor = end;
    return { ...s, start, end, pct: (s.value / total) * 100 };
  });

  const active = rendered.find((s) => s.key === hovered);

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative shrink-0">
        <svg
          width={size} height={size} viewBox={`0 0 ${size} ${size}`}
          role="img" aria-labelledby={titleId}
        >
          <title id={titleId}>
            {rendered.map((s) => `${s.label}: ${s.value}`).join(", ")}
          </title>
          {rendered.map((s) => (
            <path
              key={s.key}
              d={rendered.length === 1
                // Full-circle case — see wedge().
                ? `M ${r} 0 A ${r} ${r} 0 1 1 ${r - 0.01} 0 Z`
                : wedge(r, r, r, s.start, s.end)}
              fill={s.color}
              className="cursor-pointer transition-opacity"
              opacity={hovered && hovered !== s.key ? 0.45 : 1}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        {active && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-control bg-ink px-2 py-1 text-xs font-medium text-white shadow-lg">
            {active.label} {active.value} ({active.pct.toFixed(1)}%)
          </div>
        )}
      </div>

      {legend !== "none" && (
        <ul className={cn("min-w-0", legend === "dots" ? "space-y-1.5" : "space-y-2")}>
          {rendered.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                className="flex items-center gap-2 text-left"
                onMouseEnter={() => setHovered(s.key)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.key)}
                onBlur={() => setHovered(null)}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                  style={{ backgroundColor: s.color }}
                />
                {legend === "labels" && (
                  <span className="truncate text-sm font-medium" style={{ color: s.color }}>
                    {s.label}
                  </span>
                )}
                {/* The compact legend still needs a name for a screen reader —
                    a column of coloured dots is meaningless without one. */}
                {legend === "dots" && <span className="sr-only">{s.label}: {s.value}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
