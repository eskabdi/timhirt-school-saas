// Numbered progress header for a multi-step form.
//
// Extracted from PublicAdmissionFormPage, which had the only copy, when staff
// registration needed a second one. Two steppers drawn from two
// implementations drift — the student flow and the staff flow are the same
// gesture and should look identical.
//
// `sublabels` carries the Amharic caption the staff designs put under each
// English step name. Optional, because the admission stepper's labels already
// come from the `apply` namespace and are translated whole.
import { cn } from "@/lib/utils";

export function Stepper({ step, labels, sublabels, className }: {
  /** 1-based index of the active step. */
  step: number;
  labels: string[];
  sublabels?: (string | undefined)[];
  className?: string;
}) {
  return (
    <div className={cn("mb-8", className)}>
      <ol className="flex items-center">
        {labels.map((label, i) => {
          const n = i + 1;
          const isDone = n < step;
          const isActive = n === step;
          return (
            <li key={n} className="flex flex-1 items-center last:flex-none">
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors",
                  isDone || isActive ? "bg-navy text-white" : "bg-sidebar text-ink-faint",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                {isDone ? "✓" : n}
                <span className="sr-only">{label}</span>
              </span>
              {n < labels.length && (
                <span aria-hidden="true"
                      className={cn("h-0.5 flex-1", isDone ? "bg-navy" : "bg-line")} />
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex">
        {labels.map((label, i) => {
          const n = i + 1;
          return (
            <div key={n} className={cn("flex-1 text-center", n === labels.length && "w-9 flex-none")}
                 aria-hidden="true">
              <p className={cn("text-sm font-semibold", n === step ? "text-navy" : "text-ink")}>
                {label}
              </p>
              {sublabels?.[i] && (
                <p className="text-[11px] text-ink-faint">{sublabels[i]}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
