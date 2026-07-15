import { ReactNode } from "react";

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
      {error && <span role="alert" className="block text-xs text-danger">{error}</span>}
    </label>
  );
}
