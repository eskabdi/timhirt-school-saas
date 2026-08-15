import { cn } from "@/lib/utils";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!first || !last) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
} as const;

/** Initials-in-a-circle avatar — used wherever a tenant logo or user photo
 * would go once real image uploads exist; falls back cleanly without one.
 * `color`, when given, overrides the default navy background via inline
 * style — a plain className can't reliably win against bg-navy since both
 * are Tailwind utilities and cascade order isn't source order. */
export function Avatar({ name, size = "md", className, color }: {
  name: string; size?: keyof typeof SIZE_CLASSES; className?: string; color?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white",
        !color && "bg-navy",
        SIZE_CLASSES[size], className,
      )}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}
