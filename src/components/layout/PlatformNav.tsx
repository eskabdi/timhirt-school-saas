// Sidebar nav for the /platform/* super_admin console. Every platform route
// in src/app/router.tsx has a link here, grouped the same way the tenant-side
// DashboardShell groups its sections.
import { NavLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/ui/Avatar";
import { useSession } from "@/features/auth/useSession";
import { cn } from "@/lib/utils";

interface PlatformLink { to: string; label: string; end?: boolean }
interface PlatformSection { section?: string; items: PlatformLink[] }

const PLATFORM_NAV: PlatformSection[] = [
  {
    section: "Tenant Management",
    items: [
      { to: "/platform/tenants", label: "Tenants" },
      { to: "/platform/modules", label: "Modules Matrix" },
    ],
  },
  {
    section: "Commercial",
    items: [
      { to: "/platform/billing", label: "Billing" },
      { to: "/platform/integrations", label: "Integrations" },
    ],
  },
  {
    section: "Reports & Analytics",
    items: [{ to: "/platform/reports", label: "Platform Report" }],
  },
  {
    section: "Configuration",
    items: [{ to: "/platform/statutory", label: "Statutory Config" }],
  },
];

export function PlatformNav() {
  const queryClient = useQueryClient();
  const { profile } = useSession();

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // §6.3 mandatory — no stale cross-tenant data in memory
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-line px-5 py-4">
        <Avatar name="Timhirt Platform" size="md" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-base font-bold leading-tight text-navy">Timhirt</h1>
          <p className="truncate text-xs text-ink-faint">Super Admin Console</p>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {PLATFORM_NAV.map((section, si) => (
          <div key={si} className="space-y-1">
            {section.section && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {section.section}
              </p>
            )}
            <div className={cn("space-y-1", section.section && "pl-1")}>
              {section.items.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end ?? false}
                  className={({ isActive }) =>
                    cn("block rounded-control px-3 py-2 text-sm transition-colors",
                       isActive ? "bg-navy font-semibold text-white" : "text-ink-soft hover:bg-navy-wash")}
                >
                  {l.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <Avatar name={profile?.full_name ?? "?"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm text-ink">{profile?.full_name}</p>
            <p className="truncate text-xs text-ink-faint">Super Admin</p>
          </div>
        </div>
        <button
          type="button"
          onClick={signOut}
          className="block w-full rounded-control px-3 py-2 text-left text-sm text-danger hover:bg-danger-tint"
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
