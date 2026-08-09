import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  tone?: "navy" | "danger" | "late" | "ok";
}

const TONE_ACTIVE: Record<NonNullable<SegmentOption<string>["tone"]>, string> = {
  navy: "bg-navy text-white",
  danger: "bg-danger text-white",
  late: "bg-late text-white",
  ok: "bg-ok text-white",
};

/** Present/absent/late/excused-style multi-state selector — a pill-shaped
 * track with individually tappable, color-filled segments. Generic over
 * SegmentOption<T> so it isn't attendance-specific. */
export function SegmentedControl<T extends string>({
  options, value, onChange, className,
}: {
  options: SegmentOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex overflow-hidden rounded-pill border border-line bg-card", className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors",
              active ? TONE_ACTIVE[opt.tone ?? "navy"] : "text-ink-soft hover:bg-sidebar",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
