import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// "No-Line Rule" (DESIGN.md §2/§6): no 1px border — the card is defined by
// tonal contrast against the page background plus an ultra-diffused ambient
// shadow, not a stroke.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-panel bg-card p-5 shadow-ambient", className)} {...props} />;
}
