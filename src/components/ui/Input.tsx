import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-control border border-line bg-card px-3 py-2 text-sm text-ink",
          "placeholder:text-ink-faint focus:border-navy focus:outline-none",
          className,
        )}
        {...props}
      />
    );
  },
);
