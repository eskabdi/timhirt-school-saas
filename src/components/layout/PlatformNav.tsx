// Minimal tab nav for the /platform/* super_admin console — these pages
// previously had no way to navigate between each other. Not a full shell
// (no sidebar/header parity with DashboardShell) — kept intentionally light
// since the platform console is a small, low-traffic surface.
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/platform/tenants", label: "Tenants" },
  { to: "/platform/modules", label: "Modules" },
  { to: "/platform/integrations", label: "Integrations" },
  { to: "/platform/billing", label: "Billing" },
  { to: "/platform/statutory", label: "Statutory config" },
];

export function PlatformNav() {
  return (
    <nav className="mb-6 flex gap-1 border-b border-line pb-px">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            cn(
              "rounded-t-card border-b-2 px-3 py-2 text-sm font-medium",
              isActive ? "border-meskel text-ink" : "border-transparent text-ink-faint hover:text-ink",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
