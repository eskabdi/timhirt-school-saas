import { cn } from "@/lib/utils";

/**
 * Switch-style boolean. The visible track is a span and the real checkbox sits
 * transparently on top of it, so the control keeps native keyboard and
 * screen-reader behaviour while looking like a switch.
 *
 * Extracted from the copies that had accumulated in EventFormModal and
 * AdmissionReviewModal — the Assignment and Grading Scales screens made it a
 * fourth and fifth.
 */
export function Toggle({ checked, onChange, label, disabled = false }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span className={cn("relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors",
      checked ? "bg-navy" : "bg-line", disabled && "opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
          checked ? "left-[22px]" : "left-0.5",
        )}
      />
    </span>
  );
}
