import { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card-with-title-and-divided-sections pattern — attendance roster, payroll
 * table, leave-request list. Replaces ad hoc `rounded-card border...` markup. */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-hidden rounded-panel border border-line bg-card", className)} {...props} />;
}

export function PanelHeader({ title, subtitle, action, className }: {
  title: ReactNode; subtitle?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4 border-b border-line px-5 py-4", className)}>
      <div>
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PanelFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-line px-5 py-4", className)} {...props} />;
}
