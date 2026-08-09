import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-control border border-line bg-sidebar px-3 text-sm text-ink",
          "placeholder:text-ink-faint focus:border-navy-container focus:outline-none focus:ring-2 focus:ring-navy-container/20",
          className,
        )}
        {...props}
      />
    );
  },
);
