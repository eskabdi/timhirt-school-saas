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
 * admission stage. */
export function Badge({ tone = "neutral", children, className }: {
  tone?: Tone; children: ReactNode; className?: string;
}) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-semibold capitalize",
      TONE_CLASSES[tone], className,
    )}>
      {children}
    </span>
  );
}
