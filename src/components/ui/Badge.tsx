import { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "navy" | "danger" | "late" | "ok" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  navy: "bg-navy-wash text-navy",
  danger: "bg-danger-tint text-danger",
  late: "bg-late-tint text-late",
  ok: "bg-ok-tint text-ok",
  neutral: "bg-sidebar text-ink-soft",
};

/** Small tinted status pill — payroll run status, academic year status,
 * admission stage. `dot` prepends a small filled circle for lists (e.g. the
 * Invoices ledger) where the badge needs to read at a glance in a dense
 * table row — still a tinted pill, not a solid fill (DESIGN.md "jewelry, not
 * wallpaper" rule stays the same; the dot alone carries the extra signal). */
export function Badge({ tone = "neutral", dot = false, children, className }: {
  tone?: Tone; dot?: boolean; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold capitalize",
      TONE_CLASSES[tone], className,
    )}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
