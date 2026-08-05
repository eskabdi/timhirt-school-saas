import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Small inline "copy to clipboard" button — flips to a checkmark + label
 *  for 1.5s so the click has visible feedback, then reverts. */
export function CopyButton({ value, label, className }: { value: string; label?: string; className?: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permission
      // denial) -- nothing useful to do beyond not showing false feedback.
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label ?? t("actions.copy")}
      className={cn(
        "inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-xs font-medium text-navy hover:bg-navy-wash",
        className,
      )}
    >
      {copied ? (
        <>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" /></svg>
          {t("actions.copied")}
        </>
      ) : (
        <>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5"><path d="M7 3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V7.4a2 2 0 0 0-.6-1.4l-3.4-3.4A2 2 0 0 0 10.6 2H7a2 2 0 0 0-2 1Z" /><path d="M5 6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-1H7a3 3 0 0 1-3-3V6Z" /></svg>
          {t("actions.copy")}
        </>
      )}
    </button>
  );
}
