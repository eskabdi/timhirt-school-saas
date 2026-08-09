import { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "tertiary" | "danger";
export function Button({
  variant = "primary", className, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        // Primary: gradient navy -> navy-container, per DESIGN.md §5.
        variant === "primary" && "bg-gradient-to-br from-navy to-navy-container text-white hover:brightness-110",
        // Ghost/secondary: tonal hover (never a solid gold fill — "jewelry,
        // not wallpaper", DESIGN.md §6), plus a gold underline accent.
        variant === "ghost" && "text-navy hover:bg-navy-wash underline decoration-transparent hover:decoration-gold-bright decoration-2 underline-offset-4",
        variant === "tertiary" && "bg-sidebar text-ink hover:bg-line",
        variant === "danger" && "bg-danger text-white hover:opacity-90",
        className,
      )}
      {...props}
    />
  );
}
