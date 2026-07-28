import { ReactNode, useId } from "react";

/**
 * Labelled group for a composite control — a chip list, a checkbox set, a
 * dropzone — anything that is several controls rather than one.
 *
 * Field renders a <label>, and a <label> with no htmlFor implicitly targets its
 * first labelable descendant: clicking anywhere inside it that is not itself
 * interactive fires a click on that first control. With a chip list that meant
 * pressing "+ Add Section" also pressed the first chip's ✕ and silently dropped
 * a section; with a dropzone it opened the file picker twice. A group is not a
 * label, so it gets a plain div and an aria-labelledby association instead.
 */
export function FieldGroup({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="block space-y-1.5">
      <span id={labelId} className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-faint">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-danger">{error}</span>}
    </div>
  );
}

export function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-ink-faint">{hint}</span>}
      {error && <span role="alert" className="block text-xs text-danger">{error}</span>}
    </label>
  );
}
