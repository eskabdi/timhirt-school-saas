// Inline icons for the Invoices page stat cards, filters, and header actions.
// Hand-drawn rather than pulled from a package, same reasoning as
// dashboard/icons.tsx: this screen needs a handful of glyphs and nothing
// else in the fees module uses one.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconReceipt = (p: IconProps) => (
  <Icon {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-3-2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></Icon>
);

export const IconCheckCircle = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 5-5" /></Icon>
);

export const IconWarningTriangle = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.5 2.7 19.5h18.6L12 3.5Z" /><path d="M12 10v4" /><path d="M12 17.2h.01" /></Icon>
);

export const IconDownload = (p: IconProps) => (
  <Icon {...p}><path d="M12 4v11" /><path d="m7.5 11 4.5 4.5L16.5 11" /><path d="M4.5 19.5h15" /></Icon>
);

export const IconPlusDoc = (p: IconProps) => (
  <Icon {...p}><path d="M6 3h9l3 3v15H6Z" /><path d="M15 3v3h3" /><path d="M12 12v6M9 15h6" /></Icon>
);

export const IconCalendarSmall = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>
);
