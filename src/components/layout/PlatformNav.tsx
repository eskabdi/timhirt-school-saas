// Minimal tab nav for the /platform/* super_admin console — these pages
// previously had no way to navigate between each other. Not a full shell
// (no sidebar/header parity with DashboardShell) — kept intentionally light
// since the platform console is a small, low-traffic surface.
import { NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/platform/tenants", label: "Tenants" },
  { to: "/platform/modules", label: "Modules" },
  { to: "/platform/integrations", label: "Integrations" },
  { to: "/platform/billing", label: "Billing" },
  { to: "/platform/statutory", label: "Statutory config" },
];

export function PlatformNav() {
  const queryClient = useQueryClient();

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  return (
    <nav className="mb-6 flex items-center justify-between gap-1 border-b border-line pb-px">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "rounded-t-control border-b-2 px-3 py-2 text-sm font-medium",
                isActive ? "border-navy text-navy" : "border-transparent text-ink-faint hover:text-ink",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <button
        type="button"
        onClick={signOut}
        className="mb-2 rounded-control px-3 py-1.5 text-sm text-ink-faint hover:bg-danger-tint hover:text-danger"
      >
        Log out
      </button>
    </nav>
  );
}
