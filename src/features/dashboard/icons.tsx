// Inline icons for the dashboard tiles.
//
// Hand-drawn rather than pulled from an icon package: this screen needs about
// fifteen glyphs and nothing else in the app uses one, so a dependency would
// be carried by every route to serve a single page. Each is a 24x24 stroke
// icon inheriting currentColor, so the tile controls the colour.
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

export const IconGradCap = (p: IconProps) => (
  <Icon {...p}><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" /></Icon>
);

export const IconStaff = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" />
    <circle cx="17.5" cy="9.5" r="2.5" /><path d="M16 15.2A5 5 0 0 1 21.5 20" />
  </Icon>
);

export const IconParents = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="7" r="2.5" /><path d="M4 20v-5a3.5 3.5 0 0 1 7 0v5" />
    <circle cx="16.5" cy="7" r="2.5" /><path d="M13 20v-5a3.5 3.5 0 0 1 7 0v5" />
  </Icon>
);

export const IconFilter = (p: IconProps) => (
  <Icon {...p}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z" /></Icon>
);

export const IconExternal = (p: IconProps) => (
  <Icon {...p}><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Icon>
);

export const IconWarning = (p: IconProps) => (
  <Icon {...p}><path d="M12 3.5 2.7 19.5h18.6L12 3.5Z" /><path d="M12 10v4" /><path d="M12 17.2h.01" /></Icon>
);

export const IconCalendar = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>
);

export const IconChevronLeft = (p: IconProps) => (<Icon {...p}><path d="m15 5-7 7 7 7" /></Icon>);
export const IconChevronRight = (p: IconProps) => (<Icon {...p}><path d="m9 5 7 7-7 7" /></Icon>);

export const IconInfo = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></Icon>
);

export const IconMessage = (p: IconProps) => (
  <Icon {...p}><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" /></Icon>
);

export const IconApplication = (p: IconProps) => (
  <Icon {...p}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></Icon>
);

export const IconCourseRequest = (p: IconProps) => (
  <Icon {...p}><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" /><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" /></Icon>
);

export const IconMissingAttendance = (p: IconProps) => (
  <Icon {...p}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 11.3-2.8" /><circle cx="18" cy="17" r="4" /><path d="m16.6 15.6 2.8 2.8M19.4 15.6l-2.8 2.8" /></Icon>
);

export const IconSend = (p: IconProps) => (
  <Icon {...p}><path d="m21 3-9.5 9.5" /><path d="M21 3 15 21l-3.5-8.5L3 9l18-6Z" /></Icon>
);

export const IconAddGuardian = (p: IconProps) => (
  <Icon {...p}><circle cx="10" cy="8" r="3.2" /><path d="M3.5 20a6.5 6.5 0 0 1 11.4-4.3" /><path d="M18 14v6M15 17h6" /></Icon>
);

export const IconAddFees = (p: IconProps) => (
  <Icon {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M14.6 9.4A2.8 2.8 0 0 0 12 8.2c-1.5 0-2.6.8-2.6 2s1.1 1.8 2.6 1.8 2.6.7 2.6 1.9-1.1 2-2.6 2a2.8 2.8 0 0 1-2.6-1.3" /></Icon>
);

export const IconAddEvent = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M12 13v5M9.5 15.5h5" /></Icon>
);

export const IconAddAbsence = (p: IconProps) => (
  <Icon {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m10 14.5 4 4M14 14.5l-4 4" /></Icon>
);

export const IconInvoice = (p: IconProps) => (
  <Icon {...p}><path d="M5 3h14v18l-3-2-2 2-2-2-2 2-3-2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></Icon>
);

export const IconNotice = (p: IconProps) => (
  <Icon {...p}><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5Z" /><path d="M8 8h8M8 11.5h5" /></Icon>
);
