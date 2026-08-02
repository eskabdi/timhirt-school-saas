import { Link } from "react-router-dom";
import { IconExternal } from "./icons";

/** Blue link-style card title with the "open the full screen" affordance.
 *  Shared by DashboardPage.tsx's own cards and MessagesCard.tsx. */
export function LinkedHeader({ title, to, right }: { title: string; to?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold text-navy">{title}</h2>
      <div className="flex items-center gap-3">
        {right}
        {to && (
          <Link to={to} className="text-navy hover:text-navy-deep" aria-label={title}>
            <IconExternal className="h-4 w-4" />
          </Link>
        )}
      </div>
    </div>
  );
}
