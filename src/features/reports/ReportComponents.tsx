import { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

export function ReportStat({ label, value, sub, tone }: {
  label: string; value: string | number; sub?: string; tone?: "ok" | "danger" | "navy" | "late";
}) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
      <p className={cn(
        "mt-2 font-display text-2xl font-bold tabular-nums",
        tone === "ok" && "text-ok", tone === "danger" && "text-danger", tone === "navy" && "text-navy", tone === "late" && "text-late",
        !tone && "text-ink",
      )}>{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-faint">{sub}</p>}
    </Card>
  );
}

export function ReportBarChart({ bars }: { bars: { label: string; value: number }[] }) {
  const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
  const peak = Math.max(...bars.map((b) => b.value));
  return (
    <div className="flex h-32 gap-3">
      {bars.map((b) => {
        const h = bars.every((x) => x.value === 0) ? 2 : Math.max(4, (Math.abs(b.value) / max) * 100);
        return (
          <div key={b.label} className="flex flex-1 flex-col gap-1">
            <span className="text-center text-[10px] font-medium text-ink-faint tabular-nums">{new Intl.NumberFormat().format(b.value)}</span>
            {/* flex-1 gives this track a definite height, so the bar's % resolves. */}
            <div className="flex flex-1 items-end">
              <div
                className="w-full rounded-t"
                style={{ height: `${h}%`, background: b.value === peak && b.value !== 0 ? "var(--navy, #1E2A70)" : "#E9EAF7" }}
              />
            </div>
            <span className="text-center text-[10px] uppercase text-ink-faint">{b.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ReportSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  );
}
