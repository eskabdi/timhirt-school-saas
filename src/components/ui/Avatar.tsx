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
 * would go once real image uploads exist; falls back cleanly without one. */
export function Avatar({ name, size = "md", className }: {
  name: string; size?: keyof typeof SIZE_CLASSES; className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-navy font-display font-bold text-white",
        SIZE_CLASSES[size], className,
      )}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}
