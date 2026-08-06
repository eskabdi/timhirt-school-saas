import { cn } from "@/lib/utils";

const PREFIX = "+251";

// Every Ethiopian phone number on this platform is domestic, so the country
// code is fixed chrome, not user-editable text -- strips whatever prefix
// existing data was stored with (+251 / 251 / a leading trunk 0) so the
// editable segment only ever shows the subscriber number.
function toLocal(value: string): string {
  const v = value.trim();
  if (v.startsWith(PREFIX)) return v.slice(PREFIX.length);
  if (v.startsWith("251")) return v.slice(3);
  if (v.startsWith("0")) return v.slice(1);
  return v;
}

export function PhoneInput({ value, onChange, className, placeholder, id }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className={cn(
      "flex h-11 w-full overflow-hidden rounded-control border border-line bg-sidebar",
      "focus-within:border-navy-container focus-within:ring-2 focus-within:ring-navy-container/20",
      className,
    )}>
      <span className="flex shrink-0 select-none items-center border-r border-line bg-navy-wash px-3 text-sm font-medium text-ink-faint">
        {PREFIX}
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        value={toLocal(value)}
        onChange={(e) => onChange(PREFIX + e.target.value.replace(/[^0-9]/g, ""))}
        placeholder={placeholder ?? "911 234 567"}
        maxLength={10}
        className="h-full w-full bg-transparent px-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
    </div>
  );
}
