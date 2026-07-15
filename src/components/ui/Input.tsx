import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-card border border-line bg-chalk-raised px-3 py-2 text-sm",
          "placeholder:text-ink-faint focus:border-meskel",
          className,
        )}
        {...props}
      />
    );
  },
);
