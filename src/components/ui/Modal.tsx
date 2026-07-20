import { ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

// Lightweight modal used by the admin CRUD screens. Matches the inline dialog
// pattern already used in RolesPage; centralized here so every module shares
// the same overlay, sizing, and escape/backdrop behavior.
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "w-full rounded-lg bg-card p-6 shadow-lg max-h-[90vh] overflow-y-auto",
          size === "md" && "max-w-md",
          size === "lg" && "max-w-2xl",
          size === "xl" && "max-w-4xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}
