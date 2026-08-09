import { ReactNode, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

// Lightweight modal used by the admin CRUD screens. Matches the inline dialog
// pattern already used in RolesPage; centralized here so every module shares
// the same overlay, sizing, and escape/backdrop behavior.
//
// Dialog semantics live here rather than at each call site: role="dialog" plus
// aria-modal is what makes a screen reader announce the panel and stop reading
// the page behind it, and there are ~20 modals in the app that would otherwise
// each have to remember. Focus is moved in on open and returned to whatever
// opened it on close, so keyboard users are not left at the top of a document
// they cannot see.
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
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    // First focusable element, falling back to the panel itself (tabIndex -1)
    // so focus never stays behind on the page underneath.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]),'
      + ' button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    (first ?? panelRef.current)?.focus();
    return () => restoreTo.current?.focus?.();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "w-full rounded-panel bg-card/95 backdrop-blur-xl p-6 shadow-ambient-lg max-h-[90vh] overflow-y-auto outline-none",
          size === "md" && "max-w-md",
          size === "lg" && "max-w-2xl",
          size === "xl" && "max-w-4xl",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-4 font-display text-lg font-bold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}
